// ============================================================================
// verify-job-offer-ranking.mjs — aturan "tugas dilepas ditawarkan ke teknisi
// TERDEKAT yang keahlian + areanya cocok".
//
// TIDAK butuh kredensial, TIDAK menyentuh DB, dan TIDAK mengirim push nyata:
// klien Supabase & pengirim push disuntik palsu (seam `client` & `send` di
// src/lib/job-offer.js) sehingga aturan urutan/penyaringan bisa diuji langsung
// dan aman dijalankan kapan saja (termasuk CI).
//
// Exit code: 0 = semua aturan lulus, 1 = ada yang gagal.
//   npm run verify:job-offer
// ============================================================================
import {
  distanceMeters,
  rankTechniciansByDistance,
  offerReleasedJobToNearestTechnicians,
  LOCATION_FRESH_MS,
} from "../src/lib/job-offer.js";

const failures = [];
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`✅ ${label}`);
  } else {
    failures.push(label);
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---- Klien Supabase palsu: rantai from().select().eq()/in() yang ditunggu ----
function fakeAdmin({ techs = [], locations = [], service = null } = {}) {
  return {
    from(table) {
      const api = {
        select: () => api,
        eq: () => api,
        in: () => api,
        maybeSingle: async () => ({
          data: table === "services" ? service : null,
          error: null,
        }),
        then: (onFulfilled) =>
          Promise.resolve(
            table === "profiles"
              ? { data: techs, error: null }
              : table === "technician_locations"
                ? { data: locations, error: null }
                : { data: null, error: null }
          ).then(onFulfilled),
      };
      return api;
    },
  };
}

// Titik pesanan: Serang, Banten.
const booking = {
  id: "b-1",
  code: "SV-5045",
  address: "serang",
  lat: -6.11,
  lng: 106.15,
};

const now = Date.parse("2026-10-11T10:00:00Z");

// ---- 1) Jarak haversine: titik sama = 0, geser ~111 km per derajat lintang --
check("jarak titik sama = 0 m", distanceMeters({ lat: -6.11, lng: 106.15 }, { lat: -6.11, lng: 106.15 }) === 0);
check(
  "1 derajat lintang ≈ 111 km",
  Math.abs(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 300,
  String(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }))
);

// ---- 2) Urutan: on-duty segar terdekat dulu, tanpa lokasi di belakang -------
const techs = [
  { id: "jauh", name: "Budi", service_area: "serang", skill: "ac" }, // ~20 km
  { id: "dekat", name: "Citra", service_area: "serang", skill: "ac" }, // ~1,1 km
  { id: "tanpa-lokasi", name: "Adi", service_area: "serang", skill: "ac" },
];
const locations = [
  { technician_id: "jauh", lat: -6.29, lng: 106.15, updated_at: "2026-10-11T09:55:00Z" },
  { technician_id: "dekat", lat: -6.12, lng: 106.15, updated_at: "2026-10-11T09:30:00Z" },
];
const ranked = rankTechniciansByDistance(techs, locations, booking, { limit: 5, now });
check(
  "urutan: terdekat → terjauh → tanpa lokasi",
  ranked.map((t) => t.id).join(",") === "dekat,jauh,tanpa-lokasi",
  ranked.map((t) => `${t.id}(${t.distance_m}m)`).join(" ")
);
check("jarak terdekat dihitung benar", ranked[0].distance_m > 1000 && ranked[0].distance_m < 1200, String(ranked[0].distance_m));
check("tanpa lokasi → distance_m null", ranked[2].distance_m === null);

// ---- 3) Lokasi basi (> 2 jam) tidak dipakai untuk urutan --------------------
const basi = rankTechniciansByDistance(
  techs,
  [{ technician_id: "jauh", lat: -6.29, lng: 106.15, updated_at: "2026-10-11T06:00:00Z" }],
  booking,
  { limit: 5, now }
);
check(
  "lokasi lebih tua dari 2 jam diabaikan",
  basi.find((t) => t.id === "jauh").distance_m === null,
  `${LOCATION_FRESH_MS / 3600000} jam`
);

// ---- 4) Batas jumlah penerima (limit) ---------------------------------------
const lim = rankTechniciansByDistance(techs, locations, booking, { limit: 2, now });
check("limit memotong daftar penerima", lim.length === 2 && lim[0].id === "dekat");

// ---- 5) Tanpa pin pesanan: tidak ada urutan jarak, kandidat tetap dikirim ---
const tanpaPin = rankTechniciansByDistance(techs, locations, { lat: null, lng: null }, { limit: 5, now });
check("pesanan tanpa pin → semua distance_m null", tanpaPin.every((t) => t.distance_m === null));

// ---- 6) Alur lengkap dengan klien & pengirim push palsu ---------------------
async function offerWith(overrides) {
  const terkirim = [];
  const res = await offerReleasedJobToNearestTechnicians(booking, {
    serviceName: "Isi / Tambah Freon",
    serviceId: "svc-1",
    excludeUserId: "yang-melepas",
    client: fakeAdmin(overrides),
    send: async (userId, payload) => terkirim.push({ userId, payload }),
  });
  return { res, terkirim };
}

const dasar = {
  techs: [
    { id: "dekat", name: "Citra", service_area: "serang", skill: "ac" },
    { id: "yang-melepas", name: "Agus", service_area: "serang", skill: "ac" },
    { id: "beda-keahlian", name: "Dedi", service_area: "serang", skill: "kebersihan" },
    { id: "beda-area", name: "Eka", service_area: "bandung", skill: "ac" },
    { id: "bukan-teknisi-lolos", name: "Fitri", service_area: "", skill: "" },
  ],
  // Stempel waktu relatif terhadap SEKARANG, bukan tanggal tetap: jalur ujung-ke-
  // ujung di bawah tidak punya seam `now` (aturan umur lokasi dihitung dari jam
  // nyata di src/lib/job-offer.js), sehingga tanggal mati membuat lokasinya
  // terbaca BASI dan `nearest_m` jadi null — pemeriksaannya gagal karena kalender,
  // bukan karena aturan jarak rusak.
  locations: [
    {
      technician_id: "dekat",
      lat: -6.12,
      lng: 106.15,
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
  ],
  service: { category_id: "ac", categories: { name: "Service AC" } },
};

const { res, terkirim } = await offerWith(dasar);
check("penerima tepat (keahlian + area cocok, yang melepas dikecualikan)",
  [...new Set(terkirim.map((t) => t.userId))].sort().join(",") === "bukan-teknisi-lolos,dekat",
  terkirim.map((t) => t.userId).join(","));
check("yang melepas tugasnya sendiri TIDAK ditawari", !terkirim.some((t) => t.userId === "yang-melepas"));
check("keahlian beda tidak ditawari", !terkirim.some((t) => t.userId === "beda-keahlian"));
check("area beda tidak ditawari", !terkirim.some((t) => t.userId === "beda-area"));
check("laporan hasil: offered & matched", res.offered === 2 && res.matched === 2, JSON.stringify(res));
check("jarak terdekat dilaporkan", res.nearest_m > 1000 && res.nearest_m < 1200, String(res.nearest_m));
check(
  "payload push: judul, event preferensi, rute teknisi, tag per pesanan",
  terkirim[0].payload.title === "Tugas tersedia untukmu" &&
    terkirim[0].payload.event === "new_job_available" &&
    terkirim[0].payload.url === "/technician" &&
    terkirim[0].payload.tag === "job-b-1",
  JSON.stringify(terkirim[0].payload)
);
check("body memuat layanan, kode, dan alamat", terkirim[0].payload.body.includes("SV-5045") && terkirim[0].payload.body.includes("serang"));

// ---- 7) Tidak ada kandidat → tidak ada push (bukan error) -------------------
const kosong = await offerWith({ techs: [], locations: [], service: null });
check("tanpa teknisi: offered 0 & tanpa push", kosong.res.offered === 0 && kosong.terkirim.length === 0);

// ---- 8) Hanya teknisi yang melepas → tidak ditawari siapa pun ---------------
const hanyaDiri = await offerWith({
  techs: [{ id: "yang-melepas", name: "Agus", service_area: "serang", skill: "ac" }],
  locations: [],
  service: { category_id: "ac", categories: { name: "Service AC" } },
});
check("hanya dirinya sendiri → offered 0", hanyaDiri.res.offered === 0 && hanyaDiri.terkirim.length === 0);

// ---- 9) Gagal push tidak melempar keluar ------------------------------------
const gagalKirim = await offerReleasedJobToNearestTechnicians(booking, {
  serviceName: "Service AC",
  serviceId: "svc-1",
  excludeUserId: "yang-melepas",
  client: fakeAdmin(dasar),
  send: async () => {
    throw new Error("push meledak");
  },
});
check("pengirim push melempar → tetap dianggap terkirim (fire-and-forget)", gagalKirim.offered === 2, JSON.stringify(gagalKirim));

console.log(`\n${checks - failures.length}/${checks} pemeriksaan lulus.`);
if (failures.length) {
  console.log(`GAGAL: ${failures.join("; ")}`);
  console.log("JOB_OFFER_GAGAL");
  process.exit(1);
}
console.log("JOB_OFFER_LULUS");
