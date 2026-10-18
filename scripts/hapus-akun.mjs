#!/usr/bin/env node
// ============================================================================
// hapus-akun.mjs — ALAT OPERASIONAL penghapusan akun.
//
// Jalur permintaannya sudah ada di dua tempat (aplikasi Android & halaman web
// /hapus-akun), tetapi eksekusinya harus dijalankan di server: ia menyentuh
// database dengan service role, mencabut akses masuk lewat Admin API GoTrue, dan
// membuang berkas KTP/foto profil dari Storage. Berkas ini pintunya.
//
//   node scripts/hapus-akun.mjs                       → daftar permintaan terbuka
//   node scripts/hapus-akun.mjs --status=ditolak      → daftar dengan status lain
//   node scripts/hapus-akun.mjs --eksekusi=<id>        → RENCANA saja (dry-run)
//   node scripts/hapus-akun.mjs --eksekusi=<id> --ya   → jalankan sungguhan
//   node scripts/hapus-akun.mjs --belum-dicabut       → permintaan SELESAI yang
//                                                      aksesnya belum tercabut
//   node scripts/hapus-akun.mjs --cabut=<id>           → rencana cabut ulang
//   node scripts/hapus-akun.mjs --cabut=<id> --ya      → cabut ulang sungguhan
//
// Kenapa `--ya` wajib: penghapusan tidak bisa dibatalkan. Tanpa `--ya` skrip
// hanya menampilkan rencana (akun siapa, apa yang dihapus, apa yang disimpan) —
// jadi selalu ada satu langkah sadar sebelum data hilang.
//
// PENCABUTAN ULANG (`--belum-dicabut` / `--cabut=<id>`) menjawab kegagalan yang
// paling sulit terlihat: permintaan sudah ditutup 'selesai' dan datanya sudah
// dianonimkan, TETAPI akses masuknya (atau sesinya) belum tercabut — jadi akun
// "yang sudah dihapus" masih bisa masuk dengan kredensial lamanya. Keadaan itu
// tersimpan di kolom jejak pada account_deletion_requests (lihat
// supabase/migrate-account-revocation.sql). Jalur ini HANYA mencabut akses;
// data yang sudah dianonimkan tidak diubah lagi, jadi aman diulang berkali-kali.
//
// Yang DIHAPUS vs DISIMPAN dijelaskan di docs/account-deletion.md; ringkasnya:
// identitas + konten pribadi dihapus, catatan keuangan/audit tetap ada tanpa nama
// (lihat Kebijakan Privasi /privasi §5).
//
// Exit: 0 berhasil · 1 gagal · 3 tanpa kredensial.
// Tidak pernah mencetak nilai rahasia. Jalankan: npm run hapus-akun
// ============================================================================
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";
import {
  daftarPermintaanHapus,
  eksekusiHapusAkun,
  daftarPencabutanGagal,
  cobaUlangPencabutan,
  kelasPencabutan,
  pesanPencabutan,
} from "../src/lib/account-deletion.js";

const argv = process.argv.slice(2);
const nilaiArg = (nama) => {
  const hit = argv.find((a) => a === `--${nama}` || a.startsWith(`--${nama}=`));
  if (!hit) return null;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
};
const YA = argv.includes("--ya");
const EKSEKUSI = nilaiArg("eksekusi");
const CABUT = nilaiArg("cabut");
const BELUM_DICABUT = argv.includes("--belum-dicabut");
const LIHAT = argv.includes("--daftar");
const STATUS = nilaiArg("status") || (EKSEKUSI || CABUT || BELUM_DICABUT ? null : "diminta");

function gagal(pesan) {
  console.error(`❌ ${pesan}`);
  process.exit(1);
}

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(`⏭️  ${err.message}`);
  console.error("Skrip ini butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local atau env proses).");
  process.exit(3);
}

const admin = makeAdminClient(env);

/** Ringkas satu angka/teks untuk tabel konsol. */
const kolom = (nilai, lebar) => String(nilai ?? "-").slice(0, lebar).padEnd(lebar);

async function daftar() {
  let baris;
  try {
    baris = await daftarPermintaanHapus({ admin, status: STATUS, limit: 100 });
  } catch (err) {
    gagal(
      `Gagal membaca permintaan: ${err.message}\n` +
        "Kalau tabelnya belum ada, jalankan supabase/migrate-account-deletion.sql di SQL Editor."
    );
  }

  console.log(`Permintaan hapus akun (status: ${STATUS || "semua"}) — ${baris.length} baris`);
  console.log("=".repeat(96));
  if (!baris.length) {
    console.log("(kosong) — tidak ada yang menunggu dijalankan.");
    return;
  }

  console.log(
    `${kolom("ID", 38)} ${kolom("DIMINTA", 20)} ${kolom("SUMBER", 10)} ${kolom("SUREL", 30)}`
  );
  for (const r of baris) {
    console.log(
      `${kolom(r.id, 38)} ${kolom(new Date(r.created_at).toISOString().slice(0, 19), 20)} ` +
        `${kolom(r.sumber, 10)} ${kolom(r.email, 30)}`
    );
    if (r.alasan) console.log(`   alasan pengguna: ${r.alasan}`);
    if (r.catatan_admin) console.log(`   catatan: ${r.catatan_admin}`);
  }
  console.log("=".repeat(96));
  console.log("Jalankan satu baris dengan:  npm run hapus-akun -- --eksekusi=<ID> --ya");
}

async function jalankan(requestId) {
  const { data: baris, error } = await admin
    .from("account_deletion_requests")
    .select("id, user_id, email, sumber, alasan, status, created_at, confirmed_at")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    gagal(
      `Gagal membaca permintaan: ${error.message}\n` +
        "Kalau tabelnya belum ada, jalankan supabase/migrate-account-deletion.sql di SQL Editor."
    );
  }
  if (!baris) gagal(`Permintaan ${requestId} tidak ditemukan.`);
  if (baris.status !== "diminta") {
    gagal(`Status permintaan ini "${baris.status}" — hanya yang berstatus "diminta" boleh dijalankan.`);
  }

  console.log(`Permintaan : ${baris.id}`);
  console.log(`Surel      : ${baris.email}`);
  console.log(`Sumber     : ${baris.sumber === "web" ? "halaman web /hapus-akun" : "aplikasi Android"}`);
  console.log(`Diminta    : ${new Date(baris.created_at).toISOString()}`);
  console.log(`Konfirmasi : ${baris.confirmed_at ? new Date(baris.confirmed_at).toISOString() : "(langsung dari aplikasi)"}`);
  if (baris.alasan) console.log(`Alasan     : ${baris.alasan}`);
  console.log("");
  console.log("Rencana (tidak bisa dibatalkan):");
  console.log("  • profil dianonimkan: nama → 'Pengguna dihapus', telepon/foto/alamat/KTP dikosongkan");
  console.log("  • surel pada auth.users diganti tombstone + akun di-banned (akses masuk dicabut)");
  console.log("  • percakapan, lampiran, laporan, token push, dan berkas KTP/foto profil dibuang");
  console.log("  • pesanan tetap ada sebagai catatan audit; isi bebas-teks & lampirannya dihapus");
  console.log("  • saldo/komisi/penilaian tetap ada (pembukuan)");
  console.log("");

  if (!YA) {
    console.log("Ini baru RENCANA. Tambahkan --ya untuk benar-benar menjalankannya:");
    console.log(`  npm run hapus-akun -- --eksekusi=${baris.id} --ya`);
    return 0;
  }

  const hasil = await eksekusiHapusAkun({
    requestId: baris.id,
    catatan: "Dijalankan lewat scripts/hapus-akun.mjs",
    admin,
  });

  if (!hasil.ok) {
    gagal(`Gagal menjalankan: ${hasil.error}${hasil.status ? ` (status: ${hasil.status})` : ""}`);
  }

  if (hasil.tiadaAkun) {
    console.log("✅ Tidak ada akun dengan surel itu — permintaan ditutup tanpa perubahan data.");
    return 0;
  }

  console.log("✅ Penghapusan dijalankan.");
  console.log(`   user_id           : ${hasil.userId}`);
  console.log(`   akses dicabut     : ${hasil.aksesDicabut ? "YA (surel tombstone + banned)" : "TIDAK"}`);
  console.log(
    `   sesi diputus      : ${hasil.sesiDicabut ? "YA" : "TIDAK"}` +
      (hasil.sesiDicabut ? ` (identitas provider dilepas: ${hasil.identitasDilepas ?? 0})` : "")
  );
  console.log(`   jejak pencabutan  : ${hasil.jejakDicatat ? "tercatat" : `GAGAL — ${hasil.galatJejak || "sebab tidak diketahui"}`}`);
  if (!hasil.aksesDicabut) {
    // Ini kegagalan yang serius: data sudah dianonimkan tetapi akun masih bisa
    // dipakai masuk. Jangan pernah disembunyikan.
    console.error(`❗ Akses TIDAK berhasil dicabut: ${hasil.galatAkses || "sebab tidak diketahui"}`);
    console.error(`   Ulangi sekarang: npm run hapus-akun -- --cabut=${hasil.requestId} --ya`);
    process.exitCode = 1;
  } else if (!hasil.sesiDicabut) {
    // Lebih ringan (jalur masuk sudah tertutup), tetapi sesi lama masih hidup
    // sampai tokennya kedaluwarsa — jadi tetap tidak boleh dibiarkan senyap.
    console.error(`⚠️  Sesi yang berjalan belum diputus: ${hasil.galatPemutusan || "sebab tidak diketahui"}`);
    console.error(`   Ulangi sekarang: npm run hapus-akun -- --cabut=${hasil.requestId} --ya`);
    if (hasil.perluMigrasiPencabutan) {
      console.error("   Jalankan dulu: supabase/migrate-account-revocation.sql");
    }
    process.exitCode = 1;
  }
  for (const b of hasil.berkasDihapus) {
    console.log(`   berkas            : ${b.ok ? "dihapus" : "GAGAL"} ${b.bucket}/${b.jalur}${b.error ? ` — ${b.error}` : ""}`);
  }
  const terhapus = Object.entries(hasil.terhapus || {});
  console.log(
    terhapus.length
      ? `   baris pribadi     : ${terhapus.map(([t, n]) => `${t}=${n}`).join(", ")}`
      : "   baris pribadi     : (tidak ada)"
  );
  console.log(`   surel pemberitahuan: ${hasil.surel?.error ? `GAGAL — ${hasil.surel.error}` : hasil.surel?.simulated ? "disimulasikan" : "terkirim"}`);
  return 0;
}

/**
 * Permintaan 'selesai' yang pencabutannya belum tercatat / gagal sebagian.
 * Read-only; menyebutkan perintah perbaikannya supaya tidak perlu diingat.
 */
async function daftarBelumDicabut() {
  let baris;
  try {
    baris = await daftarPencabutanGagal({ admin, limit: 200 });
  } catch (err) {
    gagal(err.message);
  }

  console.log(`Pencabutan yang perlu diperiksa — ${baris.length} baris`);
  console.log("=".repeat(96));
  if (!baris.length) {
    console.log("(kosong) — setiap permintaan 'selesai' sudah tercabut aksesnya.");
    return;
  }
  for (const r of baris) {
    const kelas = kelasPencabutan(r);
    console.log(`${r.id}  ${kolom(r.email, 34)} ${kolom(new Date(r.decided_at || r.dicabut_pada || Date.now()).toISOString().slice(0, 19), 20)} ${kelas}`);
    const pesan = pesanPencabutan(kelas);
    if (pesan) console.log(`   ${pesan}`);
    if (r.catatan_pencabutan) console.log(`   catatan: ${r.catatan_pencabutan}`);
    console.log(`   cabut ulang: npm run hapus-akun -- --cabut=${r.id} --ya`);
  }
  console.log("=".repeat(96));
  console.log("Pemeriksaan menyeluruh keadaan akunnya: npm run verify:akun-aman");
}

/**
 * Cabut ULANG akses sebuah permintaan yang sudah 'selesai'. Tanpa `--ya` hanya
 * menampilkan rencana. Data yang sudah dianonimkan tidak disentuh lagi.
 */
async function cabutUlang(requestId) {
  const { data: baris, error } = await admin
    .from("account_deletion_requests")
    .select("id, user_id, email, status, decided_at, akses_dicabut, sesi_dicabut, catatan_pencabutan")
    .eq("id", requestId)
    .maybeSingle();

  if (error) gagal(`Gagal membaca permintaan: ${error.message}`);
  if (!baris) gagal(`Permintaan ${requestId} tidak ditemukan.`);
  if (baris.status !== "selesai") {
    gagal(`Status permintaan ini "${baris.status}" — jalur cabut ulang hanya untuk yang berstatus "selesai".`);
  }
  if (!baris.user_id) gagal("Permintaan ini tidak punya akun (surel tanpa pendaftar) — tidak ada yang dicabut.");

  console.log(`Permintaan : ${baris.id}`);
  console.log(`Akun       : ${baris.user_id}`);
  console.log(`Surel      : ${baris.email}`);
  console.log(`Selesai    : ${baris.decided_at ? new Date(baris.decided_at).toISOString() : "-"}`);
  console.log(`Keadaan    : akses_dicabut=${baris.akses_dicabut ?? "null"} sesi_dicabut=${baris.sesi_dicabut ?? "null"}`);
  if (baris.catatan_pencabutan) console.log(`Catatan    : ${baris.catatan_pencabutan}`);
  console.log("");
  console.log("Rencana cabut ulang (hanya pencabutan — data yang sudah dianonimkan tidak disentuh):");
  console.log("  • surel auth diganti tombstone + email_confirm + ban ~100 tahun");
  console.log("  • baris sesi pengguna dihapus (token refresh ikut mati)");
  console.log("  • identitas provider non-surel (mis. Google) dilepas");
  console.log("  • hasilnya ditulis kembali ke kolom jejak permintaan");
  console.log("");

  if (!YA) {
    console.log("Ini baru RENCANA. Tambahkan --ya untuk benar-benar mencabutnya:");
    console.log(`  npm run hapus-akun -- --cabut=${baris.id} --ya`);
    return 0;
  }

  const hasil = await cobaUlangPencabutan({ requestId: baris.id, admin });
  if (!hasil.ok) gagal(`Gagal mencabut ulang: ${hasil.error}${hasil.status ? ` (status: ${hasil.status})` : ""}`);

  console.log("✅ Pencabutan ulang dijalankan.");
  console.log(`   akun masih ada    : ${hasil.akunAda ? "ya" : "tidak (tidak ada yang perlu dicabut)"}`);
  console.log(`   akses dicabut     : ${hasil.aksesDicabut ? "YA (surel tombstone + banned)" : `TIDAK — ${hasil.galatAkses || "sebab tidak diketahui"}`}`);
  console.log(`   sesi diputus      : ${hasil.sesiDicabut ? `YA (identitas provider dilepas: ${hasil.identitasDilepas ?? 0})` : `TIDAK — ${hasil.galatPemutusan || "sebab tidak diketahui"}`}`);
  console.log(`   jejak tercatat    : ${hasil.jejakDicatat ? "ya" : `GAGAL — ${hasil.galatJejak || "sebab tidak diketahui"}`}`);

  if (!hasil.aksesDicabut || !hasil.sesiDicabut) {
    console.error("❗ Masih ada yang belum tercabut — periksa pesan di atas, lalu jalankan lagi bila penyebabnya sudah beres.");
    process.exitCode = 1;
  }
  return 0;
}

console.log("Alat operasional hapus akun Fixify");
console.log("==================================");

if (EKSEKUSI) {
  process.exit(await jalankan(EKSEKUSI));
} else if (CABUT) {
  process.exit(await cabutUlang(CABUT));
} else if (BELUM_DICABUT) {
  await daftarBelumDicabut();
  process.exit(0);
} else {
  await daftar();
  process.exit(0);
}
