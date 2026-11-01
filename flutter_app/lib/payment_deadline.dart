/// Batas waktu pembayaran pesanan — CERMIN dari `src/lib/payment-deadline.js`.
///
/// Server yang membatalkan pesanan (cron tiap 2 jam) dan aplikasi yang
/// menampilkan hitungan mundur WAJIB memakai aturan yang sama; kalau berbeda,
/// pelanggan melihat "sisa 5 jam" padahal pesanannya sudah dibatalkan (atau
/// sebaliknya). Karena itu angkanya dikunci di sini dan dipasangkan dengan
/// pemeriksaan paritas di `scripts/verify-payment-deadline.mjs`.
///
///   batas = min(dibuat + 24 jam, mulai slot − 3 jam), lantai dibuat + 1 jam
///
/// Semua perhitungan dalam WIB (UTC+7) walau perangkat pengguna di zona lain —
/// jadwal kunjungan teknisi adalah jam dinding Indonesia.
library;

/// Batas bayar sejak pesanan dibuat (jam).
const int batasBayarJam = 24;

/// Paling lambat berapa jam sebelum slot mulai pesanan harus sudah dibayar.
const int jamSebelumSlot = 3;

/// Lantai: pesanan tidak pernah dibatalkan kurang dari 1 jam sejak dibuat.
const int minimalJam = 1;

const List<String> _bulan = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/// `08:00-10:00` → jam & menit mulai (null bila formatnya tak dikenal).
({int jam, int menit})? jamMulaiSlot(String? bookingTime) {
  final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch((bookingTime ?? '').trim());
  if (m == null) return null;
  final jam = int.parse(m.group(1)!);
  final menit = int.parse(m.group(2)!);
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;
  return (jam: jam, menit: menit);
}

/// Saat slot mulai dalam UTC. `2026-11-02` + `08:00-10:00` →
/// `2026-11-02T01:00:00Z` (08.00 WIB).
DateTime? slotMulaiWib(String? bookingDate, String? bookingTime) {
  final tgl = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(bookingDate ?? '');
  final jam = jamMulaiSlot(bookingTime);
  if (tgl == null || jam == null) return null;
  final lokal = DateTime.utc(
    int.parse(tgl.group(1)!),
    int.parse(tgl.group(2)!),
    int.parse(tgl.group(3)!),
    jam.jam,
    jam.menit,
  );
  return lokal.subtract(const Duration(hours: 7));
}

/// Batas waktu pembayaran, atau `null` bila `createdAt` tidak ada (tanpa itu,
/// tanggal jadwal bukan pengganti yang sah untuk "kapan pesanan dibuat").
DateTime? batasBayar({
  DateTime? createdAt,
  String? bookingDate,
  String? bookingTime,
}) {
  if (createdAt == null) return null;
  final dibuat = createdAt.toUtc();
  var batas = dibuat.add(const Duration(hours: batasBayarJam));

  final mulai = slotMulaiWib(bookingDate, bookingTime);
  if (mulai != null) {
    final kandidat = mulai.subtract(const Duration(hours: jamSebelumSlot));
    if (kandidat.isBefore(batas)) batas = kandidat;
  }

  final lantai = dibuat.add(const Duration(hours: minimalJam));
  if (batas.isBefore(lantai)) batas = lantai;
  return batas;
}

/// `2026-11-02T01:00:00Z` → `2 November 2026, 08.00 WIB`.
String teksBatasWib(DateTime? batas) {
  if (batas == null) return '';
  final wib = batas.toUtc().add(const Duration(hours: 7));
  final jam = wib.hour.toString().padLeft(2, '0');
  final menit = wib.minute.toString().padLeft(2, '0');
  return '${wib.day} ${_bulan[wib.month - 1]} ${wib.year}, $jam.$menit WIB';
}

/// Sisa waktu menuju batas (negatif bila sudah lewat).
Duration sisaMenujuBatas(DateTime batas, {DateTime? sekarang}) =>
    batas.difference((sekarang ?? DateTime.now()).toUtc());

/// Kalimat sisa waktu yang siap tampil.
///
/// Sengaja tidak menampilkan detik: hitungan mundur yang berdetak tiap detik
/// terasa mendesak tanpa menambah informasi, dan layar ini tidak perlu
/// membangun ulang lebih dari sekali per menit.
String teksSisaBatas(DateTime batas, {DateTime? sekarang}) {
  final sisa = sisaMenujuBatas(batas, sekarang: sekarang);
  if (sisa.isNegative || sisa == Duration.zero) return 'Batasnya sudah lewat';
  if (sisa.inMinutes < 1) return 'Kurang dari 1 menit lagi';
  if (sisa.inMinutes < 60) return 'Sisa ${sisa.inMinutes} menit lagi';
  final jam = sisa.inHours;
  final menit = sisa.inMinutes % 60;
  return menit == 0 ? 'Sisa $jam jam lagi' : 'Sisa $jam jam $menit menit lagi';
}

/// Apakah pesanan ini perlu menampilkan batas bayar di layar pelanggan?
///
/// Yang sudah mengunggah bukti transfer TIDAK ditampilkan hitungan mundur:
/// uangnya sedang diperiksa admin, dan pesanan seperti itu tidak akan
/// dibatalkan otomatis (lihat `src/lib/payment-deadline.js`).
bool perluTampilBatas({
  required String status,
  required bool isOwner,
  String? paymentProofUrl,
  bool paymentRejected = false,
}) {
  if (!isOwner) return false;
  if (status != 'pending') return false;
  final adaBuktiMenunggu = (paymentProofUrl ?? '').trim().isNotEmpty && !paymentRejected;
  return !adaBuktiMenunggu;
}
