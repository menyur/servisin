#!/usr/bin/env node
// ============================================================================
// verify-account-security.mjs — probe KEAMANAN SIKLUS HIDUP AKUN.
//
// Menjawab dua pertanyaan yang kegagalannya SENYAP (tidak ada error, tidak ada
// tes merah, dan UI tetap tampak normal):
//
//   1. "Akun sudah dihapus, kok masih bisa masuk?" — penghapusan di proyek ini
//      bukan `delete from auth.users`, melainkan anonimkan profil + ganti surel
//      auth jadi tombstone + ban (lihat src/lib/account-deletion.js). Bila salah
//      satu langkah pencabutan itu tidak berlaku (kunci service tidak terbaca,
//      Admin API menolak, atau ban-nya kedaluwarsa), akunnya tetap bisa masuk
//      dengan kredensial lama — sementara permintaan hapusnya sudah ditutup
//      sebagai 'selesai', jadi tidak ada yang menunggu untuk diperiksa lagi.
//      Sejak supabase/migrate-account-revocation.sql, hasil pencabutan DICATAT
//      di baris permintaan (akses_dicabut/sesi_dicabut) — probe ini memeriksa
//      kolom itu SEKALIGUS keadaan akunnya, karena kolom bisa saja bilang aman
//      sementara akunnya masih bisa masuk (atau sebaliknya).
//
//   2. "Masuk kok disapa 'Kawan'?" — sapaan itu cadangan di aplikasi saat
//      `Api.myProfile()` tidak menemukan baris profil (home_screen.dart). Artinya
//      ada SESI yang sah tanpa baris profiles: pengguna bisa masuk, memesan, dan
//      memakai aplikasi sebagai orang tanpa identitas (role pun terbaca kosong),
//      tetapi TIDAK bisa mengajukan hapus akun karena penjaga SQL
//      `hapus_akun_blokir` menjawab 'profil_tidak_ada'.
//
// Mode:
//   node scripts/verify-account-security.mjs --selftest  → statis, tanpa jaringan
//   node scripts/verify-account-security.mjs             → LIVE, READ-ONLY
//   node scripts/verify-account-security.mjs --detail    → LIVE + fakta tiap akun
//                                                          bermasalah (untuk diperbaiki manual)
//
// Mode live TIDAK menulis apa pun: hanya `auth.admin.listUsers` + SELECT ke
// `profiles` dan `account_deletion_requests`. Tidak ada akun/baris uji yang
// dibuat, tidak ada yang diubah — jadi aman dijalankan kapan pun, termasuk di
// produksi. Surel selalu disamarkan (maskEmail) agar laporan bisa ditempel ke
// tiket tanpa membocorkan alamat.
//
// Exit: 0 bersih (mungkin ada catatan) · 5 ada temuan KRITIS · 3 tanpa
//       kredensial · 1 error tak terduga.
// ============================================================================
import { readFileSync } from "node:fs";
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";
import {
  maskEmail,
  kelasPencabutan,
  catatPencabutan,
  cobaUlangPencabutan,
  ringkasEksekusi,
  tombstoneUntuk,
} from "../src/lib/account-deletion.js";

const ARGS = process.argv.slice(2);
const SELFTEST = ARGS.includes("--selftest");
const DETAIL = ARGS.includes("--detail");

/** Prefiks surel tombstone (lihat eksekusi_hapus_akun di SQL). */
export const PREFIX_TOMBSTONE = "dihapus+";

/** Domain tombstone — RFC 2606, sengaja tidak bisa menerima surel. */
export const DOMAIN_TOMBSTONE = "@fixify.invalid";

const POLA_TOMBSTONE = new RegExp(
  `^${PREFIX_TOMBSTONE.replace("+", "\\+")}[0-9a-f]{12}${DOMAIN_TOMBSTONE.replace(".", "\\.")}$`
);

/** Rapikan surel untuk perbandingan. Murni. */
export function rapikanSurel(nilai) {
  return String(nilai ?? "").trim().toLowerCase();
}

/** Apakah surel ini tombstone hasil penghapusan akun? Murni. */
export function tombstoneSah(nilai) {
  return POLA_TOMBSTONE.test(rapikanSurel(nilai));
}

/** Ban masih berlaku? Murni (tanpa jam sistem). */
export function banAktif(bannedUntil, sekarangMs) {
  if (!bannedUntil) return false;
  const t = Date.parse(bannedUntil);
  return Number.isFinite(t) && t > sekarangMs;
}

/** Pencabutan akses dianggap berlaku bila surel sudah tombstone ATAU akun dibanned. */
export function aksesDicabut(akun, sekarangMs) {
  return tombstoneSah(akun?.email) || banAktif(akun?.banned_until, sekarangMs);
}

/**
 * Pemetaan seluruh data → daftar temuan. MURNI: tidak menyentuh database, jadi
 * aturan yang sama bisa diuji di CI tanpa kredensial (lihat --selftest).
 *
 * @param {object} o
 * @param {Array} o.akunAuth   hasil listUsers: {id, email, banned_until, is_anonymous, app_metadata}
 * @param {Array} o.profil     baris profiles: {id, email, name}
 * @param {Array} o.permintaan baris account_deletion_requests: {id, user_id, email, status, decided_at, akses_dicabut, sesi_dicabut}
 * @param {number} [o.sekarangMs]
 * @param {boolean} [o.jejakPencabutanTersedia]  false = kolom jejaknya belum ada
 *   (migrasi belum dijalankan) → pemeriksaan jejak dilewati, TIDAK dianggap
 *   "tanpa catatan", sebab tidak ada kolomnya yang bisa dibaca.
 * @returns {{temuan: Array<{kode:string, tingkat:"kritis"|"perhatian"|"info", judul:string, jumlah:number, contoh:Array<string>, saran:string}>}}
 */
export function analisaSiklusAkun({
  akunAuth = [],
  profil = [],
  permintaan = [],
  sekarangMs = Date.now(),
  jejakPencabutanTersedia = true,
} = {}) {
  const temuan = [];
  const tambah = (kode, tingkat, judul, daftar, saran) => {
    if (!daftar.length) return;
    temuan.push({ kode, tingkat, judul, jumlah: daftar.length, contoh: daftar.slice(0, 5), saran });
  };

  const profilById = new Map(profil.map((p) => [p.id, p]));
  const authById = new Map(akunAuth.map((u) => [u.id, u]));

  // --- 1) Sesi tanpa baris profil → sapaan "Kawan" (temuan utama playlist) ---
  const tanpaProfil = [];
  const sisaTombstone = [];
  const anonTanpaSurel = [];
  for (const u of akunAuth) {
    if (profilById.has(u.id)) continue;
    if (u.is_anonymous || !rapikanSurel(u.email)) anonTanpaSurel.push(`id ${u.id}`);
    else if (tombstoneSah(u.email)) sisaTombstone.push(`id ${u.id} · ${maskEmail(u.email)}`);
    else tanpaProfil.push(`id ${u.id} · ${maskEmail(u.email)}`);
  }
  tambah(
    "sesi_tanpa_profil",
    "kritis",
    "Sesi sah TANPA baris profiles (aplikasi menyapa \"Kawan\")",
    tanpaProfil,
    "Jalankan ulang trigger handle_new_user untuk akun itu (atau buat baris profiles-nya), " +
      "lalu perbaiki penyebabnya: Google OAuth yang gagal menulis profil, atau baris profil " +
      "yang terhapus sementara akun auth-nya tertinggal."
  );
  tambah(
    "sisa_tombstone_tanpa_profil",
    "info",
    "Akun tombstone (sudah dihapus) yang baris profilnya hilang",
    sisaTombstone,
    "Sisa dari penghapusan akun yang tidak menutup rapi — baris profil seharusnya tetap ada " +
      "dalam bentuk teranonimkan. Periksa apakah ada yang menghapus `auth.users` langsung di dashboard."
  );
  tambah(
    "sisa_anon_tanpa_surel",
    "info",
    "Akun tanpa surel (kira-kira anonymous sign-in)",
    anonTanpaSurel,
    "Bila anonymous sign-in masih aktif di Authentication → Providers, matikan (probe F3 di " +
      "scripts/audit-go-live-checks.mjs). profiles.email NOT NULL membuat akun ini tanpa profil."
  );

  // --- 2) Permintaan 'selesai' yang akunnya MASIH bisa masuk (inti keluhan) ---
  const masihBisaMasuk = [];
  const tombstoneTanpaBan = [];
  for (const u of akunAuth) {
    if (tombstoneSah(u.email) && !banAktif(u.banned_until, sekarangMs)) {
      tombstoneTanpaBan.push(`id ${u.id} · ${maskEmail(u.email)}`);
    }
  }
  for (const r of permintaan) {
    if (r.status !== "selesai" || !r.user_id) continue;
    const u = authById.get(r.user_id);
    if (!u) continue;
    if (!aksesDicabut(u, sekarangMs)) {
      const provider = (u.app_metadata?.providers || []).filter((p) => p !== "email");
      masihBisaMasuk.push(
        `permintaan ${r.id} · id ${u.id} · ${maskEmail(u.email)}` +
          (provider.length ? ` · provider lain: ${provider.join(",")}` : "")
      );
    }
  }
  tambah(
    "hapus_selesai_tapi_masih_bisa_masuk",
    "kritis",
    "Permintaan hapus berstatus 'selesai' tetapi akses masuknya belum tercabut",
    masihBisaMasuk,
    "Akun ini masih bisa masuk dengan surel + kata sandi lamanya. Cabut sekarang: ganti surel auth " +
      "jadi tombstone DAN ban akunnya (npm run hapus-akun -- --eksekusi=<id> --ya akan menolak " +
      "karena statusnya sudah 'selesai' — lakukan lewat Supabase → Authentication, atau perbaiki " +
      "pencabutan di src/lib/account-deletion.js lalu tandai permintaannya untuk dijalankan ulang)."
  );
  tambah(
    "tombstone_tanpa_ban",
    "kritis",
    "Surel auth sudah tombstone tetapi akunnya tidak dibanned",
    tombstoneTanpaBan,
    "Pencabutan setengah jalan: surel aslinya sudah tidak bisa dipakai, tetapi ban adalah lapis " +
      "kedua yang menahan kata sandi lama dan identitas provider (Google). Ban ulang akun itu."
  );

  // --- 2b) Jejak pencabutan: kolom vs keadaan akunnya yang sesungguhnya ---
  //
  // Dua sumber ini bisa berbeda arah, dan keduanya perlu dilaporkan berbeda:
  //   * kolom bilang gagal + akun memang masih bisa masuk → KRITIS (nyata);
  //   * kolom bilang gagal + akun sudah tidak bisa masuk → jejak menyimpang (info);
  //   * kolom kosong (permintaan lama) → tidak ada catatan (perhatian).
  // "Tidak ada catatan" sengaja TIDAK dianggap aman: keadaan akunnya yang
  // menentukan, dan itulah yang diperiksa di sini.
  if (jejakPencabutanTersedia) {
    const pencabutanGagal = [];
    const sesiBelumDiputus = [];
    const jejakHilang = [];
    const jejakMenyimpang = [];
    // Sesi lama hanya relevan dalam jendela ini: access token berumur pendek
    // (bawaan 1 jam), jadi penghapusan yang sudah lama tidak lagi bisa dipakai
    // walau baris sesinya dulu tertinggal — melaporkannya sebagai masalah hanya
    // akan menjadi derau.
    const JENDELA_SESI_MS = 24 * 3600_000;

    for (const r of permintaan) {
      if (r.status !== "selesai" || !r.user_id) continue;
      const u = authById.get(r.user_id);
      if (!u) continue; // akunnya sudah tidak ada → tidak ada yang bisa dicabut
      const nyata = aksesDicabut(u, sekarangMs);

      if (r.akses_dicabut === false) {
        if (nyata) jejakMenyimpang.push(`permintaan ${r.id} · id ${u.id} · kolom bilang gagal, akun sudah terkunci`);
        else pencabutanGagal.push(`permintaan ${r.id} · id ${u.id} · ${maskEmail(u.email)}`);
      } else if (r.akses_dicabut == null) {
        jejakHilang.push(`permintaan ${r.id} · id ${u.id}${nyata ? "" : " · dan akunnya SEKARANG masih bisa masuk"}`);
      }

      const kapan = Date.parse(r.decided_at || r.dicabut_pada || "");
      const masihRelevan = Number.isFinite(kapan) ? sekarangMs - kapan < JENDELA_SESI_MS : true;
      if (nyata && r.sesi_dicabut !== true && masihRelevan) {
        sesiBelumDiputus.push(`permintaan ${r.id} · id ${u.id}${r.sesi_dicabut === false ? " · dicoba, gagal" : ""}`);
      }
    }

    tambah(
      "pencabutan_gagal",
      "kritis",
      "Permintaan 'selesai' yang pencabutannya TERCATAT gagal — akunnya masih bisa masuk",
      pencabutanGagal,
      "Cabut sekarang: npm run hapus-akun -- --cabut=<id> --ya (data yang sudah dianonimkan tidak disentuh lagi)."
    );
    tambah(
      "sesi_belum_diputus",
      "perhatian",
      "Sesi lama belum diputus (akses masuk sudah ditutup, sesi berjalan belum)",
      sesiBelumDiputus,
      "Sesi itu masih bisa dipakai paling lama sampai access token-nya kedaluwarsa. Ulangi: " +
        "npm run hapus-akun -- --cabut=<id> --ya — bila menolak, jalankan supabase/migrate-account-revocation.sql."
    );
    tambah(
      "jejak_pencabutan_hilang",
      "perhatian",
      "Permintaan 'selesai' TANPA catatan pencabutan (dijalankan sebelum jejaknya ada)",
      jejakHilang,
      "Periksa per akun: keadaan akunnya sudah benar atau belum. Ke depan, jalur penghapusan menulis " +
        "jejaknya sendiri (supabase/migrate-account-revocation.sql)."
    );
    tambah(
      "jejak_pencabutan_menyimpang",
      "info",
      "Jejak bilang gagal, padahal akunnya sudah terkunci (dibetulkan manual?)",
      jejakMenyimpang,
      "Tidak berbahaya, tetapi jejak yang menyimpang membuat pemeriksaan berikutnya salah menilai. " +
        "Jalankan cabut ulang agar kolomnya ikut benar."
    );
  }

  // --- 3) Surel bekas akun terhapus dipakai lagi (keputusan produk, bukan bug) ---
  const surelAuth = new Map();
  for (const u of akunAuth) {
    const s = rapikanSurel(u.email);
    if (!s) continue;
    if (!surelAuth.has(s)) surelAuth.set(s, []);
    surelAuth.get(s).push(u);
  }
  const bekasDipakaiLagi = [];
  for (const r of permintaan) {
    if (r.status !== "selesai") continue;
    const s = rapikanSurel(r.email);
    if (!s || tombstoneSah(s)) continue;
    for (const u of surelAuth.get(s) || []) {
      if (u.id !== r.user_id) bekasDipakaiLagi.push(`${maskEmail(s)} → id ${u.id}`);
    }
  }
  tambah(
    "surel_bekas_dipakai_lagi",
    "perhatian",
    "Surel bekas akun terhapus sudah dipakai akun baru",
    [...new Set(bekasDipakaiLagi)],
    "Ini memang akibat desain (tombstone membebaskan alamatnya). Yang perlu diputuskan: apakah " +
      "pendaftar yang memakai surel bekas akun terhapus dalam N hari perlu DITANDAI untuk admin — " +
      "supaya riwayat penilaian/penyalahgunaan tidak bisa di-reset hanya dengan hapus akun lalu daftar ulang."
  );

  // --- 4) Satu surel pada ≥2 baris profil → `maybeSingle()` bisa gagal ---
  const perSurel = new Map();
  for (const p of profil) {
    const s = rapikanSurel(p.email);
    if (!s || tombstoneSah(s)) continue;
    if (!perSurel.has(s)) perSurel.set(s, []);
    perSurel.get(s).push(p);
  }
  tambah(
    "surel_ganda_di_profil",
    "perhatian",
    "Satu surel dipakai lebih dari satu baris profiles (tidak ada indeks unik)",
    [...perSurel.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([s, rows]) => `${maskEmail(s)} · ${rows.length} baris`),
    "Pencarian akun memakai `.ilike(\"email\", …).maybeSingle()` (src/lib/account-deletion.js) — " +
      "dua baris membuatnya gagal diam-diam dan permintaan hapus web jatuh ke jalur " +
      "\"tanpa akun\". Pertimbangkan indeks unik parsial untuk surel non-tombstone."
  );

  // --- 5) Surel profil menyimpang dari surel auth ---
  const menyimpang = [];
  for (const p of profil) {
    const u = authById.get(p.id);
    if (!u) continue;
    const sp = rapikanSurel(p.email);
    const sa = rapikanSurel(u.email);
    if (tombstoneSah(sp)) continue; // keadaan normal setelah penghapusan akun
    if (sp && sa && sp !== sa) menyimpang.push(`id ${p.id} · profil ${maskEmail(sp)} ≠ auth ${maskEmail(sa)}`);
  }
  tambah(
    "surel_profil_tidak_sinkron",
    "perhatian",
    "Surel di profiles berbeda dari surel di auth.users",
    menyimpang,
    "Identitas bergeser tanpa jalur resmi (tidak ada fitur ganti surel). Periksa apakah ini hasil " +
      "perubahan manual di dashboard — status akun seperti ini membingungkan saat pemeriksaan."
  );

  return { temuan };
}

/** Ringkas temuan → {kritis, perhatian, info}. Murni. */
export function ringkasTemuan(temuan = []) {
  return temuan.reduce(
    (acc, t) => {
      acc[t.tingkat] = (acc[t.tingkat] || 0) + t.jumlah;
      return acc;
    },
    { kritis: 0, perhatian: 0, info: 0 }
  );
}

// ---------------------------------------------------------------------------
// Admin tiruan (tanpa database) untuk menguji jalur pencabutan
// ---------------------------------------------------------------------------

/**
 * Klien admin palsu yang cukup untuk `catatPencabutan`/`cobaUlangPencabutan`.
 * `authUser: null` mensimulasikan akun yang sudah tidak ada.
 */
function fakeAdmin({ baris = null, authUser = { id: "u" } } = {}) {
  const jejak = { update: null, rpc: [], updateUser: null };
  const klien = {
    from(tabel) {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: baris, error: null }),
        update: (payload) => {
          jejak.update = { tabel, payload };
          return { eq: async () => ({ error: null }) };
        },
      };
      return q;
    },
    rpc: async (nama, args) => {
      jejak.rpc.push({ nama, args });
      return { data: { ok: true, sesi: 2, identitas: 1 }, error: null };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: authUser } }),
        updateUserById: async (id, patch) => {
          jejak.updateUser = { id, patch };
          return { error: null };
        },
      },
    },
  };
  return { klien, jejak };
}

/**
 * Penjaga "sesi tanpa profil" hidup di tiga tempat yang tidak bisa diuji lewat
 * data (web, aplikasi, jalur login). Yang diperiksa di sini hanya KEBERADAANNYA —
 * supaya menghapus penjaganya membuat CI merah, bukan membuat sapaan "Kawan"
 * kembali tanpa jejak.
 */
function periksaPenjagaStatis() {
  const baca = (jalur) => {
    try {
      return readFileSync(jalur, "utf8");
    } catch {
      return "";
    }
  };
  const middleware = baca("src/lib/supabase/middleware.js");
  const common = baca("flutter_app/lib/ui/common.dart");
  const loginApp = baca("flutter_app/lib/ui/login_screen.dart");
  const lib = baca("src/lib/account-deletion.js");
  return [
    [
      "web: sesi tanpa profil ditolak (middleware)",
      /AWALAN_WAJIB_PROFIL/.test(middleware) && /profil-tidak-ada/.test(middleware) && /maybeSingle/.test(middleware),
    ],
    [
      "aplikasi: sesi tanpa profil tidak memakai shell biasa",
      /_sesiTanpaProfil/.test(common) && /_SesiTanpaProfilScreen/.test(common),
    ],
    ["aplikasi: login berhenti saat profil tidak ada", /belum punya data profil/.test(loginApp)],
    [
      "penghapusan: sesi/identitas diputus & jejaknya dicatat",
      /cabut_akses_pengguna/.test(lib) && /catatPencabutan\(\{/.test(lib) && /BAN_DURASI/.test(lib),
    ],
  ];
}

// ---------------------------------------------------------------------------
// Mode statis (CI) — aturan di atas diuji tanpa database
// ---------------------------------------------------------------------------
async function selftest() {
  let lulus = 0;
  let gagal = 0;
  const cek = (nama, ok, detail) => {
    if (ok) lulus += 1;
    else gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok || !detail ? "" : ` — ${detail}`}`);
  };

  cek("tombstone sah dikenali", tombstoneSah("dihapus+0123456789ab@fixify.invalid"));
  cek("tombstone dengan panjang salah ditolak", !tombstoneSah("dihapus+123@fixify.invalid"));
  cek("surel biasa bukan tombstone", !tombstoneSah("budi@gmail.com"));
  cek("huruf besar & spasi tetap dikenali", tombstoneSah("  DIHAPUS+ABCDEF012345@fixify.invalid "));

  cek("ban_until di masa depan = aktif", banAktif("2099-01-01T00:00:00Z", Date.parse("2026-10-18")));
  cek("ban_until di masa lalu = tidak aktif", !banAktif("2020-01-01T00:00:00Z", Date.parse("2026-10-18")));
  cek("ban_until kosong = tidak aktif", !banAktif(null, Date.parse("2026-10-18")));

  // Kasus inti: akun dihapus rapi (tombstone + ban + sesi diputus + berjejak) → bersih.
  const rapi = analisaSiklusAkun({
    akunAuth: [{ id: "u1", email: "dihapus+0123456789ab@fixify.invalid", banned_until: "2126-01-01T00:00:00Z" }],
    profil: [{ id: "u1", email: "dihapus+0123456789ab@fixify.invalid", name: "Pengguna dihapus" }],
    permintaan: [
      {
        id: "r1",
        user_id: "u1",
        email: "budi@gmail.com",
        status: "selesai",
        decided_at: new Date().toISOString(),
        akses_dicabut: true,
        sesi_dicabut: true,
      },
    ],
  });
  cek("penghapusan rapi → tanpa temuan", rapi.temuan.length === 0, JSON.stringify(rapi.temuan.map((t) => t.kode)));

  // Kasus 1: sesi tanpa profil (sapaan "Kawan").
  const kawan = analisaSiklusAkun({
    akunAuth: [{ id: "u2", email: "kawan@gmail.com" }],
    profil: [],
    permintaan: [],
  });
  cek(
    "akun tanpa profil → satu temuan KRITIS",
    kawan.temuan.length === 1 && kawan.temuan[0].kode === "sesi_tanpa_profil" && kawan.temuan[0].tingkat === "kritis"
  );

  // Kasus 2: permintaan 'selesai' tetapi akunnya tidak dicabut.
  const lupa = analisaSiklusAkun({
    akunAuth: [{ id: "u3", email: "lupa@gmail.com", app_metadata: { providers: ["email", "google"] } }],
    profil: [{ id: "u3", email: "lupa@gmail.com", name: "Pengguna dihapus" }],
    permintaan: [{ id: "r3", user_id: "u3", email: "lupa@gmail.com", status: "selesai" }],
  });
  cek(
    "hapus 'selesai' tapi akses belum dicabut → KRITIS",
    lupa.temuan.some((t) => t.kode === "hapus_selesai_tapi_masih_bisa_masuk" && t.tingkat === "kritis"),
    JSON.stringify(lupa.temuan.map((t) => t.kode))
  );

  // Kasus 3: tombstone tanpa ban.
  const setengah = analisaSiklusAkun({
    akunAuth: [{ id: "u4", email: "dihapus+aaaabbbbcccc@fixify.invalid", banned_until: null }],
    profil: [{ id: "u4", email: "dihapus+aaaabbbbcccc@fixify.invalid", name: "Pengguna dihapus" }],
    permintaan: [],
  });
  cek(
    "tombstone tanpa ban → KRITIS",
    setengah.temuan.some((t) => t.kode === "tombstone_tanpa_ban" && t.tingkat === "kritis")
  );

  // Kasus 4: surel bekas dipakai lagi.
  const dipakaiLagi = analisaSiklusAkun({
    akunAuth: [
      { id: "u5", email: "dihapus+111122223333@fixify.invalid", banned_until: "2126-01-01T00:00:00Z" },
      { id: "u6", email: "bekas@gmail.com" },
    ],
    profil: [
      { id: "u5", email: "dihapus+111122223333@fixify.invalid", name: "Pengguna dihapus" },
      { id: "u6", email: "bekas@gmail.com", name: "Orang Baru" },
    ],
    permintaan: [{ id: "r5", user_id: "u5", email: "bekas@gmail.com", status: "selesai" }],
  });
  cek(
    "surel bekas dipakai lagi → catatan (bukan kritis)",
    dipakaiLagi.temuan.some((t) => t.kode === "surel_bekas_dipakai_lagi" && t.tingkat === "perhatian") &&
      ringkasTemuan(dipakaiLagi.temuan).kritis === 0
  );

  // Kasus 4b: jejak pencabutan.
  const jejakGagal = analisaSiklusAkun({
    akunAuth: [{ id: "u10", email: "sisa@gmail.com" }],
    profil: [{ id: "u10", email: "sisa@gmail.com", name: "Pengguna dihapus" }],
    permintaan: [
      {
        id: "r10",
        user_id: "u10",
        email: "sisa@gmail.com",
        status: "selesai",
        decided_at: new Date().toISOString(),
        akses_dicabut: false,
        sesi_dicabut: false,
      },
    ],
  });
  cek(
    "jejak pencabutan gagal → KRITIS",
    jejakGagal.temuan.some((t) => t.kode === "pencabutan_gagal" && t.tingkat === "kritis"),
    JSON.stringify(jejakGagal.temuan.map((t) => t.kode))
  );

  const sesiTertinggal = analisaSiklusAkun({
    akunAuth: [{ id: "u11", email: "dihapus+dddd00001111@fixify.invalid", banned_until: "2126-01-01T00:00:00Z" }],
    profil: [{ id: "u11", email: "dihapus+dddd00001111@fixify.invalid", name: "Pengguna dihapus" }],
    permintaan: [
      {
        id: "r11",
        user_id: "u11",
        email: "baru@gmail.com",
        status: "selesai",
        decided_at: new Date().toISOString(),
        akses_dicabut: true,
        sesi_dicabut: null,
      },
    ],
  });
  cek(
    "sesi belum diputus → perhatian (bukan kritis)",
    sesiTertinggal.temuan.some((t) => t.kode === "sesi_belum_diputus" && t.tingkat === "perhatian") &&
      ringkasTemuan(sesiTertinggal.temuan).kritis === 0,
    JSON.stringify(sesiTertinggal.temuan.map((t) => `${t.kode}:${t.tingkat}`))
  );

  const sesiKedaluwarsa = analisaSiklusAkun({
    akunAuth: [{ id: "u12", email: "dihapus+eeee00001111@fixify.invalid", banned_until: "2126-01-01T00:00:00Z" }],
    profil: [{ id: "u12", email: "dihapus+eeee00001111@fixify.invalid", name: "Pengguna dihapus" }],
    permintaan: [
      {
        id: "r12",
        user_id: "u12",
        email: "lama@gmail.com",
        status: "selesai",
        decided_at: "2026-09-01T00:00:00Z",
        akses_dicabut: true,
        sesi_dicabut: null,
      },
    ],
  });
  cek(
    "permintaan lama tidak dianggap masalah sesi",
    !sesiKedaluwarsa.temuan.some((t) => t.kode === "sesi_belum_diputus"),
    JSON.stringify(sesiKedaluwarsa.temuan.map((t) => t.kode))
  );

  const tanpaKolom = analisaSiklusAkun({
    akunAuth: [{ id: "u13", email: "apa@gmail.com" }],
    profil: [{ id: "u13", email: "apa@gmail.com", name: "X" }],
    permintaan: [{ id: "r13", user_id: "u13", email: "apa@gmail.com", status: "selesai" }],
    jejakPencabutanTersedia: false,
  });
  cek(
    "tanpa kolom jejak, pemeriksaan jejak dilewati (bukan dianggap aman/gagal)",
    !tanpaKolom.temuan.some((t) => /pencabutan|sesi_belum/.test(t.kode)),
    JSON.stringify(tanpaKolom.temuan.map((t) => t.kode))
  );

  // Kasus 5: surel ganda di profiles.
  const ganda = analisaSiklusAkun({
    akunAuth: [
      { id: "u7", email: "sama@gmail.com" },
      { id: "u8", email: "sama@gmail.com" },
    ],
    profil: [
      { id: "u7", email: "sama@gmail.com", name: "A" },
      { id: "u8", email: "sama@gmail.com", name: "B" },
    ],
    permintaan: [],
  });
  cek(
    "surel ganda terdeteksi",
    ganda.temuan.some((t) => t.kode === "surel_ganda_di_profil" && t.jumlah === 1),
    JSON.stringify(ganda.temuan.map((t) => t.kode))
  );

  // --- Jejak pencabutan (aturan lib, pakai admin tiruan) ---
  cek(
    "tombstoneUntuk deterministik & berbentuk sama dengan SQL",
    tombstoneUntuk("4b709e50-8615-48f1-b40d-9f65584f2f14") === "dihapus+4b709e508615@fixify.invalid" &&
      tombstoneUntuk("bukan-uuid") === null
  );

  cek(
    "kelasPencabutan membedakan gagal / tanpa catatan / sesi / aman",
    kelasPencabutan({ status: "selesai", user_id: "u", akses_dicabut: false }) === "akses_gagal" &&
      kelasPencabutan({ status: "selesai", user_id: "u", akses_dicabut: null }) === "belum_dicatat" &&
      kelasPencabutan({ status: "selesai", user_id: "u", akses_dicabut: true, sesi_dicabut: false }) === "sesi_gagal" &&
      kelasPencabutan({ status: "selesai", user_id: "u", akses_dicabut: true, sesi_dicabut: true }) === "aman" &&
      kelasPencabutan({ status: "selesai", user_id: null }) === "tiada_akun" &&
      kelasPencabutan({ status: "diminta", user_id: "u" }) === "bukan_selesai"
  );

  const jejakSukses = fakeAdmin();
  const tulisSukses = await catatPencabutan({
    requestId: "r1",
    aksesDicabut: true,
    sesiDicabut: true,
    admin: jejakSukses.klien,
  });
  cek(
    "catatPencabutan mengisi dicabut_pada hanya saat keduanya berhasil",
    tulisSukses.ok === true &&
      jejakSukses.jejak.update?.payload.akses_dicabut === true &&
      typeof jejakSukses.jejak.update?.payload.dicabut_pada === "string",
    JSON.stringify(jejakSukses.jejak.update?.payload)
  );

  const jejakGagalTulis = fakeAdmin();
  await catatPencabutan({
    requestId: "r2",
    aksesDicabut: true,
    sesiDicabut: false,
    catatan: "sesi: gagal",
    admin: jejakGagalTulis.klien,
  });
  cek(
    "pencabutan separuh jalan tidak menulis dicabut_pada",
    jejakGagalTulis.jejak.update?.payload.dicabut_pada === null &&
      jejakGagalTulis.jejak.update?.payload.catatan_pencabutan === "sesi: gagal"
  );

  const ulangDitolak = await cobaUlangPencabutan({
    requestId: "r3",
    admin: fakeAdmin({ baris: { id: "r3", user_id: "u3", status: "diminta" } }).klien,
  });
  cek("cabut ulang menolak permintaan yang belum 'selesai'", ulangDitolak.ok === false && ulangDitolak.error === "status_bukan_selesai");

  const ulangTanpaAkun = await cobaUlangPencabutan({
    requestId: "r4",
    admin: fakeAdmin({ baris: { id: "r4", user_id: null, status: "selesai" } }).klien,
  });
  cek("cabut ulang menolak permintaan tanpa akun", ulangTanpaAkun.ok === false && ulangTanpaAkun.error === "permintaan_tanpa_akun");

  const ulangSukses = fakeAdmin({
    baris: { id: "r5", user_id: "5b37281a-0d95-4331-9afe-1aea409324b3", status: "selesai" },
  });
  const hasilUlang = await cobaUlangPencabutan({ requestId: "r5", admin: ulangSukses.klien });
  cek(
    "cabut ulang: tombstone + ban + sesi + jejak tercatat",
    hasilUlang.ok === true &&
      hasilUlang.aksesDicabut === true &&
      hasilUlang.sesiDicabut === true &&
      String(ulangSukses.jejak.updateUser?.patch.email).startsWith("dihapus+") &&
      ulangSukses.jejak.updateUser?.patch.ban_duration === "876000h" &&
      ulangSukses.jejak.rpc.some((r) => r.nama === "cabut_akses_pengguna") &&
      ulangSukses.jejak.update?.payload.sesi_dicabut === true,
    JSON.stringify({ rpc: ulangSukses.jejak.rpc.map((r) => r.nama), patch: ulangSukses.jejak.updateUser?.patch })
  );

  const ulangTanpaAkunAuth = fakeAdmin({
    baris: { id: "r6", user_id: "5b37281a-0d95-4331-9afe-1aea409324b3", status: "selesai" },
    authUser: null,
  });
  const hasilTanpaAkun = await cobaUlangPencabutan({ requestId: "r6", admin: ulangTanpaAkunAuth.klien });
  cek(
    "akun yang sudah tidak ada bukan kegagalan (dan tidak di-ban sia-sia)",
    hasilTanpaAkun.ok === true && hasilTanpaAkun.akunAda === false && ulangTanpaAkunAuth.jejak.updateUser === null
  );

  cek(
    "ringkasan: sesi belum diputus = perhatian, bukan sukses",
    ringkasEksekusi({ ok: true, aksesDicabut: true, sesiDicabut: false, galatPemutusan: "x" }).tingkat === "perhatian" &&
      ringkasEksekusi({ ok: true, aksesDicabut: true, sesiDicabut: true }).tingkat === "sukses" &&
      ringkasEksekusi({ ok: true, aksesDicabut: false }).tingkat === "bahaya"
  );

  // --- Penjaga di aplikasi & web harus tetap ada (kontrak statis) ---
  for (const [nama, lulus] of periksaPenjagaStatis()) cek(nama, lulus);

  // Surel tidak pernah dicetak utuh di laporan.
  const contohCetak = analisaSiklusAkun({
    akunAuth: [{ id: "u9", email: "rahasia@gmail.com" }],
    profil: [],
  }).temuan[0].contoh.join(" ");
  cek("contoh temuan menyamarkan surel", !contohCetak.includes("rahasia@gmail.com") && contohCetak.includes("ra"), contohCetak);

  console.log("=".repeat(72));
  console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${lulus}/${lulus + gagal}`);
  process.exit(gagal === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Mode live — READ-ONLY
// ---------------------------------------------------------------------------
async function ambilSemua(admin, tabel, kolom, halaman = 1000) {
  const baris = [];
  for (let dari = 0; dari < 100_000; dari += halaman) {
    const { data, error } = await admin.from(tabel).select(kolom).range(dari, dari + halaman - 1);
    if (error) throw new Error(`${tabel}: ${error.message}`);
    baris.push(...(data || []));
    if (!data || data.length < halaman) break;
  }
  return baris;
}

async function listSemuaUser(admin, halaman = 1000, maksHalaman = 50) {
  const users = [];
  for (let page = 1; page <= maksHalaman; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: halaman });
    if (error) throw new Error(`auth.admin.listUsers: ${error.message}`);
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < halaman) break;
  }
  return users;
}

const IKON = { kritis: "🔴", perhatian: "🟠", info: "ℹ️" };

async function live() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.error(`⏭️  ${err.message}`);
    console.error("Probe ini butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local atau env proses).");
    process.exit(3);
  }

  const admin = makeAdminClient(env);
  console.log("Probe keamanan siklus hidup akun — READ-ONLY (tidak menulis apa pun).");
  console.log("=".repeat(72));

  const akunAuth = await listSemuaUser(admin);
  // `profiles` boleh saja belum punya kolom name (DB lama) — pilih kolom minimum.
  const profil = await ambilSemua(admin, "profiles", "id, email, name");
  let permintaan = [];
  let adaTabelPermintaan = true;
  let jejakPencabutanTersedia = true;
  const KOLOM_PERMINTAAN = "id, user_id, email, status, decided_at";
  try {
    permintaan = await ambilSemua(
      admin,
      "account_deletion_requests",
      `${KOLOM_PERMINTAAN}, akses_dicabut, sesi_dicabut, dicabut_pada, catatan_pencabutan`
    );
  } catch (err) {
    const pesan = String(err?.message || "");
    if (/column .* does not exist|find the column|schema cache/i.test(pesan)) {
      // Migrasi jejak pencabutan belum dijalankan: pemeriksaan keadaan akun TETAP
      // berjalan (itu intinya), hanya kolom jejaknya yang dilewati.
      jejakPencabutanTersedia = false;
      console.error(`⚠️  Kolom jejak pencabutan belum ada (${pesan}).`);
      console.error("   Jalankan supabase/migrate-account-revocation.sql untuk mencatat & memeriksa pencabutan.");
      permintaan = await ambilSemua(admin, "account_deletion_requests", KOLOM_PERMINTAAN).catch(() => []);
    } else {
      adaTabelPermintaan = false;
      console.error(`⚠️  account_deletion_requests tidak terbaca: ${pesan}`);
      console.error("   Jalankan supabase/migrate-account-deletion.sql — tanpa tabel itu pemeriksaan");
      console.error("   \"hapus selesai tapi masih bisa masuk\" tidak bisa dilakukan.");
    }
  }

  console.log(`akun auth: ${akunAuth.length} · baris profiles: ${profil.length} · permintaan hapus: ${permintaan.length}`);
  console.log("-".repeat(72));

  const { temuan } = analisaSiklusAkun({ akunAuth, profil, permintaan, jejakPencabutanTersedia });
  for (const t of temuan) {
    console.log(`${IKON[t.tingkat] || "•"} ${t.judul} — ${t.jumlah}`);
    for (const c of t.contoh) console.log(`   · ${c}`);
    if (t.jumlah > t.contoh.length) console.log(`   · … dan ${t.jumlah - t.contoh.length} lainnya`);
    if (t.tingkat === "kritis") console.log(`   → ${t.saran}`);
  }

  // Fakta per akun, hanya bila diminta: dipakai untuk MEMPERBAIKI akun yang
  // bermasalah (mis. membuat baris profiles yang hilang) tanpa menyentuh data
  // lain. Surel tetap disamarkan.
  if (DETAIL) {
    const profilIds = new Set(profil.map((p) => p.id));
    const bermasalah = akunAuth.filter((u) => !profilIds.has(u.id));
    console.log(`
Detail ${bermasalah.length} akun tanpa baris profiles:`);
    for (const u of bermasalah) {
      const provider = (u.app_metadata?.providers || []).join(", ") || "-";
      console.log(
        `  · ${u.id} · ${maskEmail(u.email)} · provider=${provider} · terkonfirmasi=` +
          `${u.email_confirmed_at ? "ya" : "belum"} · dibuat=${String(u.created_at).slice(0, 10)} · ` +
          `login terakhir=${u.last_sign_in_at ? String(u.last_sign_in_at).slice(0, 10) : "belum pernah"} · ` +
          `banned=${u.banned_until ?? "tidak"}`
      );
      console.log(`    metadata tersimpan: ${JSON.stringify(Object.keys(u.user_metadata || {}))}`);
    }
    console.log("=".repeat(72));
  }

  const ringkas = ringkasTemuan(temuan);
  console.log("=".repeat(72));
  console.log(
    `Ringkasan: ${ringkas.kritis} kritis · ${ringkas.perhatian} perlu perhatian · ${ringkas.info} catatan`
  );
  if (!temuan.length) console.log("✅ Tidak ada temuan — seluruh akun dalam keadaan konsisten.");
  if (!adaTabelPermintaan) console.log("⚠️  Sebagian pemeriksaan dilewati (tabel permintaan hapus tidak ada).");
  console.log("Rekomendasi & cara membacanya: docs/security.md §8.");
  process.exit(ringkas.kritis > 0 ? 5 : 0);
}

if (SELFTEST) await selftest();
else
  live().catch((err) => {
    console.error(`❌ Probe gagal: ${err.message}`);
    process.exit(1);
  });
