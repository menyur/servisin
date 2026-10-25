import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'balance_notice.dart';
import 'format.dart';
import 'models.dart';
import 'report_seen.dart';

/// Kotak masuk notifikasi DALAM APLIKASI untuk pelanggan & teknisi.
///
/// Sumber yang selama ini hanya bisa dilihat di layar masing-masing digabung
/// menjadi satu daftar berurutan waktu:
///   * **saldo** — setoran/penarikan yang sudah diputuskan admin (teknisi);
///   * **pesanan** — status pekerjaan/pesanan (tugas baru, dikerjakan, selesai,
///     dibatalkan). Untuk teknisi, kabar pembatalan menyebut DAMPAKNYA ke
///     saldo (komisi sudah terpotong atau belum) tanpa menyebut nominal refund
///     pelanggan — itu urusan pelanggan dan admin;
///   * **refund** — pengembalian dana pesanan pelanggan: sedang diproses, sudah
///     ditransfer balik, atau ditolak beserta alasannya (pelanggan);
///   * **laporan** — laporan yang ditinjau/diselesaikan admin atau mendapat
///     balasan catatan.
///
/// Tidak ada tabel baru: semuanya diturunkan dari data yang sudah dibaca layar
/// lain (`balance_withdrawals`/`balance_deposits`, `bookings`, `reports`).
/// "Sudah dibaca" disimpan lokal per pengguna dengan pola yang sama seperti
/// `report_seen.dart` dan `balance_notice.dart` — snapshot `kunci → versi`,
/// sehingga status yang berubah lagi muncul sebagai kabar baru.

/// Jenis kabar di kotak masuk.
enum InboxKind { saldo, pesanan, refund, laporan }

/// Label tab/filter untuk satu jenis kabar.
String inboxKindLabel(InboxKind kind) => switch (kind) {
      InboxKind.saldo => 'Saldo',
      InboxKind.pesanan => 'Pesanan',
      InboxKind.refund => 'Refund',
      InboxKind.laporan => 'Laporan',
    };

/// Satu baris kotak masuk.
class InboxItem {
  /// Kunci unik lintas sumber, mis. `saldo:<uuid>`, `pesanan:<uuid>`.
  final String key;

  /// Versi isi kabar saat ini (status / status+catatan). Berbeda dari snapshot
  /// "sudah dibaca" = kabar baru.
  final String version;
  final InboxKind kind;
  final String title;
  final String body;
  final DateTime at;

  /// Pesanan terkait (dipakai untuk membuka detail saat diketuk).
  final String? bookingId;
  final bool unread;

  const InboxItem({
    required this.key,
    required this.version,
    required this.kind,
    required this.title,
    required this.body,
    required this.at,
    this.bookingId,
    this.unread = false,
  });

  /// Salinan dengan status baca berbeda (dipakai daftar setelah ditandai).
  InboxItem withUnread(bool value) => InboxItem(
        key: key,
        version: version,
        kind: kind,
        title: title,
        body: body,
        at: at,
        bookingId: bookingId,
        unread: value,
      );
}

/// Susun daftar kotak masuk dari tiga sumber, terbaru dulu.
///
/// [seen] = snapshot `kunci → versi` yang sudah dibaca (lihat
/// [InboxSeenStore]); item yang versinya berbeda ditandai [InboxItem.unread].
List<InboxItem> buildInboxItems({
  List<BalanceRequest> requests = const <BalanceRequest>[],
  List<Booking> bookings = const <Booking>[],
  List<BookingRefund> refunds = const <BookingRefund>[],
  List<Report> reports = const <Report>[],
  Map<String, String> seen = const <String, String>{},
  bool technician = true,
  Set<String>? commissionedBookingIds,
}) {
  final items = <InboxItem>[];
  final bookingById = {for (final b in bookings) b.id: b};

  // ---- Saldo: hanya keputusan admin (pending belum memberitakan apa pun) ----
  for (final r in requests.where(isDecidedBalanceRequest)) {
    final key = 'saldo:${r.id}';
    items.add(InboxItem(
      key: key,
      version: r.status,
      kind: InboxKind.saldo,
      title: balanceNoticeTitle(r),
      body: balanceNoticeBody(r),
      at: r.reviewedAt ?? r.createdAt,
      unread: seen[key] != r.status,
    ));
  }

  // ---- Pesanan: pekerjaan teknisi, atau pesanan milik pelanggan ----
  for (final b in bookings) {
    final kabar = orderInboxNotice(
      b,
      technician: technician,
      commissionedBookingIds: commissionedBookingIds,
    );
    if (kabar == null) continue;
    final key = 'pesanan:${b.id}';
    final version = bookingNoticeVersion(b);
    items.add(InboxItem(
      key: key,
      version: version,
      kind: InboxKind.pesanan,
      title: kabar.$1,
      body: kabar.$2,
      at: bookingNoticeTime(b),
      bookingId: b.id,
      unread: seen[key] != version,
    ));
  }

  // ---- Refund: hanya untuk pelanggan pemilik pesanan ----
  // Status 'pending' pun dikabarkan: pelanggan sudah dibatalkan pesanannya dan
  // perlu tahu uangnya sedang diproses, bukan hilang. Versi ikut berubah saat
  // admin memutuskan, sehingga keputusan terbaru muncul sebagai kabar BARU.
  if (!technician) {
    for (final r in refunds.where((r) => r.ada)) {
      final key = 'refund:${r.id}';
      final version = refundNoticeVersion(r);
      final kabar = refundInboxNotice(r, booking: bookingById[r.bookingId]);
      items.add(InboxItem(
        key: key,
        version: version,
        kind: InboxKind.refund,
        title: kabar.$1,
        body: kabar.$2,
        at: r.decidedAt ??
            r.createdAt ??
            DateTime.fromMillisecondsSinceEpoch(0),
        bookingId: r.bookingId.isEmpty ? null : r.bookingId,
        unread: seen[key] != version,
      ));
    }
  }

  // ---- Laporan: baru berarti bila sudah ditanggapi admin ----
  for (final r in reports) {
    final note = (r.adminNote ?? '').trim();
    if (r.status == kReportStatusOpen && note.isEmpty) continue;
    final key = 'laporan:${r.id}';
    final version = '${r.status}|$note';
    items.add(InboxItem(
      key: key,
      version: version,
      kind: InboxKind.laporan,
      title: note.isEmpty
          ? 'Status laporan berubah'
          : 'Balasan admin untuk laporanmu',
      body: note.isEmpty
          ? '${r.title} · ${r.statusLabel}'
          : '${r.title} · ${r.statusLabel} — $note',
      at: r.createdAt,
      unread: seen[key] != version,
    ));
  }

  items.sort((a, b) => b.at.compareTo(a.at));
  return items;
}

/// Judul + isi kabar untuk satu pesanan, atau null bila statusnya belum layak
/// dikabarkan.
///
/// Teknisi melihat sisi PEKERJAAN (tugas baru, pendapatan), pelanggan melihat
/// sisi PESANANNYA (pembayaran, teknisi datang, selesai). Satu fungsi agar
/// kedua peran tidak pernah mendapat kalimat yang salah sasaran.
(String, String)? orderInboxNotice(
  Booking b, {
  bool technician = true,

  /// ID pesanan yang komisinya sudah dipotong dari saldo teknisi. `null` =
  /// belum diketahui (tabel saldo gagal dibaca) — jangan mengklaim apa pun.
  Set<String>? commissionedBookingIds,
}) {
  if (!technician) return customerOrderNotice(b);
  switch (b.status) {
    case BookingStatus.paid:
      return (
        'Tugas baru untukmu',
        '#${b.code} · ${b.labelKartu} · '
            '${formatDateShort(b.bookingDate)} ${b.bookingTime}'
      );
    case BookingStatus.inProgress:
      return ('Pengerjaan dimulai', '#${b.code} · ${b.labelKartu}');
    case BookingStatus.completed:
      return (
        'Pesanan selesai',
        '#${b.code} · Pendapatan dicatat; komisi + biaya app dipotong dari saldo.'
      );
    case BookingStatus.cancelled:
      // Teknisi perlu tahu APAKAH pembatalan ini menyentuh saldonya. Nominal
      // refund pelanggan SENGAJA tidak disebut — teknisi tidak berhak atas
      // data uang pelanggan, dan nominal itu tidak pernah menjadi hak teknisi.
      final dampak = switch (commissionedBookingIds) {
        null =>
          'Komisi hanya dipotong setelah pekerjaan selesai — cek layar Saldo untuk memastikan.',
        final ids when ids.contains(b.id) =>
          'Komisi pesanan ini sudah terpotong dan TIDAK dikembalikan otomatis — hubungi admin bila perlu penyesuaian saldo.',
        _ =>
          'Saldo kamu tidak berubah: komisi baru dipotong setelah pekerjaan selesai.',
      };
      return (
        'Pesanan dibatalkan',
        '#${b.code} · ${b.serviceName} dibatalkan. $dampak'
      );
    case BookingStatus.pending:
      return null;
  }
}

/// Kabar pesanan dari sudut pandang PELANGGAN pemilik pesanan.
(String, String)? customerOrderNotice(Booking b) {
  final jadwal = '${formatDateShort(b.bookingDate)} ${b.bookingTime}';
  switch (b.status) {
    case BookingStatus.pending:
      if (b.paymentRejected) {
        final alasan = (b.paymentRejectionReason ?? '').trim();
        return (
          'Bukti pembayaran ditolak',
          '#${b.code} · ${alasan.isEmpty ? 'Unggah ulang bukti pembayaran yang benar.' : 'Alasan: $alasan'}'
        );
      }
      if (b.paymentMethod == 'cod') {
        return (
          'Pesanan diterima',
          '#${b.code} · Bayar tunai saat teknisi datang ($jadwal).'
        );
      }
      return (
        'Menunggu pembayaran',
        '#${b.code} · Selesaikan pembayaran agar pesanan diproses.'
      );
    case BookingStatus.paid:
      final teknisi = (b.technicianName ?? '').trim();
      if (teknisi.isEmpty) {
        return (
          'Pembayaran dikonfirmasi',
          '#${b.code} · Menunggu teknisi ditugaskan; jadwal $jadwal.'
        );
      }
      return (
        'Teknisi ditugaskan',
        '#${b.code} · $teknisi akan datang $jadwal.'
      );
    case BookingStatus.inProgress:
      return (
        'Pengerjaan dimulai',
        '#${b.code} · ${b.serviceName} sedang dikerjakan teknisi.'
      );
    case BookingStatus.completed:
      return (
        'Pesanan selesai',
        b.hasReview
            ? '#${b.code} · Terima kasih sudah menilai teknisimu.'
            : '#${b.code} · Beri penilaian untuk teknisi agar kualitas terjaga.'
      );
    case BookingStatus.cancelled:
      return (
        'Pesanan dibatalkan',
        '#${b.code} · ${b.serviceName} dibatalkan.'
      );
  }
}

/// Judul + isi kabar pengembalian dana, dari sudut pandang pelanggan.
///
/// [booking] dipakai untuk kode & nama layanan bila tersedia (data pesanan
/// sudah dimuat kotak masuk); model refund menyimpan cadangannya sendiri.
/// Status "pending" dengan bukti bayar yang BELUM dikonfirmasi admin sengaja
/// tidak menjanjikan transfer — nominalnya masih diperiksa.
(String, String) refundInboxNotice(BookingRefund r, {Booking? booking}) {
  final kode = (booking?.code ?? r.bookingCode ?? '').trim();
  final layanan = (booking?.serviceName ?? r.serviceName ?? '').trim();
  final awalan = [
    if (kode.isNotEmpty) '#$kode',
    if (layanan.isNotEmpty) layanan,
  ].join(' · ');
  final kepala = awalan.isEmpty ? '' : '$awalan · ';
  final nominal = formatRupiah(r.amount);

  switch (r.status) {
    case 'done':
      return (
        'Dana sudah dikembalikan',
        '$kepala$nominal sudah ditransfer balik ke rekeningmu.',
      );
    case 'rejected':
      final alasan = (r.rejectionReason ?? '').trim();
      return (
        'Pengembalian dana ditolak',
        '$kepala$nominal — '
            '${alasan.isEmpty ? 'hubungi admin untuk alasannya.' : alasan}',
      );
    case 'pending':
      if (!r.paymentConfirmed) {
        return (
          'Pengembalian dana menunggu pemeriksaan',
          '$kepala$nominal · bukti bayarmu belum dikonfirmasi admin, '
              'jadi nominalnya masih diperiksa sebelum ditransfer balik.',
        );
      }
      return (
        'Pengembalian dana sedang diproses',
        '$kepala$nominal menunggu transfer balik dari admin.',
      );
    default:
      return (
        'Status pengembalian dana',
        '$kepala$nominal · status: ${r.labelStatus}.',
      );
  }
}

/// Versi kabar refund: keputusan admin (atau bukti transfer balik) mengubah
/// versi sehingga muncul sebagai kabar baru di kotak masuk.
String refundNoticeVersion(BookingRefund r) => [
      r.status,
      (r.rejectionReason ?? '').trim(),
      (r.note ?? '').trim(),
      r.proofPath ?? '',
      r.decidedAt?.toIso8601String() ?? '',
    ].join('|');

/// Versi isi kabar pesanan — dasar deteksi "kabar baru".
///
/// Status saja tidak cukup: pelanggan perlu diberi tahu saat bukti bayarnya
/// ditolak, teknisi ditugaskan, atau jadwalnya berubah walau statusnya tetap.
String bookingNoticeVersion(Booking b) => [
      b.status.apiValue,
      b.paymentRejected ? 'ditolak' : '-',
      (b.paymentRejectionReason ?? '').trim(),
      b.technicianId ?? '',
      '${b.rescheduleCount}',
    ].join('|');

/// Waktu paling masuk akal untuk mengurutkan kabar pesanan.
///
/// `bookings` tidak punya `updated_at`, jadi dipakai stempel terakhir yang
/// tersedia: selesai → `completed_at`, dibayar/dikerjakan →
/// `payment_confirmed_at`, sisanya `created_at`. Pesanan lama tanpa kolom
/// stempel jatuh ke tanggal jadwalnya agar tidak hilang dari daftar.
DateTime bookingNoticeTime(Booking b) {
  final tersedia = b.completedAt ?? b.paymentConfirmedAt ?? b.createdAt;
  if (tersedia != null) return tersedia;
  final jadwal = DateTime.tryParse(b.bookingDate);
  return jadwal ?? DateTime.fromMillisecondsSinceEpoch(0);
}

/// Jumlah kabar yang belum dibaca.
int countUnreadInbox(Iterable<InboxItem> items) =>
    items.where((i) => i.unread).length;

/// Data lengkap satu kali muat kotak masuk: item + sumber mentahnya (dipakai
/// untuk menandai "sudah dibaca" di penyimpanan masing-masing sumber).
class InboxData {
  final List<InboxItem> items;
  final List<BalanceRequest> requests;
  final List<Report> reports;
  final String uid;

  const InboxData({
    required this.items,
    required this.requests,
    required this.reports,
    required this.uid,
  });

  int get unread => countUnreadInbox(items);

  /// Masih ada kabar bertanda "Baru"? Dipakai tombol "Tandai semua sudah
  /// dibaca" — tombolnya hanya tampil bila memang ada yang perlu ditandai.
  bool get hasUnread => items.any((i) => i.unread);

  /// Salinan tanpa satu pun kabar berstatus belum dibaca.
  ///
  /// Dipakai layar kotak masuk untuk menghapus penanda "Baru" SEKETIKA setelah
  /// tombolnya ditekan — tanpa memuat ulang dari server. Sumber mentah
  /// ([requests]/[reports]/[uid]) ikut dibawa agar penyimpanan "sudah dibaca"
  /// tetap bisa ditulis dari salinan ini.
  InboxData allRead() => InboxData(
        items: [for (final i in items) i.withUnread(false)],
        requests: requests,
        reports: reports,
        uid: uid,
      );

  /// Hanya kabar satu jenis (filter tab).
  List<InboxItem> ofKind(InboxKind? kind) =>
      kind == null ? items : items.where((i) => i.kind == kind).toList();
}

/// Muat kotak masuk dari server + snapshot lokal.
///
/// [bookings]/[requests]/[reports] bisa diisi bila pemanggil sudah memuatnya
/// (layar Pekerjaan) — menghindari query ganda. Aman-gagal per sumber: satu
/// sumber yang gagal tidak mengosongkan seluruh kotak masuk.
Future<InboxData> loadInbox({
  List<Booking>? bookings,
  List<BalanceRequest>? requests,
  List<BookingRefund>? refunds,
  List<Report>? reports,
  bool technician = true,
}) async {
  final reqs = requests ?? await Api.fetchMyBalanceRequestsSafe();
  final bks = bookings ??
      (technician
          ? await Api.fetchAssignedJobsSafe()
          : await Api.fetchMyBookingsSafe());
  // Refund adalah urusan pelanggan; teknisi tidak punya baris refund sendiri
  // (policy RLS membatasinya ke pemilik pesanan), jadi tidak perlu query.
  final refs = technician
      ? (refunds ?? const <BookingRefund>[])
      : (refunds ?? await Api.fetchMyRefundsSafe());
  // Teknisi: pesanan mana yang komisinya sudah dipotong? Hanya dibaca untuk
  // teknisi; pelanggan tidak punya baris `balance_transactions` sendiri.
  final komisi = technician
      ? await Api.fetchMyCommissionedBookingIdsSafe()
      : const <String>{};
  final reps = reports ?? await Api.fetchMyReportsSafe();

  String uid = '';
  try {
    uid = Api.currentUserId ?? '';
  } catch (_) {
    // Supabase belum siap (mis. widget test) — tanpa uid tidak ada snapshot
    // yang bisa dibaca, jadi semua kabar tampil sebagai belum dibaca.
  }
  final seen = await InboxSeenStore.read(uid);
  return InboxData(
    items: buildInboxItems(
      requests: reqs,
      bookings: bks,
      refunds: refs,
      reports: reps,
      seen: seen,
      technician: technician,
      commissionedBookingIds: komisi,
    ),
    requests: reqs,
    reports: reps,
    uid: uid,
  );
}

/// Jumlah kabar belum dibaca dari data yang sudah dimuat (tanpa query ulang).
Future<int> countUnreadInboxFrom({
  required List<Booking> bookings,
  required List<BalanceRequest> requests,
  required List<Report> reports,
}) async {
  final data = await loadInbox(
    bookings: bookings,
    requests: requests,
    reports: reports,
  );
  return data.unread;
}

/// Tandai seluruh kotak masuk sudah dibaca — termasuk penyimpanan sumbernya
/// (kabar saldo & laporan), supaya banner saldo dan badge Laporan tidak
/// mengklaim "belum dibaca" untuk kabar yang baru saja dibaca di sini.
Future<void> markInboxRead(InboxData data) async {
  await InboxSeenStore.markSeen(data.uid, data.items);
  await BalanceNoticeStore.markSeen(data.uid, data.requests);
  await ReportSeenStore.markSeen(data.uid, data.reports);
}

/// Penyimpanan snapshot "kabar kotak masuk sudah dibaca" per pengguna.
class InboxSeenStore {
  static const String _keyPrefix = 'inbox_seen_v1_';

  static String keyFor(String uid) => '$_keyPrefix$uid';

  /// Snapshot tersimpan, atau peta kosong bila belum ada / rusak.
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

  static Future<void> write(String uid, Map<String, String> snapshot) async {
    if (uid.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(keyFor(uid), jsonEncode(snapshot));
    } catch (_) {
      // Gagal menyimpan preferensi tidak boleh menggagalkan layar.
    }
  }

  /// Simpan versi sekarang dari semua [items] sebagai "sudah dibaca".
  static Future<void> markSeen(String uid, Iterable<InboxItem> items) =>
      write(uid, {for (final i in items) i.key: i.version});
}
