// Model data + parser aman dari Supabase (semua numeric dibaca sebagai num).
// Kolom mengikuti skema Supabase project web Servisin/Fixify.
import 'dart:convert';

import 'eta.dart';
import 'format.dart';

class Category {
  final String id;
  final String name;
  final String? description;
  final String icon;
  final int sortOrder;

  Category(
      {required this.id,
      required this.name,
      this.description,
      required this.icon,
      required this.sortOrder});

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
  final int?
      targetTab; // 1=Pesanan 2=Laporan 3=Voucher 4=Profil; null = tanpa aksi

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

  ServiceOption(
      {required this.id,
      required this.label,
      required this.price,
      this.durationEstimate});

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

  /// Harga per meter persegi (services.area_pricing): pelanggan mengisi
  /// panjang × lebar tiap bidang, subtotal = harga satuan × luas total.
  final bool areaPricing;

  /// Keterangan cara mengukur yang diatur admin (bisa null).
  final String? areaNote;

  /// `services.quantity_enabled` — admin menentukan apakah layanan ini boleh
  /// dipesan lebih dari satu (migrate-service-quantity-flag.sql). Null = data
  /// dari versi sebelum kolomnya ada → pakai aturan lama (AC & kendaraan).
  final bool? quantityEnabled;

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
    this.areaPricing = false,
    this.areaNote,
    this.quantityEnabled,
  });

  bool get hasOptions => options.isNotEmpty;

  /// Layanan ini dijual per luas (m²), bukan per unit.
  bool get usesArea => areaPricing;

  /// Keterangan luas siap tampil (teks cadangan bila admin mengosongkannya).
  String get areaNoteTeks {
    final t = (areaNote ?? '').trim();
    return t.isEmpty ? areaNoteDefault : t;
  }

  /// Layanan kendaraan: pelanggan memilih JENIS kendaraan (Motor/Mobil, lewat
  /// `service_options`) sekaligus jumlah kendaraannya. Harga satuan mengikuti
  /// jenis yang dipilih, lalu dikalikan jumlah (lihat
  /// supabase/migrate-vehicle-types.sql).
  bool get isVehicle => categoryId == 'kendaraan';

  /// Layanan ini boleh dipesan lebih dari satu dalam sekali kunjungan.
  /// Sumbernya setelan admin (`services.quantity_enabled`); data lama tanpa
  /// kolom itu memakai aturan kategori AC & kendaraan. Nilai quantity tetap
  /// dikirim untuk layanan lain (bawaan server = 1).
  bool get supportsQuantity =>
      quantityEnabled ?? (categoryId == 'ac' || isVehicle);

  factory Service.fromMap(Map<String, dynamic> m,
          {List<ServiceOption> options = const []}) =>
      Service(
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
        areaPricing: m['area_pricing'] == true,
        areaNote: m['area_note'] as String?,
        quantityEnabled: m['quantity_enabled'] as bool?,
      );
}

/// Satu alamat berlabel di buku alamat pelanggan
/// (profiles.saved_addresses; migrate-customer-address-book.sql).
///
/// `isPrimary` hanya boleh satu per akun. profiles.address selalu mengikuti
/// alamat utama, jadi kode lama yang membaca satu alamat tetap benar.
class SavedAddress {
  final String id;
  final String label;
  final String address;
  final double? lat;
  final double? lng;
  final bool isPrimary;

  const SavedAddress({
    required this.id,
    required this.label,
    required this.address,
    this.lat,
    this.lng,
    this.isPrimary = false,
  });

  factory SavedAddress.fromMap(Map<String, dynamic> m) {
    double? koord(dynamic v) {
      if (v is num) return v.toDouble();
      return double.tryParse('${v ?? ""}');
    }

    return SavedAddress(
      id: '${m['id'] ?? ""}',
      label: '${m['label'] ?? "Alamat"}'.trim().isEmpty
          ? 'Alamat'
          : '${m['label']}'.trim(),
      address: '${m['address'] ?? ""}'.trim(),
      lat: koord(m['lat']),
      lng: koord(m['lng']),
      isPrimary: m['is_primary'] == true,
    );
  }
}

/// Baca profiles.saved_addresses yang bisa datang sebagai List (jsonb) atau
/// String JSON (beberapa driver PostgREST mengirimnya begitu).
List<SavedAddress> parseSavedAddresses(dynamic raw) {
  dynamic data = raw;
  if (data is String) {
    try {
      data = jsonDecode(data);
    } catch (_) {
      return const [];
    }
  }
  if (data is! List) return const [];
  return [
    for (final e in data)
      if (e is Map)
        SavedAddress.fromMap(e.cast<String, dynamic>()),
  ];
}

class Profile {
  final String id;
  final String name;
  final String email;
  final String? phone;
  final String? address;

  /// Alamat berlabel pelanggan (Rumah/Kantor/…). Kosong untuk akun lama yang
  /// belum menjalankan migrasi — wizard tetap memakai [address].
  final List<SavedAddress> savedAddresses;
  final String? avatarUrl;
  final String role;
  final String?
      serviceArea; // daerah kerja teknisi (filter push pekerjaan baru)

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

  /// Status kurasi teknisi: 'pending' | 'approved' | 'rejected'
  /// (migrate-approval-status.sql). Pelanggan & admin selalu 'approved'.
  /// Hanya dibaca untuk ditampilkan — teknisi TIDAK boleh mengubahnya sendiri
  /// (RLS & trigger menolak perubahan approval_status dari klien).
  final String approvalStatus;

  Profile(
      {required this.id,
      required this.name,
      required this.email,
      this.phone,
      this.address,
      this.savedAddresses = const [],
      this.avatarUrl,
      required this.role,
      this.serviceArea,
      this.skill,
      this.balance = 0,
      this.balanceReminderAt,
      this.approvalStatus = 'approved'});

  factory Profile.fromMap(Map<String, dynamic> m) => Profile(
        id: m['id'] as String,
        name: (m['name'] as String?) ?? '',
        email: (m['email'] as String?) ?? '',
        phone: m['phone'] as String?,
        address: m['address'] as String?,
        savedAddresses: parseSavedAddresses(m['saved_addresses']),
        avatarUrl: m['avatar_url'] as String?,
        role: (m['role'] as String?) ?? 'customer',
        serviceArea: m['service_area'] as String?,
        skill: m['skill'] as String?,
        balance: _parseNum(m['balance']),
        balanceReminderAt: _parseDate(m['balance_reminder_at']),
        // Kolom bisa belum ada di instalasi lama; jangan sembunyikan teknisi
        // yang sebenarnya sudah disetujui hanya karena migrasi belum jalan.
        approvalStatus:
            ((m['approval_status'] as String?) ?? 'approved').toLowerCase(),
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

/// Data profil teknisi yang masih perlu dilengkapi — label siap tampil.
///
/// Dipakai layar Profil (pengingat) dan tab Profil (titik peringatan), serta
/// penentu tujuan awal setelah login: teknisi yang datanya belum lengkap
/// dibawa ke Profil supaya tahu persis apa yang harus diisi.
///
/// Hanya untuk peran teknisi — pelanggan tidak diminta melengkapi area kerja.
/// `skill` tidak ikut: nilainya ditetapkan admin saat kurasi pendaftaran, jadi
/// teknisi tidak bisa memperbaikinya sendiri. Foto profil juga opsional.
/// "area layanan" tetap dihitung walau boleh dikosongkan (artinya semua area):
/// tanpa area, notifikasi pekerjaan baru tidak bisa disaring sesuai lokasinya,
/// jadi teknisi baru perlu melihat dan memutuskan sendiri.
List<String> dataProfilKurang(Profile? p) {
  if (p == null || p.role != 'technician') return const <String>[];
  return <String>[
    if (p.name.trim().isEmpty) 'nama lengkap',
    if ((p.phone ?? '').trim().isEmpty) 'nomor HP',
    if ((p.address ?? '').trim().isEmpty) 'alamat',
    if ((p.serviceArea ?? '').trim().isEmpty) 'area layanan',
  ];
}

/// Satu pesan chat pelanggan ↔ teknisi untuk sebuah pesanan.
class ChatMessage {
  final String id;
  final String bookingId;
  final String senderId;
  final String body;
  final DateTime createdAt;

  ChatMessage(
      {required this.id,
      required this.bookingId,
      required this.senderId,
      required this.body,
      required this.createdAt});

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

  /// Label status untuk pesanan yang SUDAH punya teknisi.
  ///
  /// `paid` hanya berarti "pembayaran diterima" — bukan "belum ada teknisi".
  /// Menampilkan "Menunggu Penugasan" setelah teknisi ditugaskan membuat
  /// pelanggan mengira belum ada yang akan datang (dan teknisi mengira
  /// tugasnya belum diberikan). Status lain tidak berubah karena tidak
  /// bergantung pada penugasan.
  String labelFor({bool hasTechnician = false}) =>
      hasTechnician && this == BookingStatus.paid
          ? 'Dibayar — Teknisi Ditugaskan'
          : label;
}

/// Satu baris varian di dalam pesanan (tabel booking_items).
///
/// Harga satuan & line_total adalah SNAPSHOT katalog saat pesanan dibuat,
/// jadi mengubah harga layanan nanti tidak mengubah tagihan/riwayat. Satu
/// pesanan bisa memuat beberapa baris (mis. 1 unit 1 PK + 2 unit 1,5 PK).
class BookingItem {
  final String? optionId;
  final String label;
  final int unitPrice;
  final int quantity;
  final int lineTotal;

  /// Luas baris (m²) — hanya untuk layanan per meter persegi; harga satuannya
  /// berarti rupiah per m², bukan per unit.
  final double? area;

  /// Urutan tampil (0 = pertama) — dipertahankan server agar rincian tidak
  /// berpindah-pindah antar pemuatan.
  final int position;

  const BookingItem({
    this.optionId,
    required this.label,
    required this.unitPrice,
    required this.quantity,
    required this.lineTotal,
    this.area,
    this.position = 0,
  });

  /// Label kosong (data lama/impor) jangan sampai menghasilkan baris hampa.
  static String _label(dynamic v) {
    final s = '${v ?? ''}'.trim();
    return s.isEmpty ? 'Layanan' : s;
  }

  factory BookingItem.fromMap(Map<String, dynamic> m) => BookingItem(
        optionId: m['option_id'] as String?,
        label: _label(m['label']),
        unitPrice: (m['unit_price'] as num?)?.toInt() ?? 0,
        quantity: ((m['quantity'] as num?)?.toInt() ?? 1)
            .clamp(1, maxServiceQuantity)
            .toInt(),
        lineTotal: (m['line_total'] as num?)?.toInt() ?? 0,
        area: (m['area'] as num?)?.toDouble(),
        position: (m['position'] as num?)?.toInt() ?? 0,
      );

  /// "1 PK ×1" — label baris beserta jumlahnya. Baris area ditulis
  /// "Cat dinding · 12,5 m²" (jumlah unitnya selalu 1).
  String get displayLabel {
    final a = area;
    if (a != null && a > 0) return '$label · ${formatArea(a)}';
    return '$label ×$quantity';
  }
}

/// Baca daftar baris pesanan dari respons PostgREST/RPC; urutkan menurut
/// position supaya urutan join yang tidak dijamin tidak mengacak rincian.
List<BookingItem> bookingItemsFrom(dynamic raw) {
  if (raw is! List) return const <BookingItem>[];
  final items = raw
      .whereType<Map>()
      .map((m) => BookingItem.fromMap(m.cast<String, dynamic>()))
      .toList();
  items.sort((a, b) => a.position.compareTo(b.position));
  return items;
}

class Booking {
  final String id;
  final String code;
  final String serviceName;
  final String? optionLabel;

  /// services.id — dipakai tombol "Pesan lagi" untuk membuka wizard layanan
  /// yang sama tanpa menebak dari namanya.
  final String? serviceId;

  /// Kategori layanan (services.category_id) — dipakai untuk menyebut satuan
  /// pesanan dengan benar: kendaraan → "kendaraan", lainnya → "unit".
  final String? serviceCategory;

  /// TOTAL unit dalam pesanan (bookings.quantity) = jumlah seluruh baris.
  /// Untuk pesanan satu varian, harga satuan = subtotal_price / quantity.
  /// Data lama / RPC lama tidak mengirim kolom ini → 1.
  final int quantity;

  /// Rincian per varian (booking_items). Kosong pada respons lama / pesanan
  /// web lama yang belum punya baris item — tampilan jatuh ke field lama
  /// (optionLabel + quantity + subtotalPrice).
  final List<BookingItem> items;

  /// Luas area (m²) untuk layanan per meter persegi (cat dinding). Null untuk
  /// layanan per unit; harga satuan pesanan area adalah rupiah per m².
  final double? area;
  final int subtotalPrice;
  final int appFee;
  final int discountAmount;

  /// Porsi total yang berasal dari biaya tambahan yang DISETUJUI pelanggan
  /// (bookings.extra_charge_total; 0 untuk data lama). totalPrice sudah
  /// termasuk angka ini.
  final int extraChargeTotal;
  final int totalPrice;
  final BookingStatus status;
  final String bookingDate; // yyyy-MM-dd
  final String bookingTime; // '08:00-10:00'
  final String address;
  final String? notes;
  final String? paymentMethod;
  final String? paymentProofUrl;

  /// Path objek foto bukti pekerjaan (bucket privat `booking-proofs`):
  /// kondisi sebelum dan hasil akhir. NULL = belum dilampirkan.
  /// Yang disimpan path, bukan URL — bucket-nya privat.
  final String? beforePhotoPath;
  final String? afterPhotoPath;

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

  /// Kapan teknisi melaporkan pelanggan tidak ada di lokasi. Null = tidak ada
  /// laporan. Kolom baru — data lama/RPC lama mengembalikan null.
  final DateTime? noShowAt;

  /// Kapan pelanggan menekan "Saya di sini" setelah laporan no-show.
  final DateTime? customerPresentAt;

  /// Pelanggan belum merespons laporan no-show → teknisi/pelanggan melihat
  /// ajakan bertindak.
  bool get noShowMenungguJawaban =>
      noShowAt != null && customerPresentAt == null;

  Booking({
    required this.id,
    required this.code,
    required this.serviceName,
    this.serviceId,
    this.optionLabel,
    this.serviceCategory,
    this.quantity = 1,
    this.items = const <BookingItem>[],
    this.area,
    required this.subtotalPrice,
    required this.appFee,
    required this.discountAmount,
    this.extraChargeTotal = 0,
    required this.totalPrice,
    required this.status,
    required this.bookingDate,
    required this.bookingTime,
    required this.address,
    this.notes,
    this.paymentMethod,
    this.paymentProofUrl,
    this.beforePhotoPath,
    this.afterPhotoPath,
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
    this.noShowAt,
    this.customerPresentAt,
    this.lat,
    this.lng,
  });

  /// Salinan pesanan dengan total (dan porsi biaya tambahan) yang baru.
  ///
  /// Dipakai setelah pelanggan menyetujui biaya tambahan: server sudah
  /// mengembalikan total resmi lewat `decide_extra_charge`, jadi layar detail
  /// DAN struk yang dibuka dari situ langsung menampilkan angka yang benar —
  /// tanpa menunggu pesanan dimuat ulang dari jaringan. Tanpa ini, struk yang
  /// dibuka segera setelah menekan "Setujui" masih menampilkan total lama.
  Booking denganBiayaTambahan({
    required int extraChargeTotal,
    required int totalPrice,
  }) =>
      Booking(
        id: id,
        code: code,
        serviceName: serviceName,
        serviceId: serviceId,
        optionLabel: optionLabel,
        serviceCategory: serviceCategory,
        quantity: quantity,
        items: items,
        area: area,
        subtotalPrice: subtotalPrice,
        appFee: appFee,
        discountAmount: discountAmount,
        extraChargeTotal: extraChargeTotal,
        totalPrice: totalPrice,
        status: status,
        bookingDate: bookingDate,
        bookingTime: bookingTime,
        address: address,
        notes: notes,
        paymentMethod: paymentMethod,
        paymentProofUrl: paymentProofUrl,
        beforePhotoPath: beforePhotoPath,
        afterPhotoPath: afterPhotoPath,
        paymentRejected: paymentRejected,
        paymentRejectionReason: paymentRejectionReason,
        technicianId: technicianId,
        technicianName: technicianName,
        technicianAvatar: technicianAvatar,
        userId: userId,
        hasReview: hasReview,
        rescheduleCount: rescheduleCount,
        createdAt: createdAt,
        paymentConfirmedAt: paymentConfirmedAt,
        completedAt: completedAt,
        noShowAt: noShowAt,
        customerPresentAt: customerPresentAt,
        lat: lat,
        lng: lng,
      );

  /// Apakah pesanan memuat lebih dari satu varian (rincian per baris).
  bool get multiVarian => items.length > 1;

  /// Pesanan layanan kendaraan: jumlahnya disebut "kendaraan", bukan "unit".
  bool get isVehicleOrder => serviceCategory == 'kendaraan';
  String get quantityWord => isVehicleOrder ? 'kendaraan' : 'unit';
  String get quantityLabel =>
      isVehicleOrder ? 'Jumlah kendaraan' : 'Jumlah unit';

  /// Label ringkas untuk kartu daftar: pesanan multi-varian tidak perlu
  /// menulis semua label (bisa terpotong ellipsis), cukup jumlah varian.
  /// Pesanan per m² menampilkan luasnya (bukan "unit").
  String get labelKartu {
    final a = area;
    if (!multiVarian && a != null && a > 0) {
      final dasar = labelLayananJumlah(serviceName, optionLabel, 1);
      return '$dasar · ${formatArea(a)}';
    }
    return multiVarian
        ? '$serviceName · ${items.length} varian · $quantity $quantityWord'
        : labelLayananJumlah(serviceName, optionLabel, quantity,
            unitWord: quantityWord);
  }

  /// [fallbackServiceName] & [fallbackServiceCategory] dipakai untuk respons RPC
  /// pembuatan pesanan: RPC hanya mengembalikan baris `bookings` (tanpa join
  /// `services`), jadi nama layanan & kategorinya diisi dari katalog yang
  /// dipakai wizard — struk langsung benar (mis. "...— Mobil · 3 kendaraan").
  factory Booking.fromMap(
    Map<String, dynamic> m, {
    bool hasReview = false,
    List<BookingItem>? items,
    String? fallbackServiceName,
    String? fallbackServiceCategory,
  }) {
    final tech = m['technician'] as Map<String, dynamic>?;
    final svc = m['services'] as Map<String, dynamic>?;
    // Varian disimpan sebagai teks option_label di bookings (bukan FK join).
    final optLabel = m['option_label'] as String?;
    return Booking(
      id: m['id'] as String,
      code: (m['code'] as String?) ?? '',
      serviceName:
          (svc?['name'] as String?) ?? fallbackServiceName ?? 'Layanan',
      optionLabel: optLabel,
      serviceCategory:
          (svc?['category_id'] as String?) ?? fallbackServiceCategory,
      // 1 = data lama / RPC sebelum migrasi jumlah unit.
      quantity: ((m['quantity'] as num?)?.toInt() ?? 1)
          .clamp(1, maxServiceQuantity)
          .toInt(),
      items: items ?? bookingItemsFrom(m['booking_items']),
      area: (m['area'] as num?)?.toDouble(),
      subtotalPrice: (m['subtotal_price'] as num?)?.toInt() ?? 0,
      appFee: (m['app_fee'] as num?)?.toInt() ?? 0,
      discountAmount: (m['discount_amount'] as num?)?.toInt() ?? 0,
      extraChargeTotal: (m['extra_charge_total'] as num?)?.toInt() ?? 0,
      totalPrice: (m['total_price'] as num?)?.toInt() ?? 0,
      status: bookingStatusFrom(m['status'] as String?),
      bookingDate: (m['booking_date'] as String?) ?? '',
      bookingTime: (m['booking_time'] as String?) ?? '',
      address: (m['address'] as String?) ?? '',
      notes: m['notes'] as String?,
      serviceId: m['service_id'] as String?,
      paymentMethod: m['payment_method'] as String?,
      lat: (m['lat'] as num?)?.toDouble(),
      lng: (m['lng'] as num?)?.toDouble(),
      paymentProofUrl: m['payment_proof_url'] as String?,
      beforePhotoPath: m['before_photo_path'] as String?,
      afterPhotoPath: m['after_photo_path'] as String?,
      paymentRejected: (m['payment_rejected'] as bool?) ?? false,
      paymentRejectionReason: m['payment_rejection_reason'] as String?,
      userId: m['user_id'] as String?,
      rescheduleCount: (m['reschedule_count'] as num?)?.toInt() ?? 0,
      technicianId: m['technician_id'] as String?,
      technicianName: tech?['name'] as String?,
      technicianAvatar: tech?['avatar_url'] as String?,
      hasReview: hasReview,
      createdAt: m['created_at'] == null
          ? null
          : DateTime.parse(m['created_at'] as String),
      paymentConfirmedAt: m['payment_confirmed_at'] == null
          ? null
          : DateTime.parse(m['payment_confirmed_at'] as String),
      completedAt: m['completed_at'] == null
          ? null
          : DateTime.parse(m['completed_at'] as String),
      noShowAt: m['no_show_at'] == null
          ? null
          : DateTime.tryParse(m['no_show_at'] as String),
      customerPresentAt: m['customer_present_at'] == null
          ? null
          : DateTime.tryParse(m['customer_present_at'] as String),
    );
  }
}

/// Usulan biaya tambahan di lokasi (supabase/migrate-no-show-extra-charges.sql).
///
/// Hanya usulan berstatus `approved` yang sudah masuk ke total pesanan. Yang
/// masih `pending` BELUM boleh dianggap utang: pelanggan belum setuju.
class BookingExtraCharge {
  final String id;
  final String bookingId;
  final int amount;
  final String reason;
  final String status;
  final String? photoPath;
  final DateTime? createdAt;
  final DateTime? decidedAt;

  const BookingExtraCharge({
    required this.id,
    required this.bookingId,
    required this.amount,
    required this.reason,
    required this.status,
    this.photoPath,
    this.createdAt,
    this.decidedAt,
  });

  factory BookingExtraCharge.fromMap(Map<String, dynamic> m) =>
      BookingExtraCharge(
        id: (m['id'] as String?) ?? '',
        bookingId: (m['booking_id'] as String?) ?? '',
        amount: (m['amount'] as num?)?.toInt() ?? 0,
        reason: (m['reason'] as String?) ?? '',
        status: (m['status'] as String?) ?? 'pending',
        photoPath: m['photo_path'] as String?,
        createdAt: m['created_at'] == null
            ? null
            : DateTime.tryParse(m['created_at'] as String),
        decidedAt: m['decided_at'] == null
            ? null
            : DateTime.tryParse(m['decided_at'] as String),
      );

  bool get pending => status == 'pending';
  bool get disetujui => status == 'approved';

  /// Salinan dengan keputusan pelanggan yang BARU diterima server.
  ///
  /// Dipakai layar detail agar kartu langsung berubah menjadi
  /// "Disetujui"/"Ditolak" tanpa menunggu daftar dimuat ulang dari jaringan
  /// (dulu status baru berubah setelah dua perjalanan jaringan berurutan,
  /// sehingga tombol lama masih terlihat dan bisa ditekan lagi).
  BookingExtraCharge denganKeputusan(bool setuju) => BookingExtraCharge(
        id: id,
        bookingId: bookingId,
        amount: amount,
        reason: reason,
        status: setuju ? 'approved' : 'rejected',
        photoPath: photoPath,
        createdAt: createdAt,
        decidedAt: DateTime.now(),
      );

  String get labelStatus => switch (status) {
        'approved' => 'Disetujui',
        'rejected' => 'Ditolak',
        _ => 'Menunggu persetujuan',
      };
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
  final int?
      bookingTotalPrice; // join ke bookings(total_price) — nilai pekerjaan
  final int?
      bookingAppFee; // join ke bookings(app_fee) — biaya app ikut dipotong dari saldo
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
      createdAt:
          DateTime.tryParse(m['created_at'] as String? ?? '') ?? DateTime.now(),
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

/// Satu pengajuan uang teknisi beserta keputusan admin.
///
/// Dua sumber digabung menjadi satu daftar "Permintaan Saldo" agar teknisi
/// melihat nasib uangnya di satu tempat:
///   * `balance_deposits` (SETOR) — saldo bertambah setelah bukti diverifikasi;
///   * `balance_withdrawals` (TARIK) — saldo sudah DITAHAN saat pengajuan dan
///     kembali penuh sebagai `refund` bila admin menolak.
/// Penolakan selalu membawa [rejectionReason]; tanpa menampilkannya teknisi
/// hanya melihat "ditolak" tanpa tahu apa yang harus diperbaiki.
class BalanceRequest {
  final String id;
  final String kind; // 'deposit' | 'withdrawal'
  final int amount;
  final String status; // pending | approved | rejected
  final String? rejectionReason;
  final DateTime createdAt;
  final DateTime? reviewedAt;

  /// Rekening tujuan (hanya penarikan — setoran memakai rekening platform).
  final String? bankName;
  final String? accountNumber;
  final String? accountHolder;

  BalanceRequest({
    required this.id,
    required this.kind,
    required this.amount,
    required this.status,
    this.rejectionReason,
    required this.createdAt,
    this.reviewedAt,
    this.bankName,
    this.accountNumber,
    this.accountHolder,
  });

  factory BalanceRequest.withdrawal(Map<String, dynamic> m) => BalanceRequest(
        id: m['id'] as String,
        kind: 'withdrawal',
        amount: (m['amount'] as num?)?.round() ?? 0,
        status: (m['status'] as String?) ?? 'pending',
        rejectionReason: m['rejection_reason'] as String?,
        createdAt: DateTime.tryParse((m['created_at'] as String?) ?? '') ??
            DateTime.now(),
        reviewedAt: DateTime.tryParse((m['reviewed_at'] as String?) ?? ''),
        bankName: m['bank_name'] as String?,
        accountNumber: m['account_number'] as String?,
        accountHolder: m['account_holder'] as String?,
      );

  factory BalanceRequest.deposit(Map<String, dynamic> m) => BalanceRequest(
        id: m['id'] as String,
        kind: 'deposit',
        amount: (m['amount'] as num?)?.round() ?? 0,
        status: (m['status'] as String?) ?? 'pending',
        rejectionReason: m['rejection_reason'] as String?,
        createdAt: DateTime.tryParse((m['created_at'] as String?) ?? '') ??
            DateTime.now(),
        reviewedAt: DateTime.tryParse((m['reviewed_at'] as String?) ?? ''),
      );

  bool get isWithdrawal => kind == 'withdrawal';
  bool get isDeposit => kind == 'deposit';
  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';
  bool get isRejected => status == 'rejected';

  String get kindLabel => isWithdrawal ? 'Tarik saldo' : 'Setor saldo';

  String get statusLabel => switch (status) {
        'approved' => 'Disetujui',
        'rejected' => 'Ditolak',
        _ => 'Menunggu verifikasi',
      };

  /// "BCA · 1234••••90" — cukup untuk memastikan tujuannya benar tanpa
  /// memajang nomor penuh di daftar yang mungkin ikut terlihat orang lain.
  String get accountLabel => [
        (bankName ?? '').trim(),
        maskAccount(accountNumber),
      ].where((s) => s.isNotEmpty).join(' · ');

  /// Nomor rekening disamarkan: 4 digit awal + 2 digit akhir. Nomor pendek
  /// (≤ 8 karakter) hanya menyisakan 2+2 agar tidak justru terbaca utuh.
  static String maskAccount(String? raw) {
    final s = (raw ?? '').trim();
    if (s.isEmpty) return '';
    if (s.length <= 4) return s;
    if (s.length <= 8) {
      return '${s.substring(0, 2)}••${s.substring(s.length - 2)}';
    }
    return '${s.substring(0, 4)}••••${s.substring(s.length - 2)}';
  }
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

  /// Saldo menurut ledger: setoran − komisi − penarikan + refund + penyesuaian.
  /// Selisih terhadap [balance] = perubahan saldo tanpa baris mutasi atau bug
  /// data historis — ditampilkan sebagai catatan. Penyesuaian IKUT dihitung:
  /// koreksi admin (migrate-admin-balance-adjustment.sql) dan penghapusan
  /// piutang menulis baris `adjustment`, dan mengabaikannya membuat koreksi
  /// yang sah tampil sebagai "Ada selisih".
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

  /// Boleh mengambil pekerjaan BARU hanya bila saldo DI ATAS nol.
  ///
  /// Kenapa: potongan saat pekerjaan selesai (komisi + biaya aplikasi) diambil
  /// PENUH dari saldo dan saldo boleh menjadi MINUS — nilai minus itu PIUTANG
  /// teknisi (supabase/enforce-full-charge-balance.sql; ringkasan aturan di
  /// docs/balance-rule.md). Gerbang `saldo > 0` inilah yang menagihnya: teknisi
  /// wajib menyetor lebih dulu, jadi piutang tak pernah menumpuk lintas pekerjaan.
  ///
  /// Aturan ini ditegakkan SERVER (`claim_job` → `kode: 'saldo_habis'`, lihat
  /// supabase/migrate-claim-min-balance.sql); yang ini hanya sisi tampilan supaya
  /// tombolnya tidak tampak bisa diketik tanpa hasil.
  bool get bolehAmbilPekerjaan => balance > 0;

  /// Kalimat sebab tombol "Ambil Pekerjaan" dimatikan (null = boleh).
  ///
  /// Satu tempat untuk strip saldo, kartu lowongan, DAN pesan setelah penolakan
  /// server — supaya tiga tampilan itu tidak pernah berkata berbeda.
  String? get sebabTidakBolehAmbil => bolehAmbilPekerjaan
      ? null
      : 'Saldo kamu belum terisi (atau masih minus) — isi saldo dulu untuk bisa ambil pekerjaan baru. Setoran menutup kekurangan komisi + biaya aplikasi lebih dulu.';
}

/// Satu lowongan pekerjaan untuk teknisi: pesanan sudah dibayar,
/// belum diambil siapa pun (dari RPC available_jobs).
class AvailableJob {
  final String id;
  final String code;
  final String serviceName;
  final String? optionLabel;

  /// Jumlah unit pesanan — dari kolom quantity RPC daftar pekerjaan.
  /// Null/tidak ada pada RPC lama (migrasi jumlah unit belum dijalankan) → 1.
  final int quantity;

  /// Luas area (m²) untuk layanan per meter persegi (cat dinding). Null pada
  /// layanan per unit / RPC lama (migrate-service-area-pricing belum jalan).
  final double? area;
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
    this.quantity = 1,
    this.area,
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
        quantity: ((m['quantity'] as num?)?.toInt() ?? 1)
            .clamp(1, maxServiceQuantity)
            .toInt(),
        area: (m['area'] as num?)?.toDouble(),
        bookingDate: (m['booking_date'] as String?) ?? '',
        bookingTime: (m['booking_time'] as String?) ?? '',
        address: (m['address'] as String?) ?? '',
        totalPrice: (m['total_price'] as num?)?.toInt() ?? 0,
        customerName: (m['customer_name'] as String?) ?? 'Pelanggan',
        createdAt: DateTime.tryParse((m['created_at'] as String?) ?? '') ??
            DateTime.now(),
        serviceCategory: m['service_category'] as String?,
        serviceCategoryName: m['service_category_name'] as String?,
        distanceM: (m['distance_m'] as num?)?.toDouble(),
        hasPin: m['has_pin'] as bool?,
      );

  /// Label kartu job untuk teknisi: layanan per m² menampilkan luasnya,
  /// bukan jumlah unit (harga pesanan area adalah rupiah per m²).
  String get labelKartu {
    final a = area;
    if (a != null && a > 0) {
      final dasar = optionLabel == null || optionLabel!.trim().isEmpty
          ? serviceName
          : '$serviceName — $optionLabel';
      return '$dasar · ${formatArea(a)}';
    }
    return labelLayananJumlah(serviceName, optionLabel, quantity);
  }
}

class Voucher {
  final String id;
  final String code;
  final int amount;
  final DateTime? expiresAt;
  final bool used;

  Voucher(
      {required this.id,
      required this.code,
      required this.amount,
      this.expiresAt,
      required this.used});

  factory Voucher.fromMap(Map<String, dynamic> m) => Voucher(
        id: m['id'] as String,
        code: m['code'] as String,
        amount: (m['amount'] as num).toInt(),
        expiresAt: m['expires_at'] != null
            ? DateTime.parse(m['expires_at'] as String)
            : null,
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
      createdAt:
          DateTime.tryParse(m['created_at'] as String? ?? '') ?? DateTime.now(),
    );
  }

  String get statusLabel => reportStatusLabel(status);
}

/// Label ramah status laporan — dipakai kartu laporan DAN teks notifikasi
/// realtime (snack) supaya keduanya tidak pernah berbeda kata.
String reportStatusLabel(String status) => switch (status) {
      'reviewed' => 'Sedang Ditinjau',
      'resolved' => 'Selesai',
      _ => 'Baru Masuk',
    };

/// Event realtime UPDATE sebuah laporan yang ditulis pengguna ini — praktisnya
/// admin menanggapi (status `reviewed`/`resolved` dan/atau catatan admin).
///
/// Hanya admin yang boleh `update` tabel reports (policy di
/// `supabase/migrate-reports.sql`), jadi event ini TIDAK PERNAH pantulan aksi
/// pengguna sendiri — tidak perlu mekanisme penahanan seperti pada pesanan.
class ReportUpdate {
  final String id;
  final String title;
  final String status;
  final String? prevStatus;
  final String? adminNote;

  const ReportUpdate({
    required this.id,
    required this.title,
    required this.status,
    this.prevStatus,
    this.adminNote,
  });

  bool get statusChanged => status != prevStatus;

  String get statusLabel => reportStatusLabel(status);
}

/// Teks snack untuk [u], atau `null` bila event tidak layak diberitahukan
/// (status sama seperti sebelumnya) — murni, dipakai MainShell.
String? reportUpdateSnack(ReportUpdate u) {
  if (!u.statusChanged) return null;
  final judul = u.title.trim().isEmpty ? 'Laporan' : u.title.trim();
  return 'Laporan "$judul" — ${u.statusLabel}';
}

const appFee = 5000; // sama dengan APP_FEE di lib/pricing.js web

/// Batas jumlah unit satu pesanan — sama dengan check constraint
/// `bookings_quantity_check` dan validasi RPC create_booking
/// (supabase/migrate-booking-quantity.sql).
const maxServiceQuantity = 20;

/// Batas luas layanan per meter persegi — SAMA dengan validasi RPC
/// (supabase/migrate-service-area-pricing.sql). Bedanya angka di sini membuat
/// pelanggan melihat total yang akan ditolak server setelah menekan pesan.
const double minServiceArea = 0.5;
const double maxServiceArea = 2000;

/// Keterangan harga yang tampil pada SEMUA layanan: nominal katalog adalah
/// harga jasa, bukan termasuk sparepart/suku cadang/bahan yang dipakai teknisi.
const hargaJasaNote = 'Harga jasa — di luar sparepart, suku cadang, dan bahan.';

/// Keterangan luas bawaan bila admin belum mengisi services.area_note.
const areaNoteDefault =
    'Isi Panjang × Lebar tiap bidang (dalam meter). Luasnya dijumlahkan otomatis.';

/// Luas satu bidang (m²) dari panjang × lebar; null bila belum sah.
double? luasBidang(String panjang, String lebar) {
  final p = double.tryParse(panjang.trim().replaceAll(',', '.'));
  final l = double.tryParse(lebar.trim().replaceAll(',', '.'));
  if (p == null || l == null || p <= 0 || l <= 0) return null;
  return (p * l * 100).roundToDouble() / 100;
}

/// Luas yang sah (0,5–2000 m²), dibulatkan 2 desimal; null bila tidak sah.
double? normalisasiLuas(double? luas) {
  if (luas == null || !luas.isFinite) return null;
  if (luas < minServiceArea || luas > maxServiceArea) return null;
  return (luas * 100).roundToDouble() / 100;
}

/// Subtotal satu baris area = harga per m² × luas (dibulatkan ke rupiah).
int subtotalLuas(num hargaPerM2, double? luas) {
  final l = normalisasiLuas(luas);
  if (l == null) return 0;
  final h = hargaPerM2 < 0 ? 0 : hargaPerM2;
  return (h * l).round();
}

/// Rincian tagihan satu pesanan, dihitung dengan aturan yang SAMA seperti
/// server (RPC create_booking): subtotal = harga satuan × jumlah unit,
/// diskon voucher tidak melebihi subtotal + biaya aplikasi, total tidak
/// pernah negatif.
///
/// [appFee] WAJIB diisi tarif yang sedang berlaku (Api.fetchAppFee). Angka
/// bawaan hanya jaring pengaman sebelum setelan selesai dibaca — jangan
/// memakai konstanta [appFee] untuk menagihkan.
class BookingPrice {
  final int subtotal;
  final int appFee;
  final int discount;
  final int total;

  const BookingPrice({
    required this.subtotal,
    required this.appFee,
    required this.discount,
    required this.total,
  });
}

BookingPrice hitungHargaBooking({
  required int unitPrice,
  required int quantity,
  required int appFee,
  int discount = 0,
}) {
  final unit = unitPrice < 0 ? 0 : unitPrice;
  final qty = quantity.clamp(1, maxServiceQuantity).toInt();
  return hitungHargaDariSubtotal(
      subtotal: unit * qty, appFee: appFee, discount: discount);
}

/// Versi untuk pesanan multi-varian: subtotal sudah dijumlahkan dari tiap
/// baris (harga satuan × jumlah), biaya aplikasi tetap SEKALI per pesanan.
BookingPrice hitungHargaDariSubtotal({
  required int subtotal,
  required int appFee,
  int discount = 0,
}) {
  final sub = subtotal < 0 ? 0 : subtotal;
  final fee = appFee.clamp(0, 1000000).toInt();
  final disc = discount.clamp(0, sub + fee).toInt();
  return BookingPrice(
    subtotal: sub,
    appFee: fee,
    discount: disc,
    total: sub + fee - disc,
  );
}

const timeSlots = ['08:00-10:00', '10:00-12:00', '13:00-15:00', '15:00-17:00'];

/// Pemakaian satu slot pada satu tanggal — hasil RPC `booking_slot_usage`.
///
/// Kuota ditegakkan trigger database (supabase/migrate-slot-capacity.sql),
/// jadi angka di sini hanya untuk menonaktifkan slot yang pasti ditolak server
/// dan menjelaskan sisanya. Slot tanpa data (RPC belum ada/gagal) dianggap
/// tersedia — jangan mematikan pemesanan hanya karena pembacaan kuota gagal.
class SlotUsage {
  final String slot;
  final int capacity;
  final int booked;

  const SlotUsage({
    required this.slot,
    required this.capacity,
    required this.booked,
  });

  factory SlotUsage.fromMap(Map<String, dynamic> m) => SlotUsage(
        slot: (m['slot'] as String?) ?? '',
        capacity: (m['capacity'] as num?)?.toInt() ?? 0,
        booked: (m['booked'] as num?)?.toInt() ?? 0,
      );

  int get remaining =>
      capacity <= 0 ? 0 : (capacity - booked).clamp(0, capacity).toInt();

  bool get full => capacity > 0 && booked >= capacity;
}

/// Baca daftar `booking_slot_usage` menjadi peta slot → [SlotUsage].
/// Baris tanpa nama slot / kapasitas tidak sah dilewati.
Map<String, SlotUsage> slotUsageFrom(dynamic raw) {
  if (raw is! List) return const {};
  final hasil = <String, SlotUsage>{};
  for (final row in raw) {
    if (row is! Map) continue;
    final u = SlotUsage.fromMap(row.cast<String, dynamic>());
    if (u.slot.trim().isEmpty || u.capacity <= 0) continue;
    hasil[u.slot] = u;
  }
  return hasil;
}

/// Pekerjaan yang masih dipegang teknisi (`paid` = belum mulai,
/// `in_progress` = sedang dikerjakan) — null bila tidak ada.
///
/// Aturan server `claim_job` (`kode: 'masih_bekerja'`) memakai status yang sama:
/// satu pekerjaan aktif per teknisi. Tugas yang dilepas kembali menjadi `paid`
/// tanpa teknisi, jadi tidak lagi terhitung.
Booking? pekerjaanAktif(Iterable<Booking> jobs) {
  for (final b in jobs) {
    if (b.status == BookingStatus.paid ||
        b.status == BookingStatus.inProgress) {
      return b;
    }
  }
  return null;
}

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
bool skillMatchesCategory(
    String? skill, String? categoryId, String? categoryName) {
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

/// Posisi teknisi LIVE untuk satu pesanan — hasil RPC
/// `booking_technician_position` (supabase/migrate-technician-trip-share.sql).
///
/// Server memegang SELURUH gerbang privasi (pesanan harus milik pemanggil,
/// teknisi sudah ditugaskan, pesanan masih aktif, teknisi sudah menekan
/// "Berangkat", posisi belum kedaluwarsa dan belum basi). Karena itu kelas ini
/// sengaja MEMBAWA alasan ketika tidak terlihat: aplikasi hanya menampilkan apa
/// yang dikatakan server, tanpa menebak sendiri kenapa posisinya kosong.
class BookingTechPosition {
  /// Server mengizinkan permintaan ini (pemanggil = pemilik pesanan).
  /// `false` = permintaan ditolak/ditolak jaringan — jangan tampilkan apa pun.
  final bool ok;

  /// Posisi boleh ditampilkan SEKARANG. Hanya ini yang membuka peta.
  final bool visible;

  final double? lat;
  final double? lng;

  /// Umur pembaruan terakhir (detik) — dipakai menulis "Diperbarui 12 detik lalu".
  final int? ageSeconds;

  /// Kapan posisi ini berhenti dibagikan (batas satu perjalanan, 90 menit).
  final DateTime? expiresAt;

  /// Sebab posisi tidak ditampilkan — kalimat siap tampil dari server.
  final String? reason;

  /// Jarak lurus teknisi → titik pesanan (meter). Null bila pelanggan tidak
  /// memasang pin (tidak ada titik pembanding).
  final int? distanceM;

  const BookingTechPosition({
    this.ok = false,
    this.visible = false,
    this.lat,
    this.lng,
    this.ageSeconds,
    this.expiresAt,
    this.reason,
    this.distanceM,
  });

  /// Belum ada jawaban dari server (mis. RPC belum dijalankan).
  static const kosong = BookingTechPosition();

  factory BookingTechPosition.fromRpc(Map<String, dynamic> m) {
    final lat = (m['lat'] as num?)?.toDouble();
    final lng = (m['lng'] as num?)?.toDouble();
    final expires = m['expires_at'] as String?;
    return BookingTechPosition(
      ok: m['ok'] == true,
      // Koordinat wajib ada bila `visible` — server tidak akan mengirim
      // visible:true tanpa titik, tetapi pemeriksaan ganda di sini membuat
      // peta tidak pernah dibuka dengan lat/lng null.
      visible: m['visible'] == true && lat != null && lng != null,
      lat: lat,
      lng: lng,
      ageSeconds: (m['age_seconds'] as num?)?.toInt(),
      expiresAt: expires == null ? null : DateTime.tryParse(expires)?.toLocal(),
      reason: (m['reason'] as String?)?.trim(),
      distanceM: (m['distance_m'] as num?)?.toInt(),
    );
  }

  /// "Sekitar 350 m lagi" — angka yang paling dicari pelanggan (bukan koordinat,
  /// bukan umur posisi). Dihilangkan bila tidak ada titik pembanding.
  String? get ringkasanJarak {
    final d = distanceM;
    if (d == null) return null;
    if (d < 1000) return 'Sekitar $d m lagi';
    final km = (d / 100).round() / 10; // satu desimal
    return 'Sekitar ${km.toString().replaceAll('.', ',')} km lagi';
  }

  /// "±4 menit lagi" — perkiraan waktu tiba dari jarak yang dikirim server.
  ///
  /// `null` bila tidak ada titik pembanding (pelanggan tidak memasang pin),
  /// supaya kartu pelacakan tidak menampilkan angka yang tidak berdasar.
  /// Rumus & batasnya ada di lib/eta.dart (diuji tanpa jaringan).
  String? get ringkasanEta => ringkasanEtaDariJarak(distanceM);

  /// Kalimat umur posisi yang dimengerti manusia: "Diperbarui 12 detik lalu".
  /// Lebih tua dari semenit dibulatkan ke menit (server sudah menutup di 5
  /// menit, jadi angka ini tidak pernah terlalu besar).
  String get ringkasanUmur {
    final s = ageSeconds;
    if (s == null) return 'Menunggu posisi terbaru…';
    if (s < 10) return 'Diperbarui barusan';
    if (s < 60) return 'Diperbarui $s detik lalu';
    final m = (s / 60).round();
    return 'Diperbarui $m menit lalu';
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
        'approved' =>
          'Klaim garansi disetujui — kunjungan ulang gratis dijadwalkan.',
        'rejected' => 'Klaim garansi ditolak',
        _ => daysLeft > 0
            ? 'Bergaransi $daysLeft hari lagi'
            : 'Masa garansi $warrantyDays hari sudah berakhir',
      };
}

/// Status pengembalian dana (refund) untuk satu pesanan — hasil RPC
/// `booking_refund_info` (supabase/migrate-booking-refunds.sql).
///
/// Pesanan tanpa refund mengembalikan `refund: null`; itu BUKAN error, hanya
/// berarti tidak ada uang yang perlu kembali.
class BookingRefund {
  final String id;

  /// Pesanan yang uangnya dikembalikan. Diisi saat membaca baris tabel
  /// (kotak masuk) maupun RPC; kosong hanya untuk [BookingRefund.kosong].
  final String bookingId;

  /// Kode & layanan pesanan bila sumbernya menyertakannya (baris tabel dengan
  /// join). Boleh kosong — kotak masuk memakai data pesanan yang sudah dimuat.
  final String? bookingCode;
  final String? serviceName;

  /// pending = menunggu transfer balik · done = sudah dikirim ·
  /// rejected = ditolak admin (dengan alasan).
  final String status;
  final int amount;
  final String? reason;
  final String? note;
  final String? rejectionReason;

  /// Path objek di bucket privat `refund-proofs` — bukan URL publik.
  final String? proofPath;

  /// Apakah uang pelanggan sudah dikonfirmasi admin saat refund dibuat.
  /// false = bukti bayar masih menunggu konfirmasi; nominalnya belum tentu
  /// benar, jadi jangan pertahankan teks yang menjanjikan transfer.
  final bool paymentConfirmed;
  final DateTime? createdAt;
  final DateTime? decidedAt;

  const BookingRefund({
    required this.id,
    required this.status,
    required this.amount,
    this.bookingId = '',
    this.bookingCode,
    this.serviceName,
    this.reason,
    this.note,
    this.rejectionReason,
    this.proofPath,
    this.paymentConfirmed = false,
    this.createdAt,
    this.decidedAt,
  });

  /// Tidak ada refund (atau migrasi belum dijalankan) — kartunya disembunyikan.
  static const BookingRefund kosong = BookingRefund(id: '', status: '', amount: 0);

  bool get ada => id.isNotEmpty && amount > 0;

  factory BookingRefund.fromRpc(Map<String, dynamic> m, {String? bookingId}) {
    final r = (m['refund'] as Map?)?.cast<String, dynamic>();
    if (r == null) return BookingRefund.kosong;
    DateTime? waktu(dynamic v) =>
        v is String && v.isNotEmpty ? DateTime.tryParse(v) : null;
    return BookingRefund(
      id: (r['id'] as String?) ?? '',
      bookingId: bookingId ?? '',
      status: (r['status'] as String?) ?? '',
      amount: (r['amount'] as num?)?.toInt() ?? 0,
      reason: r['reason'] as String?,
      note: r['note'] as String?,
      rejectionReason: r['rejection_reason'] as String?,
      proofPath: r['proof_url'] as String?,
      paymentConfirmed: r['payment_confirmed'] == true,
      createdAt: waktu(r['created_at']),
      decidedAt: waktu(r['decided_at']),
    );
  }

  /// Baris tabel `booking_refunds` (kotak masuk). Kolom `booking` opsional:
  /// bila PostgREST menyertakan join, kode & nama layanannya ikut terbaca.
  factory BookingRefund.fromRow(Map<String, dynamic> row) {
    DateTime? waktu(dynamic v) =>
        v is String && v.isNotEmpty ? DateTime.tryParse(v) : null;
    final booking = (row['booking'] as Map?)?.cast<String, dynamic>();
    final services = (booking?['services'] as Map?)?.cast<String, dynamic>();
    return BookingRefund(
      id: (row['id'] as String?) ?? '',
      bookingId: (row['booking_id'] as String?) ?? '',
      bookingCode: row['booking_code'] as String? ?? booking?['code'] as String?,
      serviceName: services?['name'] as String?,
      status: (row['status'] as String?) ?? '',
      amount: (row['amount'] as num?)?.toInt() ?? 0,
      reason: row['reason'] as String?,
      note: row['note'] as String?,
      rejectionReason: row['rejection_reason'] as String?,
      proofPath: row['proof_url'] as String?,
      paymentConfirmed: row['payment_confirmed'] == true,
      createdAt: waktu(row['created_at']),
      decidedAt: waktu(row['decided_at']),
    );
  }

  String get labelStatus => switch (status) {
        'pending' => 'Menunggu transfer balik',
        'done' => 'Dana sudah dikembalikan',
        'rejected' => 'Pengembalian ditolak',
        _ => status,
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
/// Sejak supabase/migrate-booking-refunds.sql, pembatalan setelah transfer
/// DIIZINKAN: server membuat baris pengembalian dana otomatis, jadi uang
/// pelanggan tidak lagi tersandera. Syarat bukti bayar yang dulu ada di sini
/// sengaja DIHAPUS agar tombol di aplikasi tidak lebih ketat daripada server.
bool bolehBatalkanAtauUbahJadwal({
  required BookingStatus status,
  required String? paymentProofUrl,
  required bool paymentRejected,
  required DateTime sekarang,
  required String bookingDate,
  required String bookingTime,
  int rescheduleCount = 0,
}) {
  if (status != BookingStatus.pending && status != BookingStatus.paid) {
    return false;
  }
  // Parameter bukti bayar dipertahankan supaya pemanggil lama & uji tetap
  // terbaca, tetapi TIDAK lagi memblokir: refund menutup uang yang mungkin
  // sudah terkirim.
  return slotStart(bookingDate, bookingTime).isAfter(sekarang);
}

/// Nama layanan siap tampil pada kartu pesanan/pekerjaan:
/// "Cuci AC — 1 PK · 3 unit". Jumlah unit hanya ditambahkan bila lebih dari
/// satu supaya pesanan biasa tidak berubah tampilan.
String labelLayananJumlah(String serviceName, String? optionLabel, int quantity,
    {String unitWord = 'unit'}) {
  final dasar = optionLabel == null || optionLabel.trim().isEmpty
      ? serviceName
      : '$serviceName — $optionLabel';
  return quantity > 1 ? '$dasar · $quantity $unitWord' : dasar;
}

/// Ringkasan penilaian (rating) teknisi: jumlah penilaian + rata-ratanya.
///
/// Dipakai layar Profil teknisi; sengaja dipisah dari baris `reviews` mentah
/// supaya aturan hitungnya bisa diuji tanpa perangkat (lihat
/// test/rating_summary_test.dart). Pembulatan SATU desimal dan satuan "ulasan"
/// sama dengan panel admin web (src/app/actions/admin.js) supaya kedua sisi
/// menampilkan angka yang sama untuk data yang sama.
class RatingSummary {
  /// Jumlah penilaian yang sah (rating 1–5).
  final int count;

  /// Rata-rata 1 desimal, atau null bila [count] nol.
  final double? average;

  const RatingSummary({required this.count, required this.average});

  /// Teknisi yang belum pernah dinilai — bukan keadaan error.
  static const RatingSummary kosong = RatingSummary(count: 0, average: null);

  bool get adaPenilaian => count > 0 && average != null;
}

/// Hitung [RatingSummary] dari baris rating mentah.
///
/// Nilai di luar 1–5 dilewati, bukan dihitung: check constraint di database
/// menjamin rentang itu, tetapi data warisan/impor bisa melenceng dan satu
/// baris 0 saja cukup untuk merusak rata-rata teknisi.
RatingSummary summarizeRatings(Iterable<int> ratings) {
  var jumlah = 0;
  var total = 0;
  for (final r in ratings) {
    if (r < 1 || r > 5) continue;
    jumlah += 1;
    total += r;
  }
  if (jumlah == 0) return RatingSummary.kosong;
  return RatingSummary(
      count: jumlah, average: (total / jumlah * 10).round() / 10);
}

/// Teks ringkas penilaian untuk ditampilkan, mis. "4,8 · 12 ulasan".
///
/// Desimal memakai koma seperti format jarak di aplikasi (lihat
/// [formatJarak]); belum ada penilaian → "Belum ada rating", kalimat yang
/// sama dengan panel admin web.
String ratingSummaryLabel(RatingSummary s) => s.adaPenilaian
    ? '${s.average!.toStringAsFixed(1).replaceAll('.', ',')} · ${s.count} ulasan'
    : 'Belum ada rating';

/// Kalimat pembaca layar untuk [RatingSummary] — angkanya harus terdengar
/// lengkap (rata-rata "dari 5" + jumlah ulasan), bukan hanya "4,8".
String ratingSummarySemantics(RatingSummary s) => s.adaPenilaian
    ? 'Penilaian teknisi: ${s.average!.toStringAsFixed(1).replaceAll('.', ',')} dari 5 '
        '(${s.count} ulasan)'
    : 'Penilaian teknisi: belum ada rating';

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
  return DateTime(tanggal.year, tanggal.month, tanggal.day, jam.clamp(0, 23),
      menit.clamp(0, 59));
}

/// Slot jam yang masih bisa dipilih untuk [bookingDate] pada waktu [sekarang].
///
/// Tanggal kosong / tidak valid → semua slot (biar pemanggil yang menjelaskan).
/// Hari lain → semua slot. Hari ini → hanya slot yang jam mulainya belum lewat,
/// aturan yang sama dengan penolakan server di RPC create_booking. Tanpa ini
/// pelanggan bisa memesan "08:00-10:00" pada pukul 15:00 dan baru ditolak saat
/// menekan Pesan.
List<String> slotTersedia(
  String? bookingDate, {
  DateTime? sekarang,
  Map<String, SlotUsage> pemakaian = const {},
}) {
  if (bookingDate == null) return timeSlots;
  // Slot penuh disembunyikan/dinonaktifkan LEBIH DULU: server menolaknya, dan
  // membiarkan pelanggan memilih slot yang pasti gagal hanya membuang waktu.
  final hari = DateTime.tryParse(bookingDate.trim());
  if (hari == null) return timeSlots;
  final now = sekarang ?? DateTime.now();
  final hariIni =
      hari.year == now.year && hari.month == now.month && hari.day == now.day;
  return timeSlots.where((t) {
    if (pemakaian[t]?.full == true) return false;
    if (!hariIni) return true;
    return slotStart(bookingDate, t).isAfter(now);
  }).toList();
}
