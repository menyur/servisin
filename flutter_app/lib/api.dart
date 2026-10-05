import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'models.dart';

/// Fungsi cleanup langganan realtime chat (dipanggil di dispose).
typedef ChatUnsubscribe = Future<void> Function();

/// Satu pintu akses ke Supabase: auth, katalog, booking, bukti bayar,
/// review, laporan, voucher. Semua query mengikuti aturan RLS yang sama
/// dengan web (user hanya melihat/mengubah datanya sendiri).
class Api {
  Api._();
  static final SupabaseClient db = Supabase.instance.client;

  // ============ auth ============

  static Session? get session => db.auth.currentSession;
  static bool get isLoggedIn => session != null;

  static Future<AuthResponse> signIn(String email, String password) =>
      db.auth.signInWithPassword(email: email, password: password);

  static Future<AuthResponse> signUp(String email, String password, {String? name, String? phone, String? address}) {
    return db.auth.signUp(
      email: email,
      password: password,
      data: {'name': name ?? email, 'phone': phone, 'address': address, 'role': 'customer'},
    );
  }

  static Future<void> sendPasswordReset(String email) => db.auth.resetPasswordForEmail(email);

  static Future<void> signOut() => db.auth.signOut();

  /// Profil user saat ini (row di tabel profiles).
  static Future<Profile?> myProfile() async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) return null;
    final row = await db.from('profiles').select().eq('id', uid).maybeSingle();
    return row == null ? null : Profile.fromMap(row);
  }

  static Future<void> updateMyProfile(
      {String? name, String? phone, String? address, String? avatarUrl, String? serviceArea}) async {
    final uid = db.auth.currentUser!.id;
    final patch = <String, dynamic>{};
    if (name != null) patch['name'] = name;
    if (phone != null) patch['phone'] = phone;
    if (address != null) patch['address'] = address;
    if (avatarUrl != null) patch['avatar_url'] = avatarUrl;
    if (serviceArea != null) patch['service_area'] = serviceArea;
    await db.from('profiles').update(patch).eq('id', uid);
  }

  /// Upload foto profil ke bucket `profile-media` (pola sama dengan web:
  /// upsert + getPublicUrl), lalu simpan URL-nya ke `profiles.avatar_url`.
  /// Mengembalikan URL publik yang siap ditampilkan.
  static Future<String> uploadAvatar(Uint8List bytes) async {
    final uid = db.auth.currentUser!.id;
    final path = 'avatar-$uid-${DateTime.now().millisecondsSinceEpoch}.jpg';
    await db.storage.from('profile-media').uploadBinary(
          path,
          bytes,
          fileOptions: const FileOptions(contentType: 'image/jpeg', upsert: true),
        );
    final url = db.storage.from('profile-media').getPublicUrl(path);
    await updateMyProfile(avatarUrl: url);
    return url;
  }

  // ============ chat pelanggan ↔ teknisi ============

  /// Profil singkat untuk header chat (nama + avatar lawan bicara).
  static Future<Profile?> fetchProfileById(String id) async {
    try {
      final row = await db
          .from('profiles')
          .select('id, name, avatar_url')
          .eq('id', id)
          .maybeSingle();
      return row == null ? null : Profile.fromMap(row);
    } catch (_) {
      return null;
    }
  }

  /// Riwayat pesan satu pesanan (urut waktu naik).
  static Future<List<ChatMessage>> fetchChatMessages(String bookingId) async {
    final rows = await db
        .from('chat_messages')
        .select('id, booking_id, sender_id, body, created_at')
        .eq('booking_id', bookingId)
        .order('created_at', ascending: true);
    return rows.map<ChatMessage>((m) => ChatMessage.fromMap(m)).toList();
  }

  /// Kirim pesan sebagai user yang sedang login (RLS memaksa sender = diri
  /// sendiri dan hanya peserta pesanan yang boleh).
  static Future<void> sendChatMessage(String bookingId, String body) async {
    final uid = db.auth.currentUser!.id;
    await db.from('chat_messages').insert({
      'booking_id': bookingId,
      'sender_id': uid,
      'body': body.trim(),
    });
  }

  /// Berlangganan pesan baru secara realtime. Mengembalikan fungsi
  /// cleanup untuk membatalkan channel (dipanggil di dispose).
  static Future<ChatUnsubscribe> subscribeChat(
      String bookingId, void Function(ChatMessage) onMessage) async {
    final channel = db.channel('chat-$bookingId');
    channel.onPostgresChanges(
      event: PostgresChangeEvent.insert,
      schema: 'public',
      table: 'chat_messages',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'booking_id',
        value: bookingId,
      ),
      callback: (payload) {
        final row = payload.newRecord;
        if (row.isNotEmpty) onMessage(ChatMessage.fromMap(row));
      },
    );
    channel.subscribe();
    return () async {
      await db.removeChannel(channel);
    };
  }

  // ============ pekerjaan teknisi (ambil pekerjaan) ============

  /// Daftar pekerjaan tersedia (sudah dibayar, belum diambil teknisi).
  /// Lewat RPC security definer — teknisi melihat alamat & jadwal
  /// sebelum memutuskan mengambil.
  static Future<List<AvailableJob>> fetchAvailableJobs() async {
    final res = await db.rpc('available_jobs');
    return (res as List)
        .cast<Map<String, dynamic>>()
        .map(AvailableJob.fromMap)
        .toList();
  }

  /// Klaim pekerjaan (atomik di server — satu pekerjaan satu teknisi).
  static Future<({bool ok, String? error})> claimJob(String bookingId) async {
    final res = await db.rpc('claim_job', params: {'p_booking': bookingId});
    final m = (res as Map).cast<String, dynamic>();
    return (ok: m['ok'] == true, error: m['error'] as String?);
  }

  /// Pekerjaan yang ditugaskan ke saya (teknisi).
  static Future<List<Booking>> fetchAssignedJobs() async {
    final uid = db.auth.currentUser!.id;
    final rows = await db
        .from('bookings')
        .select('*, services(name), technician:profiles!bookings_technician_id_fkey(name, avatar_url)')
        .eq('technician_id', uid)
        .order('booking_date', ascending: true);
    return rows.map<Booking>((m) => Booking.fromMap(m)).toList();
  }

  /// Ubah status pekerjaan oleh teknisi: 'in_progress' atau 'completed'.
  /// Completed otomatis memotong komisi dari saldo (idempoten di server).
  /// Bila completed: [commission] = komisi terpotong & [balance] = saldo
  /// terbaru (null bila migrasi `migrate-set-job-status-return.sql` belum
  /// dijalankan / sudah pernah dipotong sebelumnya).
  static Future<({bool ok, String? error, num? commission, num? balance})> setJobStatus(
      String bookingId, String status) async {
    final res = await db.rpc('set_job_status', params: {'p_booking': bookingId, 'p_status': status});
    final m = (res as Map).cast<String, dynamic>();
    return (
      ok: m['ok'] == true,
      error: m['error'] as String?,
      commission: m['commission'] as num?,
      balance: m['balance'] as num?,
    );
  }

  /// Lepas tugas dengan alasan → pesanan kembali ke daftar Tersedia
  /// (technician_id null, status paid) dan bisa diambil teknisi lain.
  /// Setelah sukses, server web diberi tahu untuk mengirim push + email
  /// ke semua admin (fire-and-forget — gagal notif tidak menggagalkan).
  static Future<({bool ok, String? error})> releaseJob(String bookingId, String reason) async {
    final res = await db.rpc('release_job', params: {'p_booking': bookingId, 'p_reason': reason});
    final m = (res as Map).cast<String, dynamic>();
    final ok = m['ok'] == true;
    if (ok) unawaited(notifyAdminOfRelease(bookingId));
    return (ok: ok, error: m['error'] as String?);
  }

  /// Beri tahu server web (pemegang kunci push & email) bahwa tugas ini baru
  /// saja dilepas — server memverifikasi token, lalu meneruskan notifikasi
  /// berisi kode pesanan + alasan ke semua admin.
  /// Best-effort: gagal jaringan/env diabaikan; admin tetap bisa melihat
  /// lewat tab "Pelepasan Tugas" di panel admin.
  static Future<void> notifyAdminOfRelease(String bookingId) async {
    try {
      final token = db.auth.currentSession?.accessToken;
      if (token == null) return;
      await http
          .post(
            Uri.parse('${AppConfig.webBaseUrl}/api/notify-job-release'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({'bookingId': bookingId}),
          )
          .timeout(const Duration(seconds: 8));
      // respons diabaikan — notifikasi best-effort
    } catch (_) {
      // offline / server tidak terjangkau — abaikan dengan aman
    }
  }

  // ============ katalog publik ============

  static Future<List<Category>> fetchCategories() async {
    final rows = await db.from('categories').select().order('sort_order');
    return rows.map<Category>((m) => Category.fromMap(m)).toList();
  }

  /// Katalog + varian + agregat rating teknisi dalam 2 query paralel,
  /// lalu rating di-cache 5 menit (paritas dgn unstable_cache web).
  static Future<List<Service>> fetchServices() async {
    final results = await Future.wait([
      db.from('services').select().eq('is_active', true).order('sort_order'),
      db.from('service_options').select().eq('is_active', true).order('sort_order'),
    ]);
    final optionRows = (results[1] as List).cast<Map<String, dynamic>>();
    final byService = <String, List<ServiceOption>>{};
    for (final o in optionRows) {
      byService.putIfAbsent(o['service_id'] as String, () => []).add(ServiceOption.fromMap(o));
    }
    return (results[0] as List)
        .cast<Map<String, dynamic>>()
        .map((m) => Service.fromMap(m, options: byService[m['id'] as String] ?? const []))
        .toList();
  }

  /// Banner promosi aktif untuk karosel beranda (publik, RLS izinkan baca).
  static Future<List<PromoBanner>> fetchBanners() async {
    final rows = await db
        .from('banners')
        .select()
        .eq('is_active', true)
        .order('sort_order')
        .order('created_at', ascending: false);
    return rows.map<PromoBanner>((m) => PromoBanner.fromMap(m)).toList();
  }

  /// Path bucket `banners` -> URL publik gambar.
  /// CATATAN: pakai URL dasar project (bukan client.rest.url yang sudah
  /// berakhiran /rest/v1 — dobel prefiks bikin 401).
  static String bannerUrl(String path) {
    if (path.startsWith('http')) return path;
    return '${AppConfig.supabaseUrl}/storage/v1/object/public/banners/$path';
  }

  // ============ booking ============

  /// Membuat booking via RPC security definer — server yang menentukan
  /// kode, user, harga (dari katalog), diskon voucher, dan status.
  /// Client hanya mengirim id & teks; tidak bisa menembak harga
  /// (paritas dengan alur web yang dihitung di server action).
  static Future<Booking> createBooking({
    required String serviceId,
    String? optionId,
    required String bookingDate,
    required String bookingTime,
    required String address,
    String? notes,
    String? attachmentUrl,
    required String paymentMethod,
    String? voucherId,
  }) async {
    final res = await db.rpc('create_booking_security_definer', params: {
      'p_service_id': serviceId,
      if (optionId != null) 'p_option_id': optionId,
      'p_date': bookingDate,
      'p_time': bookingTime,
      'p_address': address,
      if (notes != null && notes.isNotEmpty) 'p_notes': notes,
      if (attachmentUrl != null) 'p_attachment': attachmentUrl,
      'p_payment': paymentMethod,
      if (voucherId != null) 'p_voucher_id': voucherId,
    });
    final map = res is List ? (res.first as Map<String, dynamic>) : (res as Map<String, dynamic>);
    if (map['error'] != null) {
      throw Exception(map['error']);
    }
    return Booking.fromMap((map['booking'] as Map).cast<String, dynamic>());
  }

  /// Daftar pesanan milik user (join layanan + teknisi), terbaru dulu.
  /// CATATAN: bookings menyimpan varian sebagai teks `option_label`
  /// (bukan FK ke service_options) — join ke service_options akan gagal 400.
  static Future<List<Booking>> fetchMyBookings() async {
    final rows = await db
        .from('bookings')
        .select('*, services(name), technician:profiles!bookings_technician_id_fkey(name, avatar_url)')
        .order('created_at', ascending: false);
    final reviewRows = await _myReviewedBookingIds();
    final reviewed = reviewRows.toSet();
    return rows.map<Booking>((m) => Booking.fromMap(m, hasReview: reviewed.contains(m['id'] as String))).toList();
  }

  static Future<List<String>> _myReviewedBookingIds() async {
    try {
      final rows = await db.from('reviews').select('booking_id').eq('user_id', db.auth.currentUser!.id);
      return rows.map<String>((m) => m['booking_id'] as String).toList();
    } catch (_) {
      return []; // tabel reviews mungkin belum ada — paritas dgn web
    }
  }

  /// Upload bukti pembayaran (privat bucket `payment-proofs`).
  /// Simpan PATH ke kolom (bukan publicUrl) — sesuai aturan keamanan web;
  /// ditampilkan lewat signed URL.
  static Future<void> submitPaymentProof({
    required String bookingId,
    required String path,
    required int amount,
  }) async {
    await db.from('bookings').update({
      'payment_proof_url': path,
      'payment_amount': amount,
      'payment_rejected': false,
      'payment_rejection_reason': null,
    }).eq('id', bookingId);
  }

  static Future<String> createSignedUrl(String bucket, String path, {int seconds = 3600}) async {
    final res = await db.storage.from(bucket).createSignedUrl(path, seconds);
    return res;
  }

  // ============ review ============

  /// Simpan/ubah penilaian untuk pesanan selesai. Satu review per booking
  /// (unique) — kalau sudah ada, update.
  static Future<void> submitReview({
    required String bookingId,
    required String technicianId,
    required int rating,
    String? comment,
  }) async {
    final uid = db.auth.currentUser!.id;
    await db.from('reviews').upsert({
      'booking_id': bookingId,
      'user_id': uid,
      'technician_id': technicianId,
      'rating': rating,
      if (comment != null && comment.isNotEmpty) 'comment': comment,
    }, onConflict: 'booking_id');
  }

  // ============ laporan ============

  static Future<List<Report>> fetchMyReports() async {
    final uid = db.auth.currentUser!.id;
    final rows = await db
        .from('reports')
        .select('*, bookings(code)')
        .eq('author_id', uid)
        .order('created_at', ascending: false);
    return rows.map<Report>((m) => Report.fromMap(m)).toList();
  }

  static Future<void> createReport({
    required String title,
    required String content,
    String? bookingId,
    String? attachmentPath,
  }) async {
    final uid = db.auth.currentUser!.id;
    await db.from('reports').insert({
      'author_id': uid,
      'author_role': 'customer',
      'title': title,
      'content': content,
      if (bookingId != null && bookingId.isNotEmpty) 'booking_id': bookingId,
      if (attachmentPath != null) 'attachment_url': attachmentPath,
    });
  }

  // ============ voucher ============

  static Future<List<Voucher>> fetchMyVouchers() async {
    final uid = db.auth.currentUser!.id;
    final rows = await db
        .from('vouchers')
        .select()
        .eq('user_id', uid)
        .isFilter('used_at', null)
        .order('expires_at');
    return rows.map<Voucher>((m) => Voucher.fromMap(m)).toList();
  }

  // ============ storage helper ============

  /// Pilih gambar dari galeri/kamera lalu kompres (sisi terpanjang ≤ maxSide,
  /// kualitas [quality]) — pola yang sama dengan web sebelum upload.
  /// Avatar memakai maxSide kecil (512) agar upload cepat.
  static Future<Uint8List?> pickAndCompressImage(
      {ImageSource source = ImageSource.gallery, int maxSide = 1200, int quality = 75}) async {
    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 2000);
    if (picked == null) return null;
    final raw = await picked.readAsBytes();
    final compressed = await FlutterImageCompress.compressWithList(
      raw,
      minWidth: maxSide,
      minHeight: maxSide,
      quality: quality,
      format: CompressFormat.jpeg,
    );
    return compressed;
  }

  /// Upload ke bucket dan kembalikan PATH-nya (bukan publicUrl).
  static Future<String> uploadToBucket({
    required String bucket,
    required String folder,
    required Uint8List bytes,
    String extension = 'jpg',
  }) async {
    final uid = db.auth.currentUser!.id;
    final path = '$folder/$uid-${DateTime.now().millisecondsSinceEpoch}.$extension';
    await db.storage.from(bucket).uploadBinary(path, bytes,
        fileOptions: const FileOptions(contentType: 'image/jpeg', upsert: false));
    return path;
  }
}
