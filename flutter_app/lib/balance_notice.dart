import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'format.dart';
import 'models.dart';

/// Notifikasi DALAM APLIKASI untuk keputusan setor/tarik saldo.
///
/// Latar: push hanya sampai bila izin Android aktif dan perangkat terhubung.
/// Teknisi yang mematikan notifikasi HP — atau membuka aplikasi setelah
/// push-nya hilang dari baki — tidak pernah tahu setorannya disetujui atau
/// penarikannya ditolak beserta alasannya. Berkas ini menyimpan "keputusan mana
/// yang sudah saya lihat" di perangkat, sehingga aplikasi bisa MENAMPILKAN
/// sendiri kabar itu (banner di layar Saldo + penanda di strip saldo).
///
/// Pola penyimpanan mengikuti `lib/report_seen.dart`: snapshot `id → status`
/// per pengguna, disimpan lokal (preferensi "sampai mana saya sudah membaca"),
/// dan tidak pernah melempar — badge yang salah lebih buruk daripada badge
/// yang tidak muncul.

/// Pengajuan yang sudah diputuskan admin (disetujui atau ditolak).
bool isDecidedBalanceRequest(BalanceRequest r) => r.isApproved || r.isRejected;

/// Keputusan yang BELUM dilihat teknisi.
///
/// [seen] menyimpan status yang terakhir dilihat per pengajuan, jadi:
///   * pengajuan `pending` tidak pernah dihitung (belum ada kabar baru);
///   * keputusan yang statusnya sama dengan snapshot tidak dihitung lagi;
///   * perubahan status berikutnya (mis. ditolak → disetujui admin) dihitung
///     sebagai kabar BARU — snapshot lama tidak menyembunyikannya.
List<BalanceRequest> unseenBalanceDecisions({
  required List<BalanceRequest> requests,
  required Map<String, String> seen,
}) =>
    requests
        .where((r) => isDecidedBalanceRequest(r) && seen[r.id] != r.status)
        .toList();

/// Snapshot `id → status` dari daftar pengajuan (termasuk yang masih pending,
/// supaya keputusannya nanti terdeteksi sebagai kabar baru).
Map<String, String> balanceRequestSnapshot(Iterable<BalanceRequest> requests) =>
    {for (final r in requests) r.id: r.status};

/// Judul pendek satu kabar: "Setoran disetujui" / "Penarikan ditolak".
String balanceNoticeTitle(BalanceRequest r) {
  final jenis = r.isWithdrawal ? 'Penarikan' : 'Setoran';
  return '$jenis ${r.isApproved ? 'disetujui' : 'ditolak'}';
}

/// Kalimat yang menjelaskan akibat keputusan bagi uang teknisi — termasuk
/// alasan penolakan dari admin bila ada.
String balanceNoticeBody(BalanceRequest r) {
  final nominal = formatRupiah(r.amount);
  final alasan = (r.rejectionReason ?? '').trim();

  if (r.isWithdrawal) {
    if (r.isApproved) {
      final rek = r.accountLabel;
      return '$nominal sudah ditransfer admin${rek.isEmpty ? '' : ' ke $rek'}.';
    }
    return '$nominal kembali ke saldo aktifmu.'
        '${alasan.isEmpty ? '' : ' Alasan: $alasan'}';
  }
  if (r.isApproved) return '$nominal sudah masuk ke saldo aktifmu.';
  return 'Bukti setor $nominal belum diterima.'
      '${alasan.isEmpty ? ' Unggah ulang bukti transfer yang benar.' : ' Alasan: $alasan'}';
}

/// Kalimat SnackBar untuk kabar [notices] (terbaru dulu), atau null bila tidak
/// ada kabar. Dipakai shell utama saat aplikasi kembali ke depan layar.
String? balanceNoticeSnack(List<BalanceRequest> notices) {
  if (notices.isEmpty) return null;
  final first = notices.first;
  final dasar = '${balanceNoticeTitle(first)} · ${balanceNoticeBody(first)}';
  return notices.length > 1
      ? '$dasar (+${notices.length - 1} kabar lain di Saldo)'
      : dasar;
}

/// Muat keputusan yang belum dilihat (terbaru dulu) — satu panggilan untuk
/// layar Saldo dan penanda di strip saldo.
///
/// [requests] bisa diisi bila daftar pengajuan sudah dimuat (hemat satu query).
/// Aman-gagal: tanpa sesi / jaringan bermasalah → daftar kosong.
Future<List<BalanceRequest>> loadUnseenBalanceDecisions({
  List<BalanceRequest>? requests,
}) async {
  final list = requests ?? await Api.fetchMyBalanceRequestsSafe();

  var uid = '';
  try {
    uid = Api.currentUserId ?? '';
  } catch (_) {
    // Supabase belum siap (mis. layar dibuka sebelum sesi pulih) — tanpa uid
    // snapshot tidak bisa dibaca, jadi semua keputusan dianggap belum dilihat.
  }
  final seen = await BalanceNoticeStore.read(uid);
  return unseenBalanceDecisions(requests: list, seen: seen);
}

/// Penyimpanan snapshot "keputusan saldo sudah dilihat" per pengguna.
class BalanceNoticeStore {
  static const String _keyPrefix = 'balance_notice_seen_v1_';

  /// Kunci SharedPreferences untuk [uid].
  static String keyFor(String uid) => '$_keyPrefix$uid';

  /// Snapshot tersimpan, atau peta kosong bila belum pernah dibaca / nilainya
  /// rusak. Tidak pernah melempar.
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

  /// Simpan snapshot `id → status` sebagai "sudah dilihat".
  static Future<void> write(String uid, Map<String, String> snapshot) async {
    if (uid.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(keyFor(uid), jsonEncode(snapshot));
    } catch (_) {
      // Gagal menyimpan preferensi bukan kesalahan fatal: kabar bisa muncul
      // sekali lagi, tetapi tidak ada alur pengguna yang boleh terhenti.
    }
  }

  /// Tandai semua [requests] pada statusnya saat ini sebagai sudah dilihat.
  static Future<void> markSeen(String uid, Iterable<BalanceRequest> requests) =>
      write(uid, balanceRequestSnapshot(requests));
}
