/// Model data + parser aman dari Supabase (semua numeric dibaca sebagai num).
/// Kolom mengikuti skema Supabase project web Servisin/Fixify.
class Category {
  final String id;
  final String name;
  final String? description;
  final String icon;
  final int sortOrder;

  Category({required this.id, required this.name, this.description, required this.icon, required this.sortOrder});

  factory Category.fromMap(Map<String, dynamic> m) => Category(
        id: m['id'] as String,
        name: m['name'] as String,
        description: m['description'] as String?,
        icon: (m['icon'] as String?) ?? 'wrench',
        sortOrder: (m['sort_order'] as num?)?.toInt() ?? 0,
      );
}

class PromoBanner {
  final String id;
  final String title;
  final String? description;
  final String imagePath; // path di bucket publik `banners`
  final int? targetTab; // 1=Pesanan 2=Laporan 3=Voucher 4=Profil; null = tanpa aksi

  PromoBanner({
    required this.id,
    required this.title,
    this.description,
    required this.imagePath,
    this.targetTab,
  });

  factory PromoBanner.fromMap(Map<String, dynamic> m) => PromoBanner(
        id: m['id'] as String,
        title: (m['title'] as String?) ?? '',
        description: m['description'] as String?,
        imagePath: (m['image_path'] as String?) ?? '',
        targetTab: (m['target_tab'] as num?)?.toInt(),
      );
}

class ServiceOption {
  final String id;
  final String label;
  final int price;
  final String? durationEstimate;

  ServiceOption({required this.id, required this.label, required this.price, this.durationEstimate});

  factory ServiceOption.fromMap(Map<String, dynamic> m) => ServiceOption(
        id: m['id'] as String,
        label: m['label'] as String,
        price: (m['price'] as num).toInt(),
        durationEstimate: m['duration_estimate'] as String?,
      );
}

class Service {
  final String id;
  final String categoryId;
  final String name;
  final String? description;
  final int basePrice;
  final String priceNote;
  final String? durationEstimate;
  final String? imageUrl;
  final String? icon; // key ikon dari kolom services.icon (mis. 'sparkles')
  final List<ServiceOption> options;

  Service({
    required this.id,
    required this.categoryId,
    required this.name,
    this.description,
    required this.basePrice,
    required this.priceNote,
    this.durationEstimate,
    this.imageUrl,
    this.icon,
    this.options = const [],
  });

  bool get hasOptions => options.isNotEmpty;

  factory Service.fromMap(Map<String, dynamic> m, {List<ServiceOption> options = const []}) => Service(
        id: m['id'] as String,
        categoryId: m['category_id'] as String,
        name: m['name'] as String,
        description: m['description'] as String?,
        basePrice: (m['base_price'] as num).toInt(),
        priceNote: (m['price_note'] as String?) ?? 'mulai dari',
        durationEstimate: m['duration_estimate'] as String?,
        imageUrl: m['image_url'] as String?,
        icon: m['icon'] as String?,
        options: options,
      );
}

class Profile {
  final String id;
  final String name;
  final String email;
  final String? phone;
  final String? address;
  final String? avatarUrl;
  final String role;
  final String? serviceArea; // daerah kerja teknisi (filter push pekerjaan baru)

  /// Keahlian utama teknisi = ID kategori katalog ('ac'|'tukang'|'kendaraan'|
  /// 'kebersihan' — sama dengan categories.id). Kosong = tanpa filter
  /// keahlian. Dipakai filter daftar Tersedia & push pekerjaan baru.
  final String? skill;

  /// Saldo aktif teknisi (model top-up — migrate-technician-balance.sql):
  /// naik saat admin menyetujui bukti setor, dipotong komisi saat pesanan
  /// selesai, ditahan saat pengajuan penarikan. Untuk pelanggan selalu 0.
  final double balance;

  /// Waktu admin terakhir memilih "Ingatkan setor" (migrate-balance-reminder.sql).
  /// Null = belum pernah diingatkan / kolom belum ada. Dipakai menampilkan
  /// banner pengingat setor di aplikasi selama saldo masih 0/minus.
  final DateTime? balanceReminderAt;

  Profile({required this.id, required this.name, required this.email, this.phone, this.address, this.avatarUrl, required this.role, this.serviceArea, this.skill, this.balance = 0, this.balanceReminderAt});

  factory Profile.fromMap(Map<String, dynamic> m) => Profile(
        id: m['id'] as String,
        name: (m['name'] as String?) ?? '',
        email: (m['email'] as String?) ?? '',
        phone: m['phone'] as String?,
        address: m['address'] as String?,
        avatarUrl: m['avatar_url'] as String?,
        role: (m['role'] as String?) ?? 'customer',
        serviceArea: m['service_area'] as String?,
        skill: m['skill'] as String?,
        balance: _parseNum(m['balance']),
        balanceReminderAt: _parseDate(m['balance_reminder_at']),
      );

  /// Kolom numeric PostgREST bisa datang sebagai angka ATAU string
  /// (presisi besar diserialisasi sebagai teks) — terima keduanya.
  static double _parseNum(dynamic v) {
    if (v is num) return v.toDouble();
    return num.tryParse('${v ?? ""}')?.toDouble() ?? 0;
  }

  /// Kolom timestamptz PostgREST → DateTime; kosong/tak valid → null.
  static DateTime? _parseDate(dynamic v) => DateTime.tryParse('${v ?? ""}');
}

/// Satu pesan chat pelanggan ↔ teknisi untuk sebuah pesanan.
class ChatMessage {
  final String id;
  final String bookingId;
  final String senderId;
  final String body;
  final DateTime createdAt;

  ChatMessage({required this.id, required this.bookingId, required this.senderId, required this.body, required this.createdAt});

  factory ChatMessage.fromMap(Map<String, dynamic> m) => ChatMessage(
        id: m['id'] as String,
        bookingId: m['booking_id'] as String,
        senderId: m['sender_id'] as String,
        body: m['body'] as String,
        createdAt: DateTime.parse(m['created_at'] as String),
      );
}

enum BookingStatus { pending, paid, inProgress, completed, cancelled }

BookingStatus bookingStatusFrom(String? s) {
  switch (s) {
    case 'paid':
      return BookingStatus.paid;
    case 'in_progress':
      return BookingStatus.inProgress;
    case 'completed':
      return BookingStatus.completed;
    case 'cancelled':
      return BookingStatus.cancelled;
    default:
      return BookingStatus.pending;
  }
}

extension BookingStatusX on BookingStatus {
  String get apiValue => switch (this) {
        BookingStatus.pending => 'pending',
        BookingStatus.paid => 'paid',
        BookingStatus.inProgress => 'in_progress',
        BookingStatus.completed => 'completed',
        BookingStatus.cancelled => 'cancelled',
      };

  String get label => switch (this) {
        BookingStatus.pending => 'Menunggu Pembayaran',
        BookingStatus.paid => 'Dibayar — Menunggu Penugasan',
        BookingStatus.inProgress => 'Sedang Dikerjakan',
        BookingStatus.completed => 'Selesai',
        BookingStatus.cancelled => 'Dibatalkan',
      };
}

class Booking {
  final String id;
  final String code;
  final String serviceName;
  final String? optionLabel;
  final int subtotalPrice;
  final int appFee;
  final int discountAmount;
  final int totalPrice;
  final BookingStatus status;
  final String bookingDate; // yyyy-MM-dd
  final String bookingTime; // '08:00-10:00'
  final String address;
  final String? notes;
  final String? paymentMethod;
  final String? paymentProofUrl;
  final bool paymentRejected;
  final String? paymentRejectionReason;
  final String? technicianId;
  final String? technicianName;
  final String? technicianAvatar;
  final String? userId;
  final bool hasReview;

  /// Berapa kali jadwal pesanan ini sudah diubah pelanggan sendiri
  /// (bookings.reschedule_count; batasnya [maxReschedule]). Kolom ini baru —
  /// DB lama / RPC lama mengembalikan null dan dibaca sebagai 0.
  final int rescheduleCount;

  /// Titik lokasi (pin) yang dipasang pelanggan — null bila tidak dipasang.
  /// Koordinat rumah: hanya terbaca pemilik pesanan, teknisi ter-assign, admin
  /// (RLS bookings tidak berubah karena lat/lng kolom di bookings).
  final double? lat;
  final double? lng;

  /// Pesanan punya titik lokasi (pin) — dipakai badge di kartu tugas.
  bool get hasPin => lat != null && lng != null;

  /// Apakah [uid] adalah PEMILIK (pelanggan) pesanan ini — bukan teknisi yang
  /// ditugaskan. Dipakai UI untuk menentukan siapa yang boleh melihat /
  /// menjalankan alur bukti pembayaran (unggah, kirim ulang, peringatan
  /// penolakan).
  ///
  /// Wajib eksplisit karena RLS "technician can view assigned bookings"
  /// membuat teknisi bisa membaca baris pesanan yang ditugaskan ke mereka;
  /// aplikasi memakai layar detail/kartu yang sama untuk kedua peran, jadi
  /// tanpa pemeriksaan ini peringatan "bukti pembayaran ditolak admin" milik
  /// pelanggan ikut tampil di aplikasi teknisi (bug).
  bool isOwnedBy(String? uid) => uid != null && userId == uid;

  /// Stempel waktu untuk timeline status:
  /// * createdAt — pesanan dibuat (kolom created_at, selalu ada);
  /// * paymentConfirmedAt — admin mengonfirmasi pembayaran
  ///   (payment_confirmed_at; null bila kolom belum ada di DB atau
  ///   belum dikonfirmasi — pesanan COD tak lewat langkah ini);
  /// * completedAt — pesanan selesai (completed_at).
  final DateTime? createdAt;
  final DateTime? paymentConfirmedAt;
  final DateTime? completedAt;

  Booking({
    required this.id,
    required this.code,
    required this.serviceName,
    this.optionLabel,
    required this.subtotalPrice,
    required this.appFee,
    required this.discountAmount,
    required this.totalPrice,
    required this.status,
    required this.bookingDate,
    required this.bookingTime,
    required this.address,
    this.notes,
    this.paymentMethod,
    this.paymentProofUrl,
    this.paymentRejected = false,
    this.paymentRejectionReason,
    this.technicianId,
    this.technicianName,
    this.technicianAvatar,
    this.userId,
    this.hasReview = false,
    this.rescheduleCount = 0,
    this.createdAt,
    this.paymentConfirmedAt,
    this.completedAt,
    this.lat,
    this.lng,
  });

  factory Booking.fromMap(Map<String, dynamic> m, {bool hasReview = false}) {
    final tech = m['technician'] as Map<String, dynamic>?;
    final svc = m['services'] as Map<String, dynamic>?;
    // Varian disimpan sebagai teks option_label di bookings (bukan FK join).
    final optLabel = m['option_label'] as String?;
    return Booking(
      id: m['id'] as String,
      code: (m['code'] as String?) ?? '',
      serviceName: (svc?['name'] as String?) ?? 'Layanan',
      optionLabel: optLabel,
      subtotalPrice: (m['subtotal_price'] as num?)?.toInt() ?? 0,
      appFee: (m['app_fee'] as num?)?.toInt() ?? 0,
      discountAmount: (m['discount_amount'] as num?)?.toInt() ?? 0,
      totalPrice: (m['total_price'] as num?)?.toInt() ?? 0,
      status: bookingStatusFrom(m['status'] as String?),
      bookingDate: (m['booking_date'] as String?) ?? '',
      bookingTime: (m['booking_time'] as String?) ?? '',
      address: (m['address'] as String?) ?? '',
      notes: m['notes'] as String?,
      paymentMethod: m['payment_method'] as String?,
      lat: (m['lat'] as num?)?.toDouble(),
      lng: (m['lng'] as num?)?.toDouble(),
      paymentProofUrl: m['payment_proof_url'] as String?,
      paymentRejected: (m['payment_rejected'] as bool?) ?? false,
      paymentRejectionReason: m['payment_rejection_reason'] as String?,
      userId: m['user_id'] as String?,
      rescheduleCount: (m['reschedule_count'] as num?)?.toInt() ?? 0,
      technicianId: m['technician_id'] as String?,
      technicianName: tech?['name'] as String?,
      technicianAvatar: tech?['avatar_url'] as String?,
      hasReview: hasReview,
      createdAt: m['created_at'] == null ? null : DateTime.parse(m['created_at'] as String),
      paymentConfirmedAt:
          m['payment_confirmed_at'] == null ? null : DateTime.parse(m['payment_confirmed_at'] as String),
      completedAt: m['completed_at'] == null ? null : DateTime.parse(m['completed_at'] as String),
    );
  }
}

/// Event realtime perubahan satu baris bookings (Supabase Realtime
/// postgres_changes, lihat Api.subscribeBookingUpdates).
/// [prevStatus]/[prevTechnicianId] bisa null bila server tidak mengirim
/// kondisi lama (bookings butuh replica identity full —
/// migrate-realtime-bookings.sql) — deteksi perubahan jadi best-effort.
class BookingUpdate {
  final String id;
  final String code;
  final String? status;
  final String? prevStatus;
  final String? technicianId;
  final String? prevTechnicianId;
  final String? userId;

  BookingUpdate({
    required this.id,
    required this.code,
    this.status,
    this.prevStatus,
    this.technicianId,
    this.prevTechnicianId,
    this.userId,
  });

  BookingStatus get statusValue => bookingStatusFrom(status);

  /// Status berubah dibanding kondisi lama (bila diketahui).
  bool get statusChanged =>
      prevStatus != null && status != null && prevStatus != status;

  /// Teknisi baru saja ditugaskan (technician_id dari null terisi).
  bool get technicianAssigned =>
      technicianId != null && prevTechnicianId == null;
}

/// Satu mutasi saldo teknisi (tabel balance_transactions — audit trail):
/// amount > 0 = top-up (setor disetujui) / refund penarikan,
/// amount < 0 = potongan komisi pesanan selesai / penarikan.
/// Hanya bisa dibaca pemilik baris & admin (RLS).
class BalanceTransaction {
  final String id;
  final String type; // earning | topup | adjustment | withdrawal | refund
  final double amount;
  final double? commissionAmount; // komisi terpotong (earning pesanan selesai)
  final String? note;
  final String? bookingCode; // join ke bookings(code) bila terpasang
  final int? bookingTotalPrice; // join ke bookings(total_price) — nilai pekerjaan
  final int? bookingAppFee; // join ke bookings(app_fee) — biaya app ikut dipotong dari saldo
  final DateTime createdAt;

  BalanceTransaction({
    required this.id,
    required this.type,
    required this.amount,
    this.commissionAmount,
    this.note,
    this.bookingCode,
    this.bookingTotalPrice,
    this.bookingAppFee,
    required this.createdAt,
  });

  factory BalanceTransaction.fromMap(Map<String, dynamic> m) {
    final bk = m['bookings'] as Map<String, dynamic>?;
    return BalanceTransaction(
      id: m['id'] as String,
      type: (m['type'] as String?) ?? 'adjustment',
      amount: (m['amount'] as num?)?.toDouble() ?? 0,
      commissionAmount: (m['commission_amount'] as num?)?.toDouble(),
      note: m['note'] as String?,
      bookingCode: bk?['code'] as String?,
      bookingTotalPrice: (bk?['total_price'] as num?)?.toInt(),
      bookingAppFee: (bk?['app_fee'] as num?)?.toInt(),
      createdAt: DateTime.tryParse(m['created_at'] as String? ?? '') ?? DateTime.now(),
    );
  }

  bool get income => amount >= 0;

  /// Judul mutasi sesuai jenis (dipakai daftar riwayat).
  String get typeLabel => switch (type) {
        'earning' => 'Pesanan Selesai',
        'topup' => 'Setor Disetujui',
        'withdrawal' => 'Penarikan Saldo',
        'refund' => 'Refund Penarikan',
        _ => 'Penyesuaian',
      };
}

/// Ringkasan saldo teknisi untuk kartu saldo: saldo aktif + total
/// pendapatan bersih (earning neto) + total top-up yang disetujui.
/// Semua dihitung di klien dari tabel balance_transactions (RLS aman).
class TechnicianBalanceSummary {
  final double balance;

  /// Pendapatan KOTOR pesanan selesai = total harga − biaya aplikasi
  /// (diambil dari booking tiap transaksi earning — bukan 2× komisi).
  final int earnedTotal;

  /// Komisi platform (persen, kolom commission_amount) yang dipotong
  /// dari saldo saat pesanan selesai.
  final int commissionTotal;

  /// Total biaya aplikasi pesanan selesai — aturan platform: biaya app
  /// pelanggan IKUT dipotong langsung dari saldo teknisi (bersama komisi).
  final int appFeeTotal;

  /// Total setor yang disetujui admin.
  final int topupTotal;

  /// Total penarikan yang disetujui (dikurangi dari saldo).
  final int withdrawalTotal;

  /// Refund penarikan yang ditolak (kembali ke saldo).
  final int refundTotal;

  /// Saldo menurut ledger: setoran − komisi − penarikan + refund.
  /// Selisih terhadap [balance] = perubahan saldo tanpa baris mutasi
  /// (koreksi manual) atau bug data historis — ditampilkan sebagai catatan.
  final int expectedBalance;

  /// Waktu admin terakhir memilih "Ingatkan setor" (null = belum pernah).
  final DateTime? balanceReminderAt;

  const TechnicianBalanceSummary({
    required this.balance,
    this.earnedTotal = 0,
    this.commissionTotal = 0,
    this.appFeeTotal = 0,
    this.topupTotal = 0,
    this.withdrawalTotal = 0,
    this.refundTotal = 0,
    this.expectedBalance = 0,
    this.balanceReminderAt,
  });

  /// Total potongan platform dari saldo = komisi + biaya aplikasi.
  int get platformCutTotal => commissionTotal + appFeeTotal;

  /// Selisih saldo aktual vs ledger (≠ 0 = ada anomali data).
  int get mismatch => balance.round() - expectedBalance;

  /// Saldo untuk DITAMPILKAN — minimal Rp 0. Saldo mentah di database boleh
  /// negatif (komisi/denda melebihi setoran); UI menampilkan Rp 0 plus
  /// penjelasan [shortfall] supaya kartu saldo tidak tampak rusak.
  double get displayBalance => balance < 0 ? 0 : balance;

  /// Saldo mentah negatif → perlu penjelasan "komisi melebihi setoran".
  bool get isNegative => balance < 0;

  /// Besar kekurangan (positif) saat saldo negatif; 0 bila tidak negatif.
  double get shortfall => balance < 0 ? -balance : 0;

  /// Banner pengingat setor aktif: admin sudah mengingatkan DAN saldo masih
  /// 0/minus (hilang otomatis begitu saldo diisi).
  bool get needsDepositReminder => balanceReminderAt != null && balance <= 0;
}

/// Satu lowongan pekerjaan untuk teknisi: pesanan sudah dibayar,
/// belum diambil siapa pun (dari RPC available_jobs).
class AvailableJob {
  final String id;
  final String code;
  final String serviceName;
  final String? optionLabel;
  final String bookingDate; // yyyy-MM-dd
  final String bookingTime; // '08:00-10:00'
  final String address;
  final int totalPrice;
  final String customerName;
  final DateTime createdAt;

  /// Kategori layanan (id + nama) dari RPC available_jobs — dipakai
  /// filter keahlian di klien; null bila migrasi skill-filter belum
  /// dijalankan (kolom belum ada di hasil RPC).
  final String? serviceCategory;
  final String? serviceCategoryName;

  /// Jarak (meter) dari posisi on-duty teknisi ke titik lokasi job — dari
  /// RPC available_jobs_nearby; null bila GPS nonaktif atau job belum
  /// punya pin (available_jobs polos). Koordinat eksak job TIDAK ikut
  /// sebelum job diklaim (privasi pin).
  final double? distanceM;

  /// Pesanan punya titik lokasi (pin) — dari kolom has_pin RPC
  /// available_jobs/nearby. Hanya boolean, tanpa koordinat eksak
  /// (privasi pin sebelum job diklaim). Null = RPC lama tanpa kolom
  /// (migrasi has-pin belum dijalankan) → badge disembunyikan.
  final bool? hasPin;

  AvailableJob({
    required this.id,
    required this.code,
    required this.serviceName,
    this.optionLabel,
    required this.bookingDate,
    required this.bookingTime,
    required this.address,
    required this.totalPrice,
    required this.customerName,
    required this.createdAt,
    this.serviceCategory,
    this.serviceCategoryName,
    this.distanceM,
    this.hasPin,
  });

  factory AvailableJob.fromMap(Map<String, dynamic> m) => AvailableJob(
        id: m['id'] as String,
        code: (m['code'] as String?) ?? '',
        serviceName: (m['service_name'] as String?) ?? 'Layanan',
        optionLabel: m['option_label'] as String?,
        bookingDate: (m['booking_date'] as String?) ?? '',
        bookingTime: (m['booking_time'] as String?) ?? '',
        address: (m['address'] as String?) ?? '',
        totalPrice: (m['total_price'] as num?)?.toInt() ?? 0,
        customerName: (m['customer_name'] as String?) ?? 'Pelanggan',
        createdAt: DateTime.tryParse((m['created_at'] as String?) ?? '') ?? DateTime.now(),
        serviceCategory: m['service_category'] as String?,
        serviceCategoryName: m['service_category_name'] as String?,
        distanceM: (m['distance_m'] as num?)?.toDouble(),
        hasPin: m['has_pin'] as bool?,
      );
}

class Voucher {
  final String id;
  final String code;
  final int amount;
  final DateTime? expiresAt;
  final bool used;

  Voucher({required this.id, required this.code, required this.amount, this.expiresAt, required this.used});

  factory Voucher.fromMap(Map<String, dynamic> m) => Voucher(
        id: m['id'] as String,
        code: m['code'] as String,
        amount: (m['amount'] as num).toInt(),
        expiresAt: m['expires_at'] != null ? DateTime.parse(m['expires_at'] as String) : null,
        used: m['used_at'] != null,
      );
}

class Report {
  final String id;
  final String title;
  final String content;
  final String status; // open | reviewed | resolved
  final String? adminNote;
  final String? bookingCode;

  /// Path lampiran di bucket privat 'attachments' (mis. report-photos/…).
  /// JANGAN dipakai langsung sebagai URL — minta signed URL dulu
  /// (Api.createSignedUrl) karena bucket tidak publik.
  final String? attachmentUrl;
  final DateTime createdAt;

  Report({
    required this.id,
    required this.title,
    required this.content,
    required this.status,
    this.adminNote,
    this.bookingCode,
    this.attachmentUrl,
    required this.createdAt,
  });

  factory Report.fromMap(Map<String, dynamic> m) {
    final bk = m['bookings'] as Map<String, dynamic>?;
    return Report(
      id: m['id'] as String,
      title: m['title'] as String,
      content: m['content'] as String,
      status: (m['status'] as String?) ?? 'open',
      adminNote: m['admin_note'] as String?,
      bookingCode: bk?['code'] as String?,
      attachmentUrl: (m['attachment_url'] as String?)?.trim().isEmpty == true
          ? null
          : (m['attachment_url'] as String?),
      createdAt: DateTime.tryParse(m['created_at'] as String? ?? '') ?? DateTime.now(),
    );
  }

  String get statusLabel => switch (status) {
        'reviewed' => 'Sedang Ditinjau',
        'resolved' => 'Selesai',
        _ => 'Baru Masuk',
      };
}

const appFee = 5000; // sama dengan APP_FEE di lib/pricing.js web
const timeSlots = ['08:00-10:00', '10:00-12:00', '13:00-15:00', '15:00-17:00'];
/// Metode pembayaran hanya 2 (pilihan admin): COD atau transfer manual ke
/// rekening yang diinput admin (tabel app_settings, dibaca via Api.transferAccount).
const paymentMethods = [
  ('cod', 'Bayar di Tempat (COD)', 'Tunai saat teknisi datang'),
  ('transfer', 'Transfer Bank', 'Transfer manual ke rekening resmi Fixify'),
];

/// Label ramah kode keahlian teknisi ('ac' → 'Service AC'; id sama dengan
/// categories.id). Dipakai profil (read-only) & filter daftar Tersedia.
/// Kode tak dikenal ditampilkan apa adanya; null → string kosong.
String skillLabel(String? code) => switch (code) {
      'ac' => 'Service AC',
      'tukang' => 'Tukang rumah',
      'kendaraan' => 'Service kendaraan',
      'kebersihan' => 'Kebersihan & laundry',
      _ => code ?? '',
    };

/// Apakah keahlian teknisi ([skill]) cocok dengan kategori sebuah layanan?
///
/// Toleran terhadap DUA bentuk nilai yang ada di produksi:
///   * ID kategori — 'ac' (bentuk kanonik yang ditulis alur pendaftaran),
///   * LABEL lama  — 'Service AC' (hasil kurasi/manual atau data warisan).
/// Tanpa toleransi ini, teknisi ber-skill label tidak pernah melihat maupun
/// menerima pekerjaan yang sebenarnya sesuai keahliannya.
///
/// Aturan sengaja identik dengan `technician_matches_service()` di
/// [supabase/fix-technician-skill-matching.sql] dan filter push web
/// (`src/lib/skill-match.js`) supaya daftar, klaim, dan notifikasi tidak
/// pernah berbeda pendapat.
///
/// Fail-open (kompatibilitas RPC lama sebelum migrasi skill-filter):
///   * [skill] kosong/null → tanpa filter keahlian (cocok semua),
///   * [categoryId] null   → RPC lama tanpa kolom kategori → tampilkan
///     apa adanya (jangan menutup daftar karena metadata tak terbaca),
///   * [categoryName] null  → cocokkan lewat id saja.
bool skillMatchesCategory(String? skill, String? categoryId, String? categoryName) {
  final s = _normCategoryToken(skill);
  if (s.isEmpty) return true; // teknisi tanpa filter keahlian
  if (categoryId == null) return true; // RPC lama tanpa kolom kategori
  return s == _normCategoryToken(categoryId) ||
      s == _normCategoryToken(categoryName);
}

/// Normalisasi token keahlian/kategori untuk dibandingkan:
/// trim, huruf kecil, dan spasi ganda disatukan jadi satu spasi.
String _normCategoryToken(String? v) =>
    (v ?? '').trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');

/// Label ramah kode metode bayar ('transfer' → 'Transfer Bank'; kode lama
/// qris/virtual_account/e_wallet ditangani fallback di bawah). Null bila tak dikenal.
String? paymentMethodLabel(String code) {
  for (final m in paymentMethods) {
    if (m.$1 == code) return m.$2;
  }
  // Pesanan historis sebelum penyederhanaan metode bayar.
  return switch (code) {
    'qris' || 'virtual_account' || 'e_wallet' => 'Transfer Bank',
    _ => null,
  };
}

/// "850 m" / "2,4 km" — satu tempat supaya layar dan tes memakai aturan yang
/// sama persis. Mengembalikan kalimat yang bisa langsung ditampilkan bila
/// jaraknya belum diketahui (jangan tampilkan "null km").
String formatJarak(double? meter) {
  if (meter == null || meter.isNaN || meter < 0) return 'jarak belum tersedia';
  if (meter < 1000) return '${meter.round()} m';
  return '${(meter / 1000).toStringAsFixed(1).replaceAll('.', ',')} km';
}

/// Umur posisi teknisi dalam kalimat: "baru saja" / "5 menit lalu".
/// Dipakai bersama [formatJarak] supaya pelanggan tahu jarak itu diukur kapan.
String formatUmurLokasi(int? menit) {
  if (menit == null || menit < 0) return 'posisi belum tersedia';
  if (menit < 2) return 'posisi baru saja';
  if (menit < 60) return 'posisi $menit menit lalu';
  final jam = menit ~/ 60;
  return 'posisi $jam jam lalu';
}

/// Kontak + jarak teknisi untuk satu pesanan aktif — hasil RPC
/// `booking_technician_info`.
///
/// Koordinat teknisi SENGAJA tidak ikut: server hanya mengirim jarak (angka)
/// dan umur posisinya, sesuai aturan privasi di supabase/migrate-technician-gps.sql
/// ("koordinat teknisi tidak pernah terekspos"). Aplikasi karena itu tidak bisa
/// — dan tidak seharusnya — menggambar titik teknisi di peta.
class BookingTechInfo {
  final String? technicianId;
  final String? name;
  final String? avatarUrl;

  /// Nomor telepon teknisi; hanya terisi selama pesanan masih aktif
  /// (pending/paid/in_progress). Setelah selesai/dibatalkan server menutupnya.
  final String? phone;

  /// Pesanan masih berjalan → kontak boleh ditampilkan.
  final bool active;

  /// Jarak lurus teknisi → lokasi pesanan (meter). Null bila titik tidak ada
  /// atau posisinya sudah basi (>2 jam).
  final double? distanceM;

  /// Umur posisi terakhir (menit). Null bila teknisi belum pernah mengirim posisi.
  final int? locationAgeMin;

  const BookingTechInfo({
    this.technicianId,
    this.name,
    this.avatarUrl,
    this.phone,
    this.active = false,
    this.distanceM,
    this.locationAgeMin,
  });

  /// Belum ada teknisi ditugaskan (atau RPC belum dijalankan).
  static const kosong = BookingTechInfo();

  factory BookingTechInfo.fromRpc(Map<String, dynamic> m) {
    final t = (m['technician'] as Map?)?.cast<String, dynamic>();
    final telp = (t?['phone'] as String?)?.trim();
    return BookingTechInfo(
      technicianId: t?['id'] as String?,
      name: t?['name'] as String?,
      avatarUrl: t?['avatar_url'] as String?,
      phone: (telp == null || telp.isEmpty) ? null : telp,
      active: m['active'] == true,
      distanceM: (m['distance_m'] as num?)?.toDouble(),
      locationAgeMin: (m['location_age_min'] as num?)?.toInt(),
    );
  }

  bool get hasTechnician => technicianId != null;

  /// Kontak hanya berguna bila teknisi ada DAN pesanan masih aktif.
  bool get bolehDihubungi => hasTechnician && active && phone != null;

  /// Ringkasan siap tampil: "2,4 km · posisi 5 menit lalu".
  String get ringkasanJarak {
    if (!hasTechnician) return 'Teknisi belum ditugaskan.';
    if (distanceM == null) {
      return locationAgeMin == null
          ? 'Posisi teknisi belum tersedia.'
          : formatUmurLokasi(locationAgeMin);
    }
    return '${formatJarak(distanceM)} · ${formatUmurLokasi(locationAgeMin)}';
  }
}

/// Masa garansi + klaim untuk satu pesanan — hasil RPC `booking_warranty_info`.
///
/// [eligible] true berarti pelanggan masih boleh mengajukan klaim BARU
/// (belum lewat masa garansi dan belum pernah mengajukan).
class BookingWarrantyInfo {
  final int warrantyDays;
  final bool eligible;
  final int daysLeft;
  final String? claimId;
  final String? claimStatus; // open | approved | rejected
  final String? claimReason;
  final String? claimAdminNote;
  final String? revisitBookingId;

  const BookingWarrantyInfo({
    this.warrantyDays = 0,
    this.eligible = false,
    this.daysLeft = 0,
    this.claimId,
    this.claimStatus,
    this.claimReason,
    this.claimAdminNote,
    this.revisitBookingId,
  });

  factory BookingWarrantyInfo.fromRpc(Map<String, dynamic> m) {
    final c = (m['claim'] as Map?)?.cast<String, dynamic>();
    return BookingWarrantyInfo(
      warrantyDays: (m['warranty_days'] as num?)?.toInt() ?? 0,
      eligible: m['eligible'] == true,
      daysLeft: (m['days_left'] as num?)?.toInt() ?? 0,
      claimId: c?['id'] as String?,
      claimStatus: c?['status'] as String?,
      claimReason: c?['reason'] as String?,
      claimAdminNote: c?['admin_note'] as String?,
      revisitBookingId: c?['revisit_booking_id'] as String?,
    );
  }

  bool get adaKlaim => claimStatus != null;

  bool get ditolak => claimStatus == 'rejected';

  bool get disetujui => claimStatus == 'approved';

  bool get menunggu => claimStatus == 'open';

  /// Apakah kartu garansi perlu ditampilkan sama sekali di detail pesanan?
  /// Pesanan yang tidak bergaransi dan tidak punya klaim tidak menampilkan apa pun.
  bool get perluTampil => warrantyDays > 0 && (eligible || adaKlaim);

  String get ringkasan => switch (claimStatus) {
        'open' => 'Klaim garansi sedang ditinjau admin.',
        'approved' => 'Klaim garansi disetujui — kunjungan ulang gratis dijadwalkan.',
        'rejected' => 'Klaim garansi ditolak',
        _ => daysLeft > 0
            ? 'Bergaransi $daysLeft hari lagi'
            : 'Masa garansi $warrantyDays hari sudah berakhir',
      };
}

/// Normalkan nomor telepon Indonesia ke bentuk yang diterima wa.me/tel:
/// digit saja, berawalan kode negara tanpa '+'.
///
/// Nomor di profil teknisi bisa ditulis bermacam cara — '0812-3456-7890',
/// '+62 812 3456 7890', '62812...'. wa.me MENOLAK awalan '0', jadi nomor yang
/// tidak dinormalkan akan tampak seperti tombol yang tidak bekerja.
/// Mengembalikan null bila tidak ada digit yang cukup untuk dihubungi.
String? normalkanNomorId(String? nomor) {
  if (nomor == null) return null;
  var digit = nomor.replaceAll(RegExp(r'[^0-9]'), '');
  if (digit.isEmpty) return null;
  if (digit.startsWith('0')) {
    digit = '62${digit.substring(1)}';
  } else if (digit.startsWith('8')) {
    digit = '62$digit';
  }
  if (digit.length < 8) return null;
  return digit;
}

/// Apakah pelanggan boleh membatalkan / mengubah jadwal pesanan ini sendiri?
///
/// Aturan ini CERMIN dari RPC `cancel_booking`/`reschedule_booking`
/// (supabase/migrate-customer-self-service.sql) — tombol yang tampil harus
/// sama dengan yang akan diterima server, supaya pelanggan tidak melihat
/// pilihan yang selalu gagal. Server tetap memeriksa ulang semuanya.
///
/// [belumBayarBukti] = belum ada bukti bayar yang menunggu/menghuni konfirmasi
/// admin; pembatalan setelah transfer diblokir karena belum ada alur refund.
bool bolehBatalkanAtauUbahJadwal({
  required BookingStatus status,
  required String? paymentProofUrl,
  required bool paymentRejected,
  required DateTime sekarang,
  required String bookingDate,
  required String bookingTime,
  int rescheduleCount = 0,
}) {
  if (status != BookingStatus.pending && status != BookingStatus.paid) return false;
  // Bukti bayar sudah diunggah dan belum ditolak → uang mungkin sudah dikirim;
  // pembatalan harus lewat admin (belum ada alur refund).
  final buktiBelumAda = paymentProofUrl == null || paymentRejected;
  if (!buktiBelumAda) return false;
  return slotStart(bookingDate, bookingTime).isAfter(sekarang);
}

/// Batas jumlah perubahan jadwal per pesanan — sama dengan v_max_reschedule
/// di RPC reschedule_booking.
const maxReschedule = 3;

/// Awal slot ('2026-10-14', '08:00-10:00') sebagai waktu lokal.
/// Bentuk jam yang tak dikenal → awal hari, sama seperti booking_slot_start()
/// di database, supaya perbandingan klien & server tidak berbeda pendapat
/// pada data lama.
DateTime slotStart(String bookingDate, String bookingTime) {
  final tanggal = DateTime.tryParse(bookingDate.trim());
  if (tanggal == null) return DateTime(1970);
  final m = RegExp(r'^\s*(\d{1,2}):(\d{2})').firstMatch(bookingTime);
  if (m == null) return DateTime(tanggal.year, tanggal.month, tanggal.day);
  final jam = int.tryParse(m.group(1)!) ?? 0;
  final menit = int.tryParse(m.group(2)!) ?? 0;
  return DateTime(tanggal.year, tanggal.month, tanggal.day, jam.clamp(0, 23), menit.clamp(0, 59));
}
