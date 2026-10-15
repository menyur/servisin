#!/usr/bin/env node
// ============================================================================
// verify-reset-flow.mjs — SATU perintah untuk semua bagian OTOMATIS dari
// prosedur uji lupa kata sandi di APK (docs/prosedur-uji-lupa-password.md).
//
// Kenapa ada. Prosedur itu berisi langkah yang wajib dijalankan manusia di HP
// (ketuk tautan, ketik sandi baru) — itu tidak bisa dan tidak boleh
// diotomatiskan. Tetapi empat pemeriksaannya bisa, dan keempatnya pernah gagal
// secara diam-diam:
//
//   K0 kontrak teks & konstanta. Prosedur menyuruh penguji MENCARI teks tertentu
//      di layar ("Tautan terkirim!", "Tautan tidak berlaku"), dan menyebut angka
//      yang harus benar (jeda 60 detik, batas tunggu 5 detik). Bila aplikasi
//      berubah dan salah satunya hilang, PROSEDURNYA yang menua tanpa ada yang
//      tahu: penguji mencari yang tidak ada, lalu menyimpulkan aplikasinya rusak.
//   K1 deep link. Pemilik URL di app ini plugin `app_links`, bukan
//      FlutterActivity; nilainya pernah salah dan tautan reset hanya membuka
//      beranda. Dijaga test/deeplink_manifest_test.dart — dijalankan di sini,
//      bukan disalin ulang.
//   K2 jalur pembuatan & pengiriman tautan. Aplikasi bisa menampilkan "Tautan
//      terkirim!" sementara tidak ada email apa pun: mailer bawaan Supabase
//      hanya melayani anggota tim project (2 email/jam). Karena itu tautan kini
//      dibuat server sendiri (`admin.generateLink`) lalu dikirim Resend — dan
//      K2 menjaga jalur baru itu (kontrak + alur dengan admin/email tiruan).
//      Dengan `--to=<alamat terdaftar>` K2 mengirim SATU email NYATA lewat
//      jalur itu dan membuktikannya dengan id pesan Resend.
//   K3 jalur Resend. Domain pengirim + kunci + status kedatangan pesan.
//
// Sumber kebenaran tiap pemeriksaan tetap SATU perintah yang sudah ada
// (deeplink_manifest_test.dart, verify-reset-endpoint.mjs, verify-email-send.mjs;
// verify-reset-email.mjs tetap ada sebagai pemeriksa jalur LAMA — lihat catatan
// di dok prosedur tentang stempel `recovery_sent_at` yang tidak lagi ditulis).
// Skrip ini tidak menyalin logikanya — hanya menjalankannya lalu merangkum
// hasilnya jadi laporan siap-tempel. Salinan logika yang menyimpang lebih buruk
// daripada tidak ada pemeriksaan.
//
// Pemakaian:
//   npm run verify:reset-flow                              # K0 + K1 + K3
//   npm run verify:reset-flow -- --to=nama@domainmu.id      # + K2 (kirim nyata)
//   npm run verify:reset-flow -- --to=… --wait=30           # + status kedatangan
//   npm run verify:reset-flow -- --tulis=docs/uji-lupa-password-terakhir.md
//   npm run verify:reset-flow -- --show-email               # alamat penuh di laporan
//   node scripts/verify-reset-flow.mjs --selftest           # murni, tanpa jaringan
//
// Kode keluar: 0 = semua yang dijalankan LULUS · 1 = ada GAGAL ·
// 3 = ada yang DILEWATI, jadi kesimpulan belum bisa diambil (konsisten dengan
// skrip verify:* lain di repo ini).
//
// Jejak: K2 mengirim SATU email reset NYATA ke alamat `--to` bila diberikan
// (tanpa `--to`, K2 hanya menjalankan bagian tanpa jaringan: tidak ada email
// yang dikirim). K3 mengirim satu email uji ke alamat uji Resend
// `delivered@resend.dev` (tanpa inbox nyata).
// Tidak ada akun/baris database yang dibuat atau diubah.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const AKAR = process.cwd();
const FLUTTER_APP = join(AKAR, "flutter_app");
const DOK_PROSEDUR = "docs/prosedur-uji-lupa-password.md";

// Batas waktu tiap anak proses. `flutter test` harus mengompilasi dulu (puluhan
// detik pada cache kosong), jadi batasnya jauh lebih longgar daripada yang lain.
const BATAS_FLUTTER_MS = 600_000;
const BATAS_JARINGAN_MS = 180_000;

// --- Pembantu murni (diuji lewat --selftest) --------------------------------

/**
 * Samarkan email: `budi@gmail.com` → `b***@gmail.com`.
 *
 * Sengaja ditulis di sini, bukan diimpor dari verify-reset-email.mjs: berkas itu
 * menjalankan pemeriksaan live di tingkat atas modul, jadi mengimpornya berarti
 * MENJALANKAN seluruh skripnya. Menyalin delapan baris lebih ringan daripada
 * menjalankan efek samping yang tidak diminta.
 */
export function samarkanEmail(email) {
  if (!email) return email;
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Baris dari keluaran anak proses yang paling DIPERLUKAN sebagai bukti.
 *
 * `awalan` berurutan menurut kepentingan: yang lebih awal menang. Bila tidak ada
 * yang cocok sama sekali, baris terakhir dikembalikan apa adanya (lebih baik
 * mencetak keluaran asli daripada angka karangan).
 *
 * Kenapa berurut, bukan "baris cocok paling akhir": semua skrip verify:* ini
 * menutup dengan `LULUS: …`, sehingga "ambil yang paling akhir" akan selalu
 * mengembalikan penutup itu dan menyembunyikan bukti sebenarnya — mis. status
 * `delivered` dari Resend yang dicetak SEBELUM penutup. Urutan kepentingan
 * membuat bukti kuat menang, sementara penutup tetap jadi cadangan.
 */
export function ambilBaris(teks, awalan) {
  const baris = String(teks ?? "")
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const a of awalan) {
    for (let i = baris.length - 1; i >= 0; i -= 1) {
      if (baris[i].startsWith(a)) return baris[i];
    }
  }
  return baris.length ? baris[baris.length - 1].slice(0, 160) : "(tanpa keluaran)";
}

/**
 * Kesimpulan keseluruhan dari daftar hasil.
 * GAGAL menang atas DILEWATI: satu kegagalan sudah cukup untuk menyimpulkan.
 * @returns {{kesimpulan: "LULUS"|"GAGAL"|"TIDAK KONKLUSIF", kode: 0|1|3}}
 */
export function nilaiKeseluruhan(hasil) {
  const daftar = hasil ?? [];
  if (daftar.some((h) => h.status === "GAGAL")) return { kesimpulan: "GAGAL", kode: 1 };
  if (!daftar.length || daftar.some((h) => h.status === "DILEWATI"))
    return { kesimpulan: "TIDAK KONKLUSIF", kode: 3 };
  return { kesimpulan: "LULUS", kode: 0 };
}

/** Saran tindak lanjut per pemeriksaan yang gagal/dilewati. Murni. */
export function petunjuk(hasil) {
  const saran = [];
  for (const h of hasil ?? []) {
    if (h.status === "LULUS") continue;
    if (h.id === "K0" && h.status === "GAGAL")
      saran.push(
        "K0: prosedur menyebut teks/angka yang sudah tidak ada di aplikasi — perbaiki yang benar: dokumennya bila aplikasinya sengaja berubah, atau kodenya bila tidak."
      );
    if (h.id === "K1" && h.status === "GAGAL")
      saran.push(
        "K1: metadata deep linking di flutter_app/android/app/src/main/AndroidManifest.xml harus ada TEPAT SATU dengan `flutter_deeplinking_enabled=false`."
      );
    if (h.id === "K2" && h.status === "GAGAL")
      saran.push(
        "K2: jalur buatan-server (admin.generateLink + Resend) rusak — jalankan `npm run verify:reset-endpoint` untuk melihat pemeriksaan mana yang gagal; jangan menambal di sisi aplikasi."
      );
    if (h.id === "K2" && h.status === "DILEWATI")
      saran.push("K2: kirim nyatanya belum terbukti — ulangi dengan `--to=<alamat yang benar-benar terdaftar>` lalu periksa id pesan di https://resend.com/emails.");
    if (h.id === "K3" && h.status === "GAGAL")
      saran.push("K3: jalur Resend belum siap (kunci/domain pengirim) — lihat `npm run verify:email-panduan`.");
    if (h.id === "K1" && h.status === "DILEWATI")
      saran.push("K1: jalankan di mesin yang punya `flutter` untuk menutup pemeriksaan kontrak deep link.");
  }
  return saran;
}

/** Laporan markdown siap-tempel ke docs/prosedur-uji-lupa-password.md. Murni. */
export function susunLaporan({ waktuISO, perintah, alamat, hasil }) {
  const { kesimpulan } = nilaiKeseluruhan(hasil);
  const baris = hasil.map((h) => `| ${h.id} | ${h.nama} | ${h.status} | ${h.bukti} |`);
  const keluar = [
    `### Laporan pemeriksaan otomatis lupa kata sandi — ${waktuISO}`,
    "",
    `Perintah: \`${perintah}\`${alamat ? `  ·  alamat uji: \`${alamat}\`` : ""}`,
    "",
    "| # | Pemeriksaan | Hasil | Bukti |",
    "|---|---|---|---|",
    ...baris,
    "",
    `Kesimpulan: **${kesimpulan}**`,
  ];
  const saran = petunjuk(hasil);
  if (saran.length) {
    keluar.push("", "Tindak lanjut:", ...saran.map((s) => `- ${s}`));
  }
  keluar.push(
    "",
    "> Yang TIDAK diperiksa di sini (wajib manual di HP): buka layar lupa sandi, cek inbox,",
    "> ketuk tautan pada app tertutup dan app hidup, validasi form, dan masuk dengan sandi baru."
  );
  return keluar.join("\n");
}

// --- Menjalankan anak proses ------------------------------------------------

function jalankan(perintah, args, { cwd = AKAR, timeoutMs = BATAS_JARINGAN_MS } = {}) {
  const hasil = spawnSync(perintah, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    // Windows: `flutter`/`npm` adalah .bat, jadi perlu shell agar ditemukan.
    // POSIX: jangan pakai shell supaya argumen tidak di-pisah ulang.
    shell: process.platform === "win32",
  });
  const teks = `${hasil.stdout ?? ""}${hasil.stderr ?? ""}`;
  if (hasil.error) return { kode: 3, teks: `${teks}\nGAGAL: ${hasil.error.message}` };
  return { kode: hasil.status ?? 3, teks };
}

/** Terjemahkan kode keluar anak proses ke status laporan. */
function statusDariKode(kode) {
  if (kode === 0) return "LULUS";
  if (kode === 1) return "GAGAL";
  return "DILEWATI";
}

// --- K0: kontrak teks & konstanta yang dipakai prosedur ---------------------

/**
 * Sengaja SEMPIT: hanya invariant yang benar-benar diandalkan prosedur.
 * Bukan pengganti K1 (test Dart tetap sumber kebenarannya) — ini jaring untuk
 * kasus `flutter` tidak tersedia, dan untuk teks layar yang tidak dijaga test.
 */
const KONTRAK = [
  ["Layar minta tautan", "flutter_app/lib/ui/reset_password_screen.dart", "Lupa kata sandi?"],
  ["Tombol kirim", "flutter_app/lib/ui/reset_password_screen.dart", "Kirim Tautan Reset"],
  ["Sukses kirim", "flutter_app/lib/ui/reset_password_screen.dart", "Tautan terkirim!"],
  ["Badan sukses", "flutter_app/lib/ui/reset_password_screen.dart", "terdaftar"],
  ["Peringatan spam", "flutter_app/lib/ui/reset_password_screen.dart", "Periksa folder spam"],
  ["Snackbar batas", "flutter_app/lib/ui/reset_password_screen.dart", "batas pengiriman email di server"],
  ["Judul form sandi baru", "flutter_app/lib/ui/reset_password_screen.dart", "Kata Sandi Baru"],
  ["Validasi panjang", "flutter_app/lib/ui/reset_password_screen.dart", "Kata sandi minimal 6 karakter."],
  ["Validasi konfirmasi", "flutter_app/lib/ui/reset_password_screen.dart", "Ulangi kata sandi tidak sama."],
  ["Tombol simpan", "flutter_app/lib/ui/reset_password_screen.dart", "Simpan Kata Sandi Baru"],
  ["Sukses simpan", "flutter_app/lib/ui/reset_password_screen.dart", "Kata sandi berhasil diganti"],
  ["Tombol masuk", "flutter_app/lib/ui/reset_password_screen.dart", "Masuk Sekarang"],
  ["Tautan kedaluwarsa", "flutter_app/lib/ui/reset_password_screen.dart", "Tautan tidak berlaku"],
  ["Tombol minta baru", "flutter_app/lib/ui/reset_password_screen.dart", "Minta Tautan Baru"],
  ["Cadangan gagal kirim", "flutter_app/lib/ui/reset_password_screen.dart", "Gagal mengirim. Coba lagi nanti."],
  ["Cadangan gagal simpan", "flutter_app/lib/ui/reset_password_screen.dart", "Gagal menyimpan kata sandi. Coba lagi."],
  ["Pesan offline", "flutter_app/lib/ui/common.dart", "Tidak ada koneksi internet."],
  ["Jeda 60 detik", "flutter_app/lib/ui/reset_password_screen.dart", "const int kJedaKirimResetDetik = 60"],
  // C5/prosedur kini bergantung pada jalur TAMPILAN untuk tautan yang gagal
  // ditukar (dulu senyap): argumen rute + fungsi keputusan murninya.
  ["Argumen tautan gagal", "flutter_app/lib/ui/reset_password_screen.dart", "const String kArgTautanGagal"],
  ["Keputusan tautan kedaluwarsa", "flutter_app/lib/ui/reset_password_screen.dart", "bool tampilkanTautanKedaluwarsa("],
  ["Deep link gagal tidak senyap", "flutter_app/lib/main.dart", "_tandaiTautanGagal()"],
  ["Batas tunggu 5 detik", "flutter_app/lib/main.dart", "_recoveryAttempts++ < 100"],
  ["Batas tunggu 5 detik (detak)", "flutter_app/lib/main.dart", "Duration(milliseconds: 50)"],
];

function periksaKontrak() {
  const hilang = [];
  for (const [label, berkas, teks] of KONTRAK) {
    const jalur = join(AKAR, berkas);
    const isi = existsSync(jalur) ? readFileSync(jalur, "utf8") : null;
    if (isi === null) hilang.push(`${label} (berkas ${berkas} tidak ada)`);
    else if (!isi.includes(teks)) hilang.push(`${label} ("${teks}")`);
  }

  // Metadata deep linking: tepat satu deklarasi, nilainya false.
  const manifestPath = join(AKAR, "flutter_app/android/app/src/main/AndroidManifest.xml");
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";
  const nilai = [...manifest.matchAll(/flutter_deeplinking_enabled"[^>]*android:value="(\w+)"/g)].map((m) => m[1]);
  if (nilai.length !== 1 || nilai[0] !== "false")
    hilang.push(
      `metadata deep link (dapat ${nilai.length} deklarasi: ${nilai.join(", ") || "tidak ada"}, wajib tepat satu bernilai "false")`
    );

  if (!existsSync(join(AKAR, DOK_PROSEDUR))) hilang.push(`dokumen prosedur ${DOK_PROSEDUR} tidak ada`);

  const total = KONTRAK.length + 2;
  return { lulus: hilang.length === 0, total, hilang };
}

// --- Mode selftest (tanpa jaringan) -----------------------------------------

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};

if (argv.includes("--selftest")) {
  const kasus = [
    ["samarkanEmail", samarkanEmail("budi@gmail.com"), "b***@gmail.com"],
    ["samarkanEmail tanpa @", samarkanEmail("budi"), "budi"],
    ["samarkanEmail kosong", samarkanEmail(null), null],
  ];
  const kasusBaris = [
    ["ambilBaris ambil GAGAL", ambilBaris("info\nGAGAL: mailer menolak\npenutup", ["GAGAL:"]), "GAGAL: mailer menolak"],
    [
      "ambilBaris pilih yang terakhir",
      ambilBaris("GAGAL: pertama\nGAGAL: kedua", ["GAGAL:"]),
      "GAGAL: kedua",
    ],
    [
      "ambilBaris utamakan awalan terpenting (bukti menang atas penutup)",
      ambilBaris("status   : delivered\nkedatangan: sudah sampai\nLULUS: Resend menerima", ["kedatangan:", "LULUS:"]),
      "kedatangan: sudah sampai",
    ],
    [
      "ambilBaris jatuh ke penutup bila bukti tidak ada",
      ambilBaris("LULUS: Resend menerima", ["kedatangan:", "LULUS:"]),
      "LULUS: Resend menerima",
    ],
    ["ambilBaris tanpa awalan cocok → baris terakhir", ambilBaris("a\nb", ["Z:"]), "b"],
    ["ambilBaris kosong", ambilBaris("", ["GAGAL:"]), "(tanpa keluaran)"],
  ];
  const kasusNilai = [
    ["semua LULUS → 0", [{ id: "K0", status: "LULUS" }], "LULUS", 0],
    ["ada GAGAL → 1", [{ id: "K2", status: "GAGAL" }], "GAGAL", 1],
    ["LULUS + DILEWATI → 3", [{ id: "K0", status: "LULUS" }, { id: "K1", status: "DILEWATI" }], "TIDAK KONKLUSIF", 3],
    ["keluaran kosong → 3", [], "TIDAK KONKLUSIF", 3],
    [
      "GAGAL menang atas DILEWATI",
      [{ id: "K1", status: "GAGAL" }, { id: "K3", status: "DILEWATI" }],
      "GAGAL",
      1,
    ],
  ];

  let gagal = 0;
  for (const [nama, dapat, harap] of kasus) {
    const ok = dapat === harap;
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${harap}, dapat ${dapat}`}`);
  }
  for (const [nama, dapat, harap] of kasusBaris) {
    const ok = dapat === harap;
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${harap}, dapat ${dapat}`}`);
  }
  for (const [nama, masuk, harapKes, harapKode] of kasusNilai) {
    const { kesimpulan, kode } = nilaiKeseluruhan(masuk);
    const ok = kesimpulan === harapKes && kode === harapKode;
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${harapKes}/${harapKode}, dapat ${kesimpulan}/${kode}`}`);
  }

  // Laporan harus memuat baris untuk TIAP pemeriksaan dan menyamarkan alamat.
  const contoh = [
    { id: "K0", nama: "kontrak teks", status: "LULUS", bukti: "20/20" },
    { id: "K2", nama: "stempel", status: "GAGAL", bukti: "429" },
  ];
  const laporan = susunLaporan({ waktuISO: "2026-10-13T00:00:00.000Z", perintah: "npm run verify:reset-flow", alamat: "b***@x.id", hasil: contoh });
  const kasusLaporan = [
    ["laporan memuat baris K0", laporan.includes("| K0 |")],
    ["laporan memuat baris K2", laporan.includes("| K2 |")],
    ["laporan menyimpulkan GAGAL", laporan.includes("Kesimpulan: **GAGAL**")],
    ["laporan mencantumkan tindak lanjut K2", laporan.includes("K2: jalur buatan-server")],
    ["laporan mengingatkan bagian manual", laporan.includes("wajib manual di HP")],
    ["laporan tidak mencetak alamat penuh", !laporan.includes("budi@")],
  ];
  for (const [nama, ok] of kasusLaporan) {
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}`);
  }

  const total = kasus.length + kasusBaris.length + kasusNilai.length + kasusLaporan.length;
  console.log("=".repeat(72));
  console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagal}/${total}`);
  process.exit(gagal === 0 ? 0 : 1);
}

// --- Mode live --------------------------------------------------------------

const TO = (arg("to") ?? process.env.RESET_TEST_TO ?? "").trim();
const WAIT = (arg("wait") ?? "").trim();
const TULIS = arg("tulis");
const TAMPILKAN = argv.includes("--show-email");
const PERINTAH = `npm run verify:reset-flow${argv.length ? ` -- ${argv.join(" ")}` : ""}`;

console.log("Pemeriksaan otomatis alur lupa kata sandi (bagian yang bisa diotomatiskan)");
console.log("=".repeat(72));

const hasil = [];

// K0 — kontrak teks & konstanta (tanpa jaringan, selalu bisa jalan).
const k0 = periksaKontrak();
hasil.push({
  id: "K0",
  nama: "Kontrak teks layar & konstanta prosedur",
  status: k0.lulus ? "LULUS" : "GAGAL",
  bukti: k0.lulus ? `${k0.total}/${k0.total} ada` : `HILANG: ${k0.hilang.slice(0, 3).join("; ")}`,
});
console.log(`K0 ${hasil[0].status.padEnd(9)} kontrak teks & konstanta — ${hasil[0].bukti}`);
if (!k0.lulus) for (const h of k0.hilang) console.log(`      - ${h}`);

// K1 — kontrak deep link, lewat test Dart yang sudah ada (satu sumber kebenaran).
const adaFlutter = jalankan("flutter", ["--version"], { cwd: FLUTTER_APP, timeoutMs: 120_000 }).kode === 0;
if (!adaFlutter) {
  hasil.push({
    id: "K1",
    nama: "Kontrak deep link (deeplink_manifest_test.dart)",
    status: "DILEWATI",
    bukti: "`flutter` tidak tersedia di mesin ini",
  });
  console.log("K1 DILEWATI  `flutter` tidak ditemukan — kontrak deep link tidak diperiksa di sini.");
} else {
  const r = jalankan("flutter", ["test", "test/deeplink_manifest_test.dart"], { cwd: FLUTTER_APP, timeoutMs: BATAS_FLUTTER_MS });
  hasil.push({
    id: "K1",
    nama: "Kontrak deep link (deeplink_manifest_test.dart)",
    status: statusDariKode(r.kode),
    bukti: ambilBaris(r.teks, ["All tests passed", "Some tests failed", "GAGAL:"]),
  });
  console.log(`K1 ${hasil[1].status.padEnd(9)} deep link — ${hasil[1].bukti}`);
}

// K2 — jalur pembuatan & pengiriman tautan reset (admin.generateLink + Resend).
// Tanpa `--to`: kontrak + alur dengan admin/email tiruan (tanpa jaringan).
// Dengan `--to`: kirim NYATA satu kali ke alamat itu, dibuktikan id pesan Resend.
{
  const argsK2 = ["scripts/verify-reset-endpoint.mjs"];
  if (TO) argsK2.push(`--to=${TO}`);
  else argsK2.push("--selftest");
  const r = jalankan("node", argsK2);
  hasil.push({
    id: "K2",
    nama: TO
      ? "Jalur reset buatan server (kirim NYATA ke alamat uji)"
      : "Jalur reset buatan server (kontrak + alur tiruan)",
    status: statusDariKode(r.kode),
    bukti: ambilBaris(r.teks, ["id pesan Resend", "dijalankan:", "GAGAL:", "LEWAT", "LULUS:"]),
  });
  console.log(`K2 ${hasil[2].status.padEnd(9)} jalur reset buatan server — ${hasil[2].bukti}`);
}

// K3 — jalur Resend: kirim nyata lewat pipa produksi + status kedatangan.
const argsK3 = ["scripts/verify-email-send.mjs"];
if (WAIT) argsK3.push(`--wait=${WAIT}`);
const r3 = jalankan("node", argsK3);
hasil.push({
  id: "K3",
  nama: "Jalur Resend (kirim nyata + status pesan)",
  status: statusDariKode(r3.kode),
  bukti: ambilBaris(r3.teks, ["kedatangan:", "status", "GAGAL:", "TIDAK KONKLUSIF:", "LULUS:"]),
});
console.log(`K3 ${hasil[3].status.padEnd(9)} jalur Resend — ${hasil[3].bukti}`);

// --- Laporan ----------------------------------------------------------------

const { kesimpulan, kode } = nilaiKeseluruhan(hasil);
const laporan = susunLaporan({
  waktuISO: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  perintah: PERINTAH,
  alamat: TO ? (TAMPILKAN ? TO : samarkanEmail(TO)) : null,
  hasil,
});

console.log("");
console.log("=".repeat(72));
console.log(`RINGKASAN: ${kesimpulan}`);
for (const s of petunjuk(hasil)) console.log(`  - ${s}`);
console.log("");
console.log(`--- laporan siap-tempel ke ${DOK_PROSEDUR} ---`);
console.log(laporan);
console.log("--- akhir laporan ---");

if (TULIS) {
  mkdirSync(dirname(join(AKAR, TULIS)), { recursive: true });
  writeFileSync(join(AKAR, TULIS), `${laporan}\n`, "utf8");
  console.log(`\nLaporan ditulis: ${TULIS}`);
}

console.log("");
console.log("Yang TIDAK diperiksa (wajib manual di HP): buka layar lupa sandi, cek inbox,");
console.log("ketuk tautan pada app tertutup DAN hidup, validasi form, masuk dengan sandi baru.");
process.exit(kode);
