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
//
// Kenapa `--ya` wajib: penghapusan tidak bisa dibatalkan. Tanpa `--ya` skrip
// hanya menampilkan rencana (akun siapa, apa yang dihapus, apa yang disimpan) —
// jadi selalu ada satu langkah sadar sebelum data hilang.
//
// Yang DIHAPUS vs DISIMPAN dijelaskan di docs/account-deletion.md; ringkasnya:
// identitas + konten pribadi dihapus, catatan keuangan/audit tetap ada tanpa nama
// (lihat Kebijakan Privasi /privasi §5).
//
// Exit: 0 berhasil · 1 gagal · 3 tanpa kredensial.
// Tidak pernah mencetak nilai rahasia. Jalankan: npm run hapus-akun
// ============================================================================
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";
import { daftarPermintaanHapus, eksekusiHapusAkun } from "../src/lib/account-deletion.js";

const argv = process.argv.slice(2);
const nilaiArg = (nama) => {
  const hit = argv.find((a) => a === `--${nama}` || a.startsWith(`--${nama}=`));
  if (!hit) return null;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
};
const YA = argv.includes("--ya");
const EKSEKUSI = nilaiArg("eksekusi");
const LIHAT = argv.includes("--daftar");
const STATUS = nilaiArg("status") || (EKSEKUSI ? null : "diminta");

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
  if (!hasil.aksesDicabut) {
    // Ini kegagalan yang serius: data sudah dianonimkan tetapi akun masih bisa
    // dipakai masuk. Jangan pernah disembunyikan.
    console.error(`❗ Akses TIDAK berhasil dicabut: ${hasil.galatAkses || "sebab tidak diketahui"}`);
    console.error("   Ulangi pencabutan sekarang: buka Supabase → Authentication → cari pengguna itu → ban.");
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

console.log("Alat operasional hapus akun Fixify");
console.log("==================================");

if (EKSEKUSI) {
  process.exit(await jalankan(EKSEKUSI));
} else if (LIHAT || !EKSEKUSI) {
  await daftar();
  process.exit(0);
}
