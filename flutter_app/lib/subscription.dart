import 'models.dart';

/// Langganan servis berkala milik pelanggan.
///
/// Sistem hanya MENGINGATKAN (tidak membuat pesanan/tagihan otomatis): saat
/// [nextDate] tiba, riwayat pesanan menampilkan kartu "Waktunya servis lagi"
/// dengan tombol yang membuka wizard sudah terisi. Keputusan membeli tetap di
/// tangan pelanggan.
class ServiceSubscription {
  final String id;
  final String serviceId;
  final String serviceName;
  final String address;
  final int intervalMonths;
  final DateTime nextDate;
  final String sourceBookingId;
  final bool active;

  /// Status pengingat dari `my_subscriptions()`. `false` berarti RPC lama /
  /// migrasi belum jalan — kartu menyembunyikan baris pengingat daripada
  /// menampilkan "0 dari 3" yang menyesatkan.
  final bool hasReminderInfo;
  final int reminderCount;
  final DateTime? lastRemindedFor;
  final DateTime? lastRemindedAt;

  /// Aturan yang sama dengan `src/lib/subscription-reminder.js`.
  static const int reminderMax = 3;
  static const int reminderRepeatDays = 7;

  const ServiceSubscription({
    required this.id,
    required this.serviceId,
    required this.serviceName,
    required this.address,
    required this.intervalMonths,
    required this.nextDate,
    required this.sourceBookingId,
    this.active = true,
    this.hasReminderInfo = false,
    this.reminderCount = 0,
    this.lastRemindedFor,
    this.lastRemindedAt,
  });

  factory ServiceSubscription.fromMap(Map<String, dynamic> m) {
    final raw = m['next_date'] as String?;
    return ServiceSubscription(
      id: m['id'] as String? ?? '',
      serviceId: m['service_id'] as String? ?? '',
      serviceName: m['service_name'] as String? ?? 'Layanan',
      address: m['address'] as String? ?? '',
      intervalMonths: (m['interval_months'] as num?)?.toInt() ?? 3,
      nextDate: DateTime.tryParse(raw ?? '') ?? DateTime.now(),
      sourceBookingId: m['source_booking_id'] as String? ?? '',
      active: (m['active'] as bool?) ?? true,
      hasReminderInfo: m.containsKey('reminder_count'),
      reminderCount: (m['reminder_count'] as num?)?.toInt() ?? 0,
      lastRemindedFor: DateTime.tryParse(m['last_reminded_for'] as String? ?? ''),
      lastRemindedAt: DateTime.tryParse(m['last_reminded_at'] as String? ?? ''),
    );
  }

  /// "Tiap 3 bulan".
  String get labelInterval => 'Tiap $intervalMonths bulan';

  /// Pengingat yang sudah dikirim PADA SIKLUS BERJALAN.
  ///
  /// Setelah `advance_subscription`, `last_reminded_for` masih menunjuk siklus
  /// lama. Tanpa perbandingan ini, kartu siklus baru akan langsung berbunyi
  /// "3 dari 3" padahal belum ada pengingat sama sekali.
  int get remindersThisCycle {
    final terakhir = lastRemindedFor;
    if (terakhir == null || !_tanggalSama(terakhir, nextDate)) return 0;
    final n = reminderCount.clamp(0, reminderMax);
    return n.toInt();
  }

  /// Perkiraan pengingat berikutnya, atau null bila sudah mentok/diam.
  DateTime? get nextReminderAt {
    if (remindersThisCycle <= 0 || remindersThisCycle >= reminderMax) return null;
    final terakhir = lastRemindedAt;
    if (terakhir == null) return null;
    return terakhir.add(const Duration(days: reminderRepeatDays));
  }
}

bool _tanggalSama(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// Langganan yang sudah jatuh tempo (berdasarkan tanggal, bukan jam).
///
/// Dipisah sebagai fungsi murni supaya batas "hari ini" bisa diuji tanpa
/// bergantung pada jam perangkat.
List<ServiceSubscription> dueSubscriptions(
  Iterable<ServiceSubscription> semua, {
  DateTime? hariIni,
}) {
  final hari = hariIni ?? DateTime.now();
  final batas = DateTime(hari.year, hari.month, hari.day);
  final hasil = semua
      .where((s) =>
          s.active &&
          !DateTime(s.nextDate.year, s.nextDate.month, s.nextDate.day)
              .isAfter(batas))
      .toList();
  hasil.sort((a, b) => a.nextDate.compareTo(b.nextDate));
  return hasil;
}

/// Data pesanan lama yang dipakai mengisi wizard "Pesan lagi".
///
/// Semua yang tidak perlu diketik ulang: varian + jumlahnya, alamat, catatan.
/// Tanggal & jam SENGAJA kosong — jadwal lama sudah lewat, pelanggan memilih
/// slot baru.
class ReorderPrefill {
  final String serviceId;
  final int quantity;
  final List<BookingItem> items;
  final String address;
  final String? notes;

  const ReorderPrefill({
    required this.serviceId,
    required this.quantity,
    required this.items,
    required this.address,
    this.notes,
  });

  factory ReorderPrefill.fromBooking(Booking b) => ReorderPrefill(
        serviceId: b.serviceId ?? '',
        quantity: b.quantity,
        items: b.items,
        address: b.address,
        notes: b.notes,
      );

  /// Jumlah per varian (key = id varian) — dipakai wizard untuk mengisi
  /// penghitung varian seperti pesanan aslinya.
  Map<String, int> get qtyVarian => {
        for (final i in items)
          if (i.optionId != null && i.optionId!.isNotEmpty)
            i.optionId!: i.quantity,
      };

  /// Id varian pertama (untuk layanan satu-varian seperti kendaraan).
  String? get optionId => items.isEmpty ? null : items.first.optionId;

  /// Apakah data cukup untuk mengisi wizard. Pesanan lama tanpa rincian
  /// varian tetap boleh dipesan ulang — pelanggan memilih variannya lagi.
  bool get bisaUlang => serviceId.isNotEmpty;
}
