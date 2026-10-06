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

  /// Daftar sebagai PENGRUSUS TEKNISI — paritas dengan /gabung di web:
  /// metadata auth membawa role=technician + data kurasi (skill, address,
  /// ktp_url). Trigger handle_new_user menyimpan semuanya ke profiles dengan
  /// approval_status 'pending' (migrate-approval-status.sql) sampai admin
  /// menyetujui lewat tab "Pendaftar Teknisi".
  /// [ktpPath] = path file di bucket PRIVAT ktp-documents (folder pendaftaran/),
  /// WAJIB diisi — pendaftar tanpa KTP ditolak di sisi UI & web.
  static Future<AuthResponse> signUpTechnician({
    required String email,
    required String password,
    required String name,
    required String phone,
    required String address,
    required String skill,
    required String ktpPath,
  }) {
    return db.auth.signUp(
      email: email,
      password: password,
      data: {
        'name': name,
        'phone': phone,
        'role': 'technician',
        'skill': skill,
        'address': address,
        'ktp_url': ktpPath,
      },
    );
  }

  /// Upload foto KTP pendaftar ke bucket PRIVAT `ktp-documents`, folder
  /// `pendaftaran/`. DIPANGGIL SEBELUM akun dibuat (user masih anon), jadi
  /// JANGAN pakai uploadToBucket — itu menyisipkan uid ke path & menuntut
  /// sesi. Policy insert anon khusus folder pendaftaran/ sudah ada di
  /// migrate-technician-ktp.sql (sama seperti alur web).
  static Future<String> uploadKtpPendaftaran(Uint8List bytes) async {
    final path = 'pendaftaran/ktp-${DateTime.now().millisecondsSinceEpoch}.jpg';
    await db.storage.from('ktp-documents').uploadBinary(path, bytes,
        fileOptions: const FileOptions(contentType: 'image/jpeg', upsert: false));
    return path;
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

  /// Berlangganan perubahan status pesanan secara realtime (postgres_changes
  /// event UPDATE pada tabel bookings). Satu channel dengan dua filter:
  /// - user_id = uid       → pelanggan menerima perubahan pesanannya,
  /// - technician_id = uid → teknisi menerima tugas yang ditugaskan.
  /// Event selalu menghormati RLS (tidak ada baris orang lain yang bocor).
  /// Kondisi lama tersedia di payload karena bookings memakai replica
  /// identity full (jalankan migrate-realtime-bookings.sql). Mengembalikan
  /// fungsi cleanup untuk membatalkan channel (dipanggil logout/dispose).
  static ChatUnsubscribe subscribeBookingUpdates(
      String uid, void Function(BookingUpdate) onUpdate) {
    final channel = db.channel('bookings-$uid');
    var active = true;

    void handle(PostgresChangePayload payload) {
      if (!active) return;
      final row = payload.newRecord;
      final id = row['id'] as String?;
      if (id == null || id.isEmpty) return;
      final old = payload.oldRecord;
      onUpdate(BookingUpdate(
        id: id,
        code: (row['code'] as String?) ?? (old['code'] as String?) ?? '',
        status: row['status'] as String?,
        prevStatus: old['status'] as String?,
        technicianId: row['technician_id'] as String?,
        prevTechnicianId: old['technician_id'] as String?,
        userId: row['user_id'] as String?,
      ));
    }

    channel.onPostgresChanges(
      event: PostgresChangeEvent.update,
      schema: 'public',
      table: 'bookings',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'user_id',
        value: uid,
      ),
      callback: handle,
    );
    channel.onPostgresChanges(
      event: PostgresChangeEvent.update,
      schema: 'public',
      table: 'bookings',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'technician_id',
        value: uid,
      ),
      callback: handle,
    );
    channel.subscribe();
    return () async {
      if (!active) return;
      active = false;
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

  /// Ganti metode pembayaran pesanan milik sendiri yang masih 'pending'.
  /// RLS "user can add payment proof" hanya mengizinkan pemilik mengubah
  /// baris pending-nya — metode lain/lama tak bisa ditulis dari klien.
  /// Hasil SELALU dibaca-balik: update yang ditolak RLS mengembalikan
  /// sukses kosong (0 baris) tanpa error — jangan anggap sukses buta.
  static Future<({bool ok, String? error})> updatePaymentMethod(
      String bookingId, String method) async {
    try {
      final row = await db
          .from('bookings')
          .update({'payment_method': method})
          .eq('id', bookingId)
          .select('payment_method')
          .single();
      final applied = row['payment_method'] == method;
      return (
        ok: applied,
        error: applied ? null : 'Metode bayar tidak bisa diubah (pesanan mungkin sudah diproses).',
      );
    } catch (e) {
      return (ok: false, error: 'Gagal mengubah metode bayar. Periksa koneksi lalu coba lagi.');
    }
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

  // ============ saldo teknisi ============

  /// Saldo & riwayat mutasi teknisi yang sedang login.
  /// Sumber: profiles.balance + balance_transactions (RLS self-only —
  /// teknisi TIDAK boleh menulis mutasi sendiri, cegah fraud).
  /// Gagal aman bila migrasi teknisi-balance belum dijalankan (error dibalankan).
  static Future<TechnicianBalanceSummary> fetchMyBalanceSummary(
      {List<BalanceTransaction>? transactions}) async {
    final tx = transactions ?? await fetchMyBalanceTransactions();
    final p = await myProfile();
    return summarizeBalance(p, tx);
  }

  /// Satu panggilan untuk LAYAR Saldo: summary + daftar transaksi
  /// dari fetch paralel yang sama (hemat satu query profil vs
  /// memanggil fetchMyBalanceSummary + fetchMyBalanceTransactions).
  static Future<({TechnicianBalanceSummary summary, List<BalanceTransaction> transactions})>
      fetchMyBalancePage() async {
    final results = await Future.wait([
      myProfile().catchError((_) => null as Profile?),
      fetchMyBalanceTransactions(),
    ]);
    final tx = results[1] as List<BalanceTransaction>;
    return (
      summary: summarizeBalance(results[0] as Profile?, tx),
      transactions: tx,
    );
  }

  /// Hitung summary dari profil + transaksi (dipakai dua fungsi di atas).
  ///
  /// Definisi (model TOP-UP):
  /// * Pendapatan kotor = total harga pesanan − biaya aplikasi (appFee)
  ///   — dari booking tiap earning, BUKAN 2× komisi (bug lama:
  ///   amount earning = −komisi, jadi komisi + |amount| menghitung
  ///   komisi dua kali).
  /// * Komisi terpotong = Σ −amount baris earning (efek riil ke saldo;
  ///   baris backfill lama ber-amount POSITIF tidak dihitung komisi —
  ///   itu anomali yang dikoreksi fix-earning-amount-sign.sql dan
  ///   tampak sebagai selisih di expectedBalance).
  /// * expectedBalance = setoran − komisi − penarikan + refund; kalau
  ///   ≠ profiles.balance, ada perubahan saldo tanpa baris mutasi.
  static TechnicianBalanceSummary summarizeBalance(
      Profile? p, List<BalanceTransaction> tx) {
    var earned = 0;
    var commission = 0;
    var topup = 0;
    var withdrawal = 0;
    var refund = 0;
    for (final t in tx) {
      switch (t.type) {
        case 'earning':
          if (t.amount < 0) commission += (-t.amount).round();
          // Pendapatan kotor: total harga − biaya aplikasi.
          final total = t.bookingTotalPrice;
          if (total != null) {
            final base = total - appFee;
            if (base > 0) earned += base;
          } else {
            // Tanpa booking (kasus langka): komisi sebagai perkiraan.
            earned += (t.commissionAmount ?? 0).round();
          }
        case 'topup':
          topup += t.amount.round();
        case 'withdrawal':
          withdrawal += t.amount.round();
        case 'refund':
          refund += t.amount.round();
      }
    }
    final expected = topup - commission - withdrawal + refund;
    return TechnicianBalanceSummary(
      balance: p?.balance ?? 0,
      earnedTotal: earned,
      commissionTotal: commission,
      topupTotal: topup,
      withdrawalTotal: withdrawal,
      refundTotal: refund,
      expectedBalance: expected,
    );
  }

  /// Ringkas saldo, TANPA melempar: null bila migrasi balance belum
  /// dijalankan / database menolak. Dipakai strip saldo di tab Pekerjaan
  /// yang tidak boleh mematikan daftar pekerjaan saat gagal.
  static Future<TechnicianBalanceSummary?> fetchMyBalanceSummarySafe() async {
    try {
      return await fetchMyBalanceSummary();
    } catch (_) {
      return null;
    }
  }

  /// Riwayat mutasi saldo (100 terbaru, terbaru dulu).
  /// join bookings(code) supaya transaksi komisi menampilkan kode pesanan.
  static Future<List<BalanceTransaction>> fetchMyBalanceTransactions({int limit = 100}) async {
    final rows = await db
        .from('balance_transactions')
        .select('id, type, amount, commission_amount, note, created_at, bookings(code, total_price)')
        .order('created_at', ascending: false)
        .limit(limit);
    return rows.map<BalanceTransaction>((m) => BalanceTransaction.fromMap(m)).toList();
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
