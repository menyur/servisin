import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

/// Status laporan yang berarti "belum ditanggapi admin".
const String kReportStatusOpen = 'open';

/// Jumlah laporan yang BELUM DILIHAT oleh penulisnya.
///
/// Aturan (murni — diuji tanpa jaringan di `test/report_seen_test.dart`):
///   * laporan berstatus [kReportStatusOpen] TIDAK dihitung: belum ada kabar
///     baru bagi penulisnya, dan laporan itu memang ia buat sendiri;
///   * laporan yang sudah ditanggapi admin (`reviewed`/`resolved`) DIHITUNG
///     selama statusnya berbeda dari [seen] (snapshot terakhir yang dilihat);
///   * begitu daftar Laporan dibuka, `ReportsScreen` menulis snapshot baru →
///     hitungannya kembali 0 (lihat [ReportSeenStore]).
///
/// [seen] kosong = pengguna belum pernah membuka tab Laporan: laporan yang
/// sudah ditanggapi tetap dihitung — balasan admin itu memang belum pernah
/// dilihatnya — sementara laporan yang masih `open` tetap 0.
int countUnseenReports({
  required Map<String, String> seen,
  required Map<String, String> current,
}) =>
    current.entries
        .where((e) => e.value != kReportStatusOpen && seen[e.key] != e.value)
        .length;

/// Snapshot (id → status) dari daftar laporan yang baru saja dilihat pengguna.
Map<String, String> reportStatusSnapshot(Iterable<Report> reports) => {
      for (final r in reports) r.id: r.status,
    };

/// Penyimpanan snapshot "laporan sudah dilihat" per pengguna di perangkat.
///
/// Disimpan lokal (bukan di database) karena sifatnya preferensi perangkat:
/// "sampai mana saya sudah membaca". Efek sampingnya: setelah pasang ulang
/// aplikasi, laporan yang sudah ditanggapi akan muncul sekali lagi di badge —
/// lebih baik daripada kehilangan notifikasi balasan admin.
///
/// Pola & penamaan kunci mengikuti `lib/last_location.dart` dan
/// `lib/signup_handoff.dart`: satu kunci ber-prefix per user id.
class ReportSeenStore {
  static const String _keyPrefix = 'reports_seen_v1_';

  /// Kunci SharedPreferences untuk [uid].
  static String keyFor(String uid) => '$_keyPrefix$uid';

  /// Snapshot yang tersimpan, atau peta kosong bila belum pernah dibuka /
  /// nilainya rusak. Tidak pernah melempar — badge yang salah lebih buruk
  /// daripada badge yang tidak muncul.
  static Future<Map<String, String>> read(String uid) async {
    if (uid.isEmpty) return const <String, String>{};
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(keyFor(uid));
      if (raw == null || raw.isEmpty) return const <String, String>{};
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const <String, String>{};
      return decoded.map((k, v) => MapEntry('$k', '$v'));
    } catch (_) {
      return const <String, String>{};
    }
  }

  /// Simpan snapshot [current] (id → status) sebagai "sudah dilihat".
  static Future<void> write(String uid, Map<String, String> current) async {
    if (uid.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(keyFor(uid), jsonEncode(current));
    } catch (_) {
      // Gagal menyimpan preferensi bukan kesalahan fatal: badge bisa muncul
      // sekali lagi, tetapi tidak ada alur pengguna yang boleh terhenti.
    }
  }

  /// Tandai seluruh [reports] sebagai sudah dilihat (dipanggil layar Laporan
  /// setelah daftarnya berhasil dimuat).
  static Future<void> markSeen(String uid, Iterable<Report> reports) =>
      write(uid, reportStatusSnapshot(reports));
}
