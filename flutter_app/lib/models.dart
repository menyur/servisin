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

  Profile({required this.id, required this.name, required this.email, this.phone, this.address, this.avatarUrl, required this.role, this.serviceArea});

  factory Profile.fromMap(Map<String, dynamic> m) => Profile(
        id: m['id'] as String,
        name: (m['name'] as String?) ?? '',
        email: (m['email'] as String?) ?? '',
        phone: m['phone'] as String?,
        address: m['address'] as String?,
        avatarUrl: m['avatar_url'] as String?,
        role: (m['role'] as String?) ?? 'customer',
        serviceArea: m['service_area'] as String?,
      );
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
      paymentProofUrl: m['payment_proof_url'] as String?,
      paymentRejected: (m['payment_rejected'] as bool?) ?? false,
      paymentRejectionReason: m['payment_rejection_reason'] as String?,
      userId: m['user_id'] as String?,
      technicianId: m['technician_id'] as String?,
      technicianName: tech?['name'] as String?,
      technicianAvatar: tech?['avatar_url'] as String?,
      hasReview: hasReview,
    );
  }
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
  final DateTime createdAt;

  Report({
    required this.id,
    required this.title,
    required this.content,
    required this.status,
    this.adminNote,
    this.bookingCode,
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
const paymentMethods = [
  ('qris', 'QRIS', 'Scan & bayar lewat aplikasi apa saja'),
  ('virtual_account', 'Transfer Bank (VA)', 'Virtual account bank pilihanmu'),
  ('e_wallet', 'E-Wallet', 'GoPay, ShopeePay, dan lainnya'),
  ('cod', 'Bayar di Tempat', 'Tunai saat teknisi datang'),
];
