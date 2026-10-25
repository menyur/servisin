// ============================================================================
// verify-trip-share-privacy-live.mjs — buktikan GERBANG PRIVASI "teknisi menuju
// lokasi" pada DATABASE, bukan pada berkas.
//
//   npm run verify:trip-share-live        (butuh .env.local: URL + service role)
//
// Yang dibuktikan (tiga hal yang diminta, plus penjagaan lain di jalur yang sama):
//   1. `anon` DITOLAK: RPC pelacakan & berbagi tidak bisa dipanggil tanpa login,
//      dan tabelnya tidak bisa dibaca langsung.
//   2. PELANGGAN LAIN tidak bisa membaca posisi: pemilik pesanan melihat titik
//      teknisi, pemilik pesanan yang berbeda ditolak.
//   3. Posisi basi (>5 menit) & berbagi yang kedaluwarsa TIDAK ditampilkan.
// Ditambah: tidak ada posisi yang terkirim sebelum teknisi menekan \"Berangkat\",
// dan berbagi BERAKHIR SENDIRI begitu teknisi tiba (≤150 m).
//
// Data uji: probe ini MEMBUAT akun & pesanan sementara (email @example.invalid,
// tidak pernah terkirim ke mana pun) dan MENGHAPUSNYA di akhir — termasuk saat
// gagal (blok finally). Tidak ada data pengguna nyata yang dibaca atau diubah.
//
// Exit: 0 lulus · 1 ada temuan · 2 versi lama masih terpasang (fitur tiba &
//        notifikasi "hampir tiba" belum aktif) · 3 tanpa kredensial.
// ============================================================================
import { randomUUID } from "node:crypto";
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  sleep,
  slotUji,
} from "./lib/probe-env.mjs";

let lulus = 0;
let gagal = 0;
let dilewati = 0;
const cek = (label, ok, detail = "") => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const lewati = (label, sebab) => {
  dilewati++;
  console.log(`⏭️  ${label} — dilewati: ${sebab}`);
};

/** Titik uji: dekat kota Serang; pesanan dipasang di titik yang sama + 3 km. */
const TITIK_PESANAN = { lat: -6.118, lng: 106.151 };
/** ±3 km di utara titik pesanan (untuk uji \"jauh\"). */
const TITIK_JAUH = { lat: -6.145, lng: 106.151 };
/** ±500 m dari titik pesanan (untuk uji \"hampir tiba\"). */
const TITIK_DEKAT = { lat: -6.1225, lng: 106.151 };

/** Pesan error PostgREST yang berarti fungsinya belum ada di database. */
const belumAda = (e) =>
  /does not exist|schema cache|PGRST202|Could not find the function/i.test(e?.message || "");

/**
 * Versi LAMA fungsi terpasang: berhasil dipanggil tetapi jawabannya belum
 * membawa jarak/tiba (`distance_m`/`arrived`). Ini bukan kegagalan privasi —
 * hanya berarti berkas migrasinya perlu dijalankan ULANG (idempoten) supaya
 * fitur jarak & tiba-otomatis ikut terpasang. Dibedakan supaya laporan tidak
 * menakutkan pemilik dengan "gerbang bocor" padahal gerbangnya benar.
 *
 * Tetap TIDAK boleh dilaporkan sebagai lulus: dalam keadaan ini fitur yang
 * diminta pengguna (berhenti otomatis saat tiba + notifikasi "hampir tiba")
 * memang belum bekerja di produksi, jadi probe keluar dengan kode 2.
 */
let versiLamaTerpasang = false;
const versiLama = (d) => {
  const lama = d?.ok === true && d?.arrived === undefined;
  if (lama) versiLamaTerpasang = true;
  return lama;
};
const PESAN_VERSI_LAMA =
  "versi lama masih terpasang — jalankan ULANG supabase/migrate-technician-trip-share.sql";

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    console.log(
      "⏭️  Lewati probe live: kredensial tidak lengkap.",
      "\n   Butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY di .env.local",
      `\n   (${e.message})`
    );
    return 3;
  }

  const admin = makeAdminClient(env);
  // Slot besok yang masih punya kuota: pesanan uji tidak boleh gagal hanya
  // karena slot "hari ini 08:00-10:00" kebetulan sudah penuh oleh pesanan nyata.
  const slot = await slotUji(admin);
  const anon = makeAnonClient(env);
  const users = [];
  let bookingId = null;

  console.log("Gerbang privasi \"teknisi menuju lokasi\" (LIVE, database nyata)");
  console.log("=".repeat(74));

  try {
    // -----------------------------------------------------------------------
    // 0) Migrasi sudah dijalankan?
    // -----------------------------------------------------------------------
    const cekAda = await admin.rpc("booking_technician_position", {
      p_booking: randomUUID(),
    });
    if (cekAda.error && belumAda(cekAda.error)) {
      cek("migrasi technician-trip-share sudah dijalankan", false, cekAda.error.message);
      console.log(
        "\n   Jalankan supabase/migrate-technician-trip-share.sql lebih dulu",
        "\n   (lalu supabase/fix-rpc-grants-public.sql untuk izin EXECUTE-nya)."
      );
      return 1;
    }
    cek(
      "RPC hidup dan menolak pemanggil tanpa sesi",
      cekAda.data?.ok === false && /login/i.test(cekAda.data?.error || ""),
      JSON.stringify(cekAda.data ?? cekAda.error?.message)
    );

    // -----------------------------------------------------------------------
    // 1) anon ditolak
    // -----------------------------------------------------------------------
    const batal = randomUUID();
    const anonBaca = await anon.rpc("booking_technician_position", { p_booking: batal });
    cek(
      "anon DITOLAK membaca posisi",
      anonBaca.error != null || anonBaca.data?.ok === false,
      anonBaca.error?.message ?? JSON.stringify(anonBaca.data)
    );

    const anonMulai = await anon.rpc("start_trip_share", { p_booking: batal });
    cek(
      "anon DITOLAK memulai berbagi",
      anonMulai.error != null || anonMulai.data?.ok === false,
      anonMulai.error?.message ?? JSON.stringify(anonMulai.data)
    );

    const anonKirim = await anon.rpc("push_trip_position", {
      p_booking: batal,
      p_lat: TITIK_JAUH.lat,
      p_lng: TITIK_JAUH.lng,
    });
    cek(
      "anon DITOLAK mengirim posisi",
      anonKirim.error != null || anonKirim.data?.ok === false,
      anonKirim.error?.message ?? JSON.stringify(anonKirim.data)
    );

    const anonTabel = await anon.from("technician_trip_shares").select("booking_id").limit(1);
    cek(
      "anon TIDAK bisa membaca tabel posisi langsung",
      anonTabel.error != null || (anonTabel.data || []).length === 0,
      anonTabel.error?.message ?? `baris: ${(anonTabel.data || []).length}`
    );

    // -----------------------------------------------------------------------
    // 2) Fixture: 2 pelanggan + 1 teknisi + 1 pesanan yang ditugaskan
    // -----------------------------------------------------------------------
    const { data: layanan } = await admin.from("services").select("id").limit(1).maybeSingle();
    if (!layanan?.id) {
      cek("ada satu layanan untuk dipakai membuat pesanan uji", false, "tabel services kosong");
      return 1;
    }

    const custA = await createTempUser(admin, "customer", "probe-pos-cust-a");
    users.push(custA);
    const custB = await createTempUser(admin, "customer", "probe-pos-cust-b");
    users.push(custB);
    const tech = await createTempUser(admin, "technician", "probe-pos-tech");
    users.push(tech);

    const kode = `PROBE-${randomUUID().slice(0, 8).toUpperCase()}`;
    const { data: booking, error: bookingErr } = await admin
      .from("bookings")
      .insert({
        code: kode,
        user_id: custA.id,
        service_id: layanan.id,
        technician_id: tech.id,
        status: "paid",
        booking_date: slot.date,
        booking_time: slot.time,
        address: "Titik uji probe (bukan alamat nyata)",
        subtotal_price: 100000,
        app_fee: 5000,
        total_price: 105000,
        lat: TITIK_PESANAN.lat,
        lng: TITIK_PESANAN.lng,
      })
      .select("id")
      .maybeSingle();
    if (bookingErr || !booking?.id) {
      cek("pesanan uji dibuat", false, bookingErr?.message ?? "tanpa id");
      return 1;
    }
    bookingId = booking.id;

    // Sesi tiap peran.
    const cA = makeUserClient(env);
    const cB = makeUserClient(env);
    const cT = makeUserClient(env);
    const masukA = await cA.auth.signInWithPassword({ email: custA.email, password: custA.password });
    const masukB = await cB.auth.signInWithPassword({ email: custB.email, password: custB.password });
    const masukT = await cT.auth.signInWithPassword({ email: tech.email, password: tech.password });
    cek(
      "sesi uji masuk (2 pelanggan + 1 teknisi)",
      !masukA.error && !masukB.error && !masukT.error,
      [masukA.error?.message, masukB.error?.message, masukT.error?.message].filter(Boolean).join(" · ")
    );

    // -----------------------------------------------------------------------
    // 3) Belum \"Berangkat\" → tidak ada posisi, dan pelanggan diberi tahu sebabnya
    // -----------------------------------------------------------------------
    const sebelumMulai = await cT.rpc("push_trip_position", {
      p_booking: bookingId,
      p_lat: TITIK_JAUH.lat,
      p_lng: TITIK_JAUH.lng,
    });
    cek(
      "teknisi TIDAK bisa mengirim posisi sebelum menekan \"Berangkat\"",
      sebelumMulai.data?.ok === false,
      JSON.stringify(sebelumMulai.data ?? sebelumMulai.error?.message)
    );

    const bacaSebelum = await cA.rpc("booking_technician_position", { p_booking: bookingId });
    cek(
      "pelanggan melihat ALASAN (bukan peta) saat teknisi belum berangkat",
      bacaSebelum.data?.ok === true &&
        bacaSebelum.data?.visible === false &&
        /belum berangkat/i.test(bacaSebelum.data?.reason || ""),
      JSON.stringify(bacaSebelum.data)
    );

    // -----------------------------------------------------------------------
    // 4) Teknisi berangkat → hanya PEMILIK pesanan yang bisa melihat
    // -----------------------------------------------------------------------
    const mulai = await cT.rpc("start_trip_share", { p_booking: bookingId });
    cek("teknisi bisa memulai berbagi untuk pesanannya", mulai.data?.ok === true, JSON.stringify(mulai.data));

    const kirimJauh = await cT.rpc("push_trip_position", {
      p_booking: bookingId,
      p_lat: TITIK_JAUH.lat,
      p_lng: TITIK_JAUH.lng,
    });
    if (versiLama(kirimJauh.data)) {
      lewati("jarak & status \"hampir tiba\" dihitung server", PESAN_VERSI_LAMA);
    } else {
      cek(
        "posisi terkirim + jarak & status \"hampir tiba\" dihitung server",
        kirimJauh.data?.ok === true &&
          kirimJauh.data?.arrived === false &&
          kirimJauh.data?.near === false &&
          Number(kirimJauh.data?.distance_m) > 2000,
        JSON.stringify(kirimJauh.data)
      );
    }

    const bacaA = await cA.rpc("booking_technician_position", { p_booking: bookingId });
    cek(
      "PEMILIK pesanan melihat titik teknisi",
      bacaA.data?.visible === true &&
        Math.abs(Number(bacaA.data?.lat) - TITIK_JAUH.lat) < 1e-6 &&
        Math.abs(Number(bacaA.data?.lng) - TITIK_JAUH.lng) < 1e-6,
      JSON.stringify(bacaA.data)
    );

    const bacaB = await cB.rpc("booking_technician_position", { p_booking: bookingId });
    cek(
      "PELANGGAN LAIN ditolak (bukan pemilik pesanan)",
      bacaB.data?.ok === false && /bukan milikmu/i.test(bacaB.data?.error || ""),
      JSON.stringify(bacaB.data ?? bacaB.error?.message)
    );

    // -----------------------------------------------------------------------
    // 5) Posisi basi (lebih dari 5 menit) tidak ditampilkan
    // -----------------------------------------------------------------------
    const basi = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const setBasi = await admin
      .from("technician_trip_shares")
      .update({ updated_at: basi })
      .eq("booking_id", bookingId);
    cek("posisi dijadikan basi (10 menit) untuk uji", !setBasi.error, setBasi.error?.message);

    const bacaBasi = await cA.rpc("booking_technician_position", { p_booking: bookingId });
    cek(
      "posisi basi TIDAK ditampilkan (visible false + sebabnya)",
      bacaBasi.data?.visible === false && /belum diperbarui/i.test(bacaBasi.data?.reason || ""),
      JSON.stringify(bacaBasi.data)
    );

    // -----------------------------------------------------------------------
    // 6) Berbagi kedaluwarsa tidak ditampilkan, dan teknisi diminta berhenti
    // -----------------------------------------------------------------------
    const lewat = new Date(Date.now() - 60 * 1000).toISOString();
    const setLewat = await admin
      .from("technician_trip_shares")
      .update({ expires_at: lewat })
      .eq("booking_id", bookingId);
    cek("berbagi dibuat kedaluwarsa untuk uji", !setLewat.error, setLewat.error?.message);

    const bacaLewat = await cA.rpc("booking_technician_position", { p_booking: bookingId });
    cek(
      "berbagi kedaluwarsa TIDAK ditampilkan",
      bacaLewat.data?.visible === false && /berakhir/i.test(bacaLewat.data?.reason || ""),
      JSON.stringify(bacaLewat.data)
    );

    const kirimLewat = await cT.rpc("push_trip_position", {
      p_booking: bookingId,
      p_lat: TITIK_DEKAT.lat,
      p_lng: TITIK_DEKAT.lng,
    });
    cek(
      "setelah kedaluwarsa, teknisi ditolak (klien harus berhenti mengirim)",
      kirimLewat.data?.ok === false,
      JSON.stringify(kirimLewat.data)
    );

    // -----------------------------------------------------------------------
    // 7) Tiba otomatis: ≤150 m → perjalanan berakhir dan barisnya DIHAPUS
    // -----------------------------------------------------------------------
    const mulaiLagi = await cT.rpc("start_trip_share", { p_booking: bookingId });
    cek("teknisi bisa memulai perjalanan baru", mulaiLagi.data?.ok === true, JSON.stringify(mulaiLagi.data));

    // Penanda "sekali per perjalanan" untuk notifikasi "hampir tiba". Inilah yang
    // menjaga pelanggan dari notifikasi berulang setelah aplikasi teknisi dibuka
    // ulang (penanda di aplikasi hilang, penanda di database tidak).
    const punyaKolom = await admin
      .from("technician_trip_shares")
      .select("near_notified_at")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (punyaKolom.error) {
      versiLamaTerpasang = true;
      lewati('kolom penanda notifikasi "hampir tiba" (near_notified_at)', PESAN_VERSI_LAMA);
    } else {
      const klaim = () =>
        admin
          .from("technician_trip_shares")
          .update({ near_notified_at: new Date().toISOString() })
          .eq("booking_id", bookingId)
          .is("near_notified_at", null)
          .select("booking_id");
      const klaim1 = await klaim();
      const klaim2 = await klaim();
      cek(
        'notifikasi "hampir tiba" hanya bisa diklaim SEKALI per perjalanan',
        (klaim1.data || []).length === 1 && (klaim2.data || []).length === 0,
        `klaim ke-1: ${(klaim1.data || []).length} baris · klaim ke-2: ${(klaim2.data || []).length} baris`
      );
      // Perjalanan berikutnya harus bisa memberi tahu pelanggan lagi: tanpa reset,
      // satu kali "hampir tiba" akan membungkam semua perjalanan berikutnya.
      const mulaiReset = await cT.rpc("start_trip_share", { p_booking: bookingId });
      const sesudahReset = await admin
        .from("technician_trip_shares")
        .select("near_notified_at")
        .eq("booking_id", bookingId)
        .maybeSingle();
      cek(
        "perjalanan baru mereset penanda — pelanggan bisa diberi tahu lagi",
        mulaiReset.data?.ok === true && sesudahReset.data?.near_notified_at == null,
        `penanda sesudah perjalanan baru: ${sesudahReset.data?.near_notified_at ?? "kosong"}`
      );
    }

    const hampir = await cT.rpc("push_trip_position", {
      p_booking: bookingId,
      p_lat: TITIK_DEKAT.lat,
      p_lng: TITIK_DEKAT.lng,
    });
    if (versiLama(hampir.data)) {
      lewati("\u22641 km → `near` true (pemicu notifikasi \"hampir tiba\")", PESAN_VERSI_LAMA);
    } else {
      cek(
        "≤1 km → `near` true (pemicu notifikasi \"hampir tiba\")",
        hampir.data?.ok === true && hampir.data?.near === true && hampir.data?.arrived === false,
        JSON.stringify(hampir.data)
      );
    }

    const tiba = await cT.rpc("push_trip_position", {
      p_booking: bookingId,
      p_lat: TITIK_PESANAN.lat,
      p_lng: TITIK_PESANAN.lng,
    });
    const sisa = await admin
      .from("technician_trip_shares")
      .select("booking_id")
      .eq("booking_id", bookingId);
    if (versiLama(tiba.data)) {
      lewati("tiba (≤150 m) → perjalanan BERAKHIR SENDIRI", PESAN_VERSI_LAMA);
      lewati("baris posisi DIHAPUS setelah tiba", PESAN_VERSI_LAMA);
    } else {
      cek(
        "tiba (≤150 m) → perjalanan BERAKHIR SENDIRI",
        tiba.data?.ok === true && tiba.data?.arrived === true && tiba.data?.stopped === true,
        JSON.stringify(tiba.data)
      );
      cek(
        "baris posisi DIHAPUS setelah tiba (tidak tersimpan permanen)",
        !sisa.error && (sisa.data || []).length === 0,
        `baris: ${(sisa.data || []).length}`
      );
    }

    // -----------------------------------------------------------------------
    // 8) Pesanan ditutup → berbagi dihapus trigger
    // -----------------------------------------------------------------------
    await cT.rpc("start_trip_share", { p_booking: bookingId });
    await admin.from("bookings").update({ status: "completed" }).eq("id", bookingId);
    await sleep(200);
    const setelahTutup = await admin
      .from("technician_trip_shares")
      .select("booking_id")
      .eq("booking_id", bookingId);
    cek(
      "pesanan selesai → trigger menghapus baris posisi",
      !setelahTutup.error && (setelahTutup.data || []).length === 0,
      `baris: ${(setelahTutup.data || []).length}`
    );

    const bacaTutup = await cA.rpc("booking_technician_position", { p_booking: bookingId });
    cek(
      "pesanan selesai → pelanggan tidak lagi melihat posisi",
      bacaTutup.data?.visible === false,
      JSON.stringify(bacaTutup.data)
    );
  } finally {
    // ---------------------------------------------------------------------
    // Pembersihan — selalu dijalankan, termasuk saat probe gagal di tengah.
    // ---------------------------------------------------------------------
    console.log("-".repeat(74));
    if (bookingId) {
      await admin.from("technician_trip_shares").delete().eq("booking_id", bookingId);
      await admin.from("bookings").delete().eq("id", bookingId);
    }
    const hapus = await deleteTempUsers(admin, users);

    const sisaBooking = bookingId
      ? (await admin.from("bookings").select("id").eq("id", bookingId)).data || []
      : [];
    const sisaPosisi = bookingId
      ? (await admin
          .from("technician_trip_shares")
          .select("booking_id")
          .eq("booking_id", bookingId)).data || []
      : [];
    cek(
      "data uji bersih (pesanan, baris posisi, akun)",
      sisaBooking.length === 0 && sisaPosisi.length === 0 && hapus.every((h) => h.ok),
      `pesanan: ${sisaBooking.length} · posisi: ${sisaPosisi.length} · akun gagal dihapus: ${
        hapus.filter((h) => !h.ok).length
      }`
    );
  }

  console.log("=".repeat(74));
  console.log(`Ringkasan: ${lulus} lulus · ${gagal} gagal · ${dilewati} dilewati`);
  if (gagal === 0 && versiLamaTerpasang) {
    console.log("BELUM SELESAI: gerbang privasi LULUS, tetapi versi lama masih terpasang.");
    console.log("Berhenti-otomatis-saat-tiba & notifikasi \"hampir tiba\" BELUM bekerja");
    console.log("di database ini. Jalankan ULANG (idempoten) di Supabase SQL Editor:");
    console.log("   supabase/migrate-technician-trip-share.sql");
    console.log("lalu ulangi: npm run verify:trip-share-live");
    return 2;
  }
  if (gagal === 0) {
    console.log("LULUS: gerbang privasi terbukti pada database.");
    return 0;
  }
  console.log("GAGAL: ada gerbang yang tidak sesuai harapan.");
  return 1;
}

process.exit(await main());
