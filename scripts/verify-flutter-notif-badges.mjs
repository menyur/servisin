// ============================================================================
// verify-flutter-notif-badges.mjs — jaga WIRING angka notifikasi di app Flutter.
//
// Latar: badge angka di bar navigasi bawah (MainNav) adalah satu-satunya petunjuk
// "ada yang baru" bagi teknisi & pelanggan. Sebelum ini hanya tab Pesanan yang
// punya angka; tab Laporan tidak pernah menunjukkan berapa laporan yang sudah
// ditanggapi admin, dan teknisi tidak pernah tahu berapa pekerjaan menunggu di
//ambil. Perbaikannya menambah dua angka itu:
//
//   * tab Laporan (kedua peran) → laporan yang sudah ditanggapi admin dan
//     statusnya belum dilihat (snapshot per perangkat, lib/report_seen.dart);
//   * tab Pekerjaan (teknisi)   → jumlah pekerjaan tersedia saat ini, dihitung
//     dengan filter yang SAMA dengan daftar kartunya (lib/job_filter.dart).
//
// Aturan hitungnya sudah diuji langsung di Dart (test/report_seen_test.dart,
// test/job_filter_test.dart, test/main_nav_badge_test.dart,
// test/reports_screen_test.dart). Yang TIDAK bisa dijangkau test widget adalah
// *penyambungannya*: langganan realtime laporan, penghitungan ulang saat app
// kembali aktif, timer angka pekerjaan, dan pemetaan indeks tab → notifier.
// Kalau salah satu baris itu hilang, aplikasi tetap compile, test tetap hijau,
// dan fitur diam-diam mati — persis pola bug "Live tapi 0 event" yang dulu
// terjadi di panel admin. Gate ini membuat kehilangan itu GAGAL di CI.
//
// Pemakaian:
//   npm run verify:notif-badge
//   node scripts/verify-flutter-notif-badges.mjs --selftest
//
// --selftest: hapus satu per satu pola wajib dari sumber (di memori) dan
// pastikan aturannya benar-benar MERAH — bukti gate ini tidak hampa.
//
// Exit code: 0 = semua lulus, 1 = ada pelanggaran.
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.argv.includes("--selftest");

const F = {
  common: "flutter_app/lib/ui/common.dart",
  jobs: "flutter_app/lib/ui/jobs_screen.dart",
  reports: "flutter_app/lib/ui/reports_screen.dart",
  api: "flutter_app/lib/api.dart",
  seen: "flutter_app/lib/report_seen.dart",
  filter: "flutter_app/lib/job_filter.dart",
  models: "flutter_app/lib/models.dart",
  pubspec: "flutter_app/pubspec.yaml",
};

const asalAsli = new Map();
const sumber = (berkas) => {
  if (!asalAsli.has(berkas)) {
    asalAsli.set(berkas, readFileSync(path.join(ROOT, berkas), "utf8"));
  }
  return asalAsli.get(berkas);
};

// --- Aturan -----------------------------------------------------------------
// Setiap aturan = "berkas X wajib memuat pola P". `mengapa` menjelaskan apa
// yang rusak bagi pengguna bila pola itu hilang.
const aturan = [
  // --- notifier global ---------------------------------------------------
  {
    berkas: F.common,
    pola: /final ValueNotifier<int> unseenReportUpdates = ValueNotifier<int>\(0\);/,
    mengapa: "tanpa notifier ini tab Laporan tidak punya angka sama sekali",
  },
  {
    berkas: F.common,
    pola: /final ValueNotifier<int> availableJobCount = ValueNotifier<int>\(0\);/,
    mengapa: "tanpa notifier ini teknisi tidak tahu ada berapa pekerjaan menunggu",
  },
  {
    berkas: F.common,
    pola: /const int kJobsTabIndex = 2;/,
    mengapa: "indeks tab Pekerjaan dipakai memasang badge",
  },
  {
    berkas: F.common,
    pola: /int reportsTabIndex\(bool isTechnician\) => isTechnician \? 3 : 2;/,
    mengapa: "tab Laporan berbeda per peran (2 pelanggan, 3 teknisi) — salah indeks = badge nyasar",
  },

  // --- realtime laporan ---------------------------------------------------
  {
    berkas: F.common,
    pola: /Api\.subscribeReportUpdates\(uid, \(u\) => _onReportUpdate\(uid, u\)\)/,
    mengapa: "tanpa langganan ini angka tab Laporan tidak naik saat admin menanggapi",
  },
  {
    berkas: F.common,
    pola: /void _initReportRealtime\(\)/,
    mengapa: "fungsi pemasangan langganan laporan hilang",
  },
  {
    berkas: F.common,
    pola: /_initReportRealtime\(\);/,
    mengapa: "langganan laporan harus dipasang saat shell hidup (initState)",
  },
  {
    berkas: F.common,
    pola: /reportUpdatesTick\.add\(u\);/,
    mengapa: "layar Laporan hanya menyegarkan daftar bila tick disiarkan",
  },
  {
    berkas: F.common,
    // Spasi/newline setelah `=` tidak mengubah arti: `dart format` boleh
    // memecah baris ini, dan dulu pola satu-baris membuat gate MERAH padahal
    // aturan bersamanya tetap dipakai (persis kejadian yang membuat CI Flutter
    // gagal 1 detik sebelum analyze). Yang penting bukan bentuk barisnya,
    // melainkan bahwa angka badge tetap dihitung oleh countUnseenReports.
    pola: /unseenReportUpdates\.value\s*=\s*countUnseenReports\(\s*seen:\s*seen,\s*current:\s*current\s*\);/s,
    mengapa: "angka badge harus dihitung dari aturan bersama (lib/report_seen.dart)",
  },

  // --- angka dihitung ulang saat app kembali aktif -------------------------
  {
    berkas: F.common,
    pola: /void didChangeAppLifecycleState\(AppLifecycleState state\)/,
    mengapa: "notifikasi saat app tidak aktif tidak lewat websocket — angka wajib dihitung ulang saat kembali",
  },
  {
    berkas: F.common,
    pola: /if \(uid != null\) unawaited\(_refreshReportBadge\(uid\)\);/,
    mengapa: "badge Laporan basi setelah app kembali dari background",
  },
  {
    berkas: F.common,
    pola: /if \(_isTechnician\) unawaited\(_refreshJobCount\(\)\);/,
    mengapa: "badge Pekerjaan basi setelah app kembali dari background",
  },
  {
    berkas: F.common,
    pola: /WidgetsBinding\.instance\.addObserver\(this\);/,
    mengapa: "observer daur hidup tak terpasang → didChangeAppLifecycleState tidak pernah dipanggil",
  },

  // --- angka pekerjaan tersedia ------------------------------------------
  {
    berkas: F.common,
    pola: /if \(p\.role == 'technician'\) _startJobCountRefresh\(\);/,
    mengapa: "pemantauan angka pekerjaan hanya boleh hidup untuk teknisi",
  },
  {
    berkas: F.common,
    pola: /_jobCountTimer = Timer\.periodic\(kJobCountRefreshInterval/,
    mengapa: "pekerjaan baru milik pelanggan lain tidak lewat realtime → perlu penyegaran berkala",
  },
  {
    berkas: F.common,
    pola: /final filtered = filterAvailableJobs\(/,
    mengapa: "angka badge Pekerjaan HARUS memakai filter yang sama dengan daftar kartunya",
  },
  {
    berkas: F.jobs,
    pola: /final hasil = filterAvailableJobs\(/,
    mengapa: "layar Pekerjaan harus memakai filter bersama, bukan aturannya sendiri",
  },
  {
    berkas: F.filter,
    pola: /FilteredJobs filterAvailableJobs\(/,
    mengapa: "satu-sumber penyaringan area/keahlian (daftar & badge)",
  },

  // --- badge di bar navigasi ---------------------------------------------
  {
    berkas: F.common,
    pola: /if \(i == kOrdersTabIndex\) return unseenBookingUpdates;/,
    mengapa: "badge Pesanan lepas dari notifier-nya",
  },
  {
    berkas: F.common,
    pola: /if \(i == reportsTabIndex\(isTechnician\)\) return unseenReportUpdates;/,
    mengapa: "badge Laporan tidak terpasang di indeks yang benar per peran",
  },
  {
    berkas: F.common,
    pola: /if \(isTechnician && i == kJobsTabIndex\) return availableJobCount;/,
    mengapa: "badge Pekerjaan hilang dari tab teknisi",
  },
  {
    berkas: F.common,
    pola: /if \(sumber == null \|\| i == currentIndex\) return icon;/,
    mengapa: "badge di tab yang sedang dibuka membingungkan (angka sudah tak relevan)",
  },
  {
    berkas: F.common,
    pola: /\$n laporan belum dibaca/,
    mengapa: "pembaca layar harus tahu angka itu tentang laporan",
  },
  {
    berkas: F.common,
    pola: /\$n pekerjaan tersedia/,
    mengapa: "pembaca layar harus tahu angka itu tentang pekerjaan",
  },

  // --- layar Laporan menandai "sudah dilihat" -----------------------------
  {
    berkas: F.reports,
    pola: /unseenReportUpdates\.value = 0;/,
    mengapa: "membuka daftar Laporan harus menolkan angkanya",
  },
  {
    berkas: F.reports,
    pola: /ReportSeenStore\.markSeen\(uid, reports\)/,
    mengapa: "tanpa snapshot, laporan yang sudah dilihat muncul lagi sebagai angka baru",
  },
  {
    berkas: F.reports,
    pola: /reportUpdatesTick\.stream\.listen\(/,
    mengapa: "daftar laporan tidak menyegarkan diri saat admin menanggapi",
  },
  {
    berkas: F.seen,
    pola: /e\.value != kReportStatusOpen && seen\[e\.key\] != e\.value/,
    mengapa: "aturan hitung: hanya laporan yang SUDAH ditanggapi & belum dilihat",
  },
  {
    berkas: F.seen,
    pola: /reports_seen_v1_/,
    mengapa: "snapshot disimpan per pengguna di perangkat",
  },

  // --- lapisan API --------------------------------------------------------
  {
    berkas: F.api,
    pola: /static ChatUnsubscribe subscribeReportUpdates\(/,
    mengapa: "langganan realtime laporan tidak ada di lapisan API",
  },
  {
    berkas: F.api,
    pola: /column: 'author_id'/,
    mengapa: "filter realtime laporan harus kolom author_id (penulisnya, bukan id lain)",
  },
  {
    berkas: F.api,
    pola: /select\('id,status'\)/,
    mengapa: "angka badge dihitung dari query ringan dua kolom, bukan seluruh laporan",
  },
  {
    berkas: F.models,
    pola: /String\? reportUpdateSnack\(ReportUpdate u\)/,
    mengapa: "teks notifikasi realtime laporan",
  },
];

// --- Aturan negatif: pola yang TIDAK boleh ada -------------------------------
const larangan = [
  {
    berkas: F.jobs,
    pola: /skillMatchesCategory\(/,
    mengapa:
      "layar Pekerjaan menyaring sendiri → aturannya bisa berbeda dari angka badge (harus lewat filterAvailableJobs)",
  },
];

// --- Pemeriksaan ------------------------------------------------------------
const cek = (daftarSumber) => {
  const lulus = [];
  const gagal = [];
  for (const a of aturan) {
    const isi = daftarSumber(a.berkas);
    (a.pola.test(isi) ? lulus : gagal).push({ ...a, jenis: "wajib" });
  }
  for (const a of larangan) {
    const isi = daftarSumber(a.berkas);
    (a.pola.test(isi) ? gagal : lulus).push({ ...a, jenis: "larangan" });
  }
  return { lulus, gagal };
};

const jalankan = () => {
  const hasil = cek(sumber);
  for (const a of hasil.lulus) console.log(`  lulus  ${a.berkas} — ${a.mengapa}`);
  for (const a of hasil.gagal) {
    const kata = a.jenis === "larangan" ? "DILARANG ADA tapi ditemukan" : "WAJIB ADA tapi tidak ditemukan";
    console.log(`  GAGAL  ${a.berkas} — ${kata}: ${a.mengapa}`);
  }
  console.log(
    `\n${hasil.lulus.length}/${hasil.lulus.length + hasil.gagal.length} pemeriksaan lulus` +
      (hasil.gagal.length ? ` — ${hasil.gagal.length} gagal` : ""),
  );
  return hasil.gagal.length === 0;
};

if (SELFTEST) {
  console.log("== selftest: setiap aturan harus terbukti bisa MERAH ==\n");
  let buta = 0;
  for (const a of [...aturan, ...larangan]) {
    const isi = sumber(a.berkas);
    const negatif = larangan.includes(a);
    const contoh = negatif ? null : isi.match(a.pola);
    if (!negatif && !contoh) {
      console.log(`  GAGAL  selftest tidak bisa menemukan pola di ${a.berkas}`);
      buta += 1;
      continue;
    }
    // Rusak sumber di memori: hapus kemunculan pola itu (aturan wajib) atau
    // sisipkan pola terlarang, lalu pastikan aturannya benar-benar merah.
    const rusak = negatif
      ? `${isi}\n// skillMatchesCategory( disisipkan oleh selftest\n`
      : isi.replace(contoh[0], "/* dihapus oleh selftest */");
    const hasil = cek((berkas) => (berkas === a.berkas ? rusak : sumber(berkas)));
    const merah = hasil.gagal.some((g) => g.berkas === a.berkas && g.mengapa === a.mengapa);
    console.log(`  ${merah ? "lulus" : "GAGAL"}  ${a.berkas} — ${a.mengapa}`);
    if (!merah) buta += 1;
  }
  console.log(buta === 0 ? "\nselftest: semua aturan terbukti peka." : `\nselftest: ${buta} aturan hampa.`);
  process.exit(buta === 0 ? 0 : 1);
}

console.log("Memeriksa wiring badge jumlah notifikasi app Flutter…\n");
process.exit(jalankan() ? 0 : 1);
