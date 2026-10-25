import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'account_deletion.dart';
import 'chat_moderation.dart';
import 'config.dart';
import 'format.dart';
import 'models.dart';
import 'register_http.dart';
import 'report_seen.dart';
import 'reset_http.dart';
import 'scorecard.dart';
import 'subscription.dart';

/// Fungsi cleanup langganan realtime chat (dipanggil di dispose).
typedef ChatUnsubscribe = Future<void> Function();

/// Helper kick worker push: POST sederhana, gagal = diam (worker akan
/// dipicu interaksi berikutnya).
class WorkerKickHelper {
  static Future<void> kick(String url) async {
    try {
      await http.post(Uri.parse(url)).timeout(const Duration(seconds: 5));
    } catch (_) {
      // worker tidak terjangkau — biarkan; antrean dikirim saat interaksi berikut
    }
  }
}

/// Normalisasi komentar penilaian: rapi-trim; kosong → string kosong.
///
/// PENTING: jangan kirim `null`. Di produksi kolom `reviews.comment` dibuat
/// lewat Table Editor sebagai **NOT NULL**, sehingga penilaian TANPA ulasan
/// gagal dengan "null value in column comment violates not-null constraint" —
/// pelanggan tidak bisa menilai kalau tidak menulis ulasan. String kosong
/// diterima kolom NOT NULL maupun kolom nullable, jadi dipakai di kedua
/// kondisi; jalur web menyamakan perilakunya
/// (src/app/actions/reviews.js). Pembaca (`comment` truthy) tetap menganggap
/// string kosong sebagai "tanpa ulasan".
String normalizeReviewComment(String? raw) {
  return (raw ?? '').trim();
}

/// Satu pintu akses ke Supabase: auth, katalog, booking, bukti bayar,
/// review, laporan, voucher. Semua query mengikuti aturan RLS yang sama
/// dengan web (user hanya melihat/mengubah datanya sendiri).
class Api {
  Api._();
  static final SupabaseClient db = Supabase.instance.client;

  /// UID user yang sedang login (null bila belum login). Dipakai UI untuk
  /// kunci penyimpanan lokal per akun (mis. menutup banner pengingat setor).
  static String? get currentUserId => db.auth.currentUser?.id;

  /// Rekening transfer resmi dari tabel app_settings (diisi admin di panel
  /// web). Gagal (tabel belum ada / offline) → null, UI menampilkan teks
  /// generik. Dipakai wizard booking & dialog kirim bukti.
  static Future<Map<String, String>?> transferAccount() async {
    try {
      final row = await db
          .from('app_settings')
          .select(
            'transfer_bank_name, transfer_account_number, transfer_account_name',
          )
          .eq('id', 1)
          .maybeSingle();
      if (row == null) return null;
      final bank = (row['transfer_bank_name'] as String?)?.trim() ?? '';
      final number = (row['transfer_account_number'] as String?)?.trim() ?? '';
      if (bank.isEmpty || number.isEmpty) return null;
      return {
        'bank': bank,
        'number': number,
        'name': ((row['transfer_account_name'] as String?) ?? '').trim(),
      };
    } catch (_) {
      return null;
    }
  }

  /// Biaya aplikasi yang SEDANG berlaku, dibaca dari setelan admin
  /// (`app_settings.app_fee`, satu baris id = 1).
  ///
  /// Server menagih lewat `public.app_fee_efektif()` yang membaca angka yang
  /// sama; wizard WAJIB memakai angka ini agar rincian di layar tidak berbeda
  /// dengan tagihan (dulu wizard memakai konstanta 5000 sehingga selisih
  /// terlihat begitu admin mengubah tarif). Gagal membaca / kolom kosong →
  /// [appFee] bawaan, bukan 0: pesanan tidak boleh tampak tanpa biaya
  /// aplikasi hanya karena gangguan jaringan.
  static Future<int> fetchAppFee() async {
    try {
      final row = await db
          .from('app_settings')
          .select('app_fee')
          .eq('id', 1)
          .maybeSingle();
      final raw = row?['app_fee'];
      if (raw == null) return appFee;
      final n = raw is num ? raw.toInt() : int.tryParse('$raw');
      if (n == null) return appFee;
      return n.clamp(0, 1000000).toInt();
    } catch (_) {
      return appFee;
    }
  }

  // ============ auth ============

  static Session? get session => db.auth.currentSession;
  static bool get isLoggedIn => session != null;

  static Future<AuthResponse> signIn(String email, String password) =>
      db.auth.signInWithPassword(email: email, password: password);

  /// Daftar akun pelanggan — lewat server web, BUKAN `db.auth.signUp`.
  ///
  /// `db.auth.signUp` sudah TIDAK dipakai: ia selalu meminta Supabase mengirim
  /// email konfirmasi, sementara mailer bawaan hanya melayani alamat anggota
  /// tim project (2 pesan/jam). Jadi pelanggan biasa tidak pernah menerima
  /// email verifikasi — dan begitu kuota itu habis, PENDAFTARANNYA SENDIRI
  /// gagal, sebab GoTrue mengirim email di dalam transaksi. Server
  /// (POST /api/auth/register) membuat akunnya lewat Admin API (tanpa email)
  /// lalu mengirim emailnya lewat Resend;
  /// lihat src/lib/signup-verification.js.
  ///
  /// [redirectTo] menentukan ke mana tautan verifikasi kembali setelah diklik:
  /// Android → deep link `fixify://confirm`
  /// (AppConfig.signupConfirmRedirect) agar app terbuka dengan sesi aktif;
  /// null → server memakai Site URL Supabase (jalur web).
  ///
  /// Mengembalikan [HasilDaftar] untuk SEMUA jawaban server (termasuk 429 dan
  /// 503) supaya layar tidak pernah menyamakan "gagal" dengan "email sudah
  /// dikirim". Kegagalan jaringan dilempar apa adanya oleh `http`.
  static Future<HasilDaftar> daftarAkun({
    required String email,
    required String password,
    String? name,
    String? phone,
    String? address,
    String? redirectTo,
  }) =>
      _kirimPendaftaran(badanPermintaanDaftar(
        email: email,
        password: password,
        name: name ?? email,
        phone: phone,
        address: address,
        role: 'customer',
        redirectTo: redirectTo,
      ));

  /// Daftar sebagai PENDAFTAR TEKNISI — paritas dengan /gabung di web:
  /// metadata auth membawa role=technician + data kurasi (skill, address,
  /// ktp_url). Trigger handle_new_user menyimpan semuanya ke profiles dengan
  /// approval_status 'pending' (migrate-approval-status.sql) sampai admin
  /// menyetujui lewat tab "Pendaftar Teknisi".
  /// [ktpPath] = path file di bucket PRIVAT ktp-documents (folder pendaftaran/),
  /// WAJIB diisi — pendaftar tanpa KTP ditolak di sisi UI & web.
  /// [redirectTo] = deep link balik email verifikasi (lihat [daftarAkun]).
  static Future<HasilDaftar> daftarTeknisi({
    required String email,
    required String password,
    required String name,
    required String phone,
    required String address,
    required String skill,
    required String ktpPath,
    String? redirectTo,
  }) =>
      _kirimPendaftaran(badanPermintaanDaftar(
        email: email,
        password: password,
        name: name,
        phone: phone,
        address: address,
        role: 'technician',
        skill: skill,
        ktpUrl: ktpPath,
        redirectTo: redirectTo,
      ));

  /// Kirim permintaan pendaftaran ke server web lalu tafsirkan jawabannya.
  static Future<HasilDaftar> _kirimPendaftaran(String badan) async {
    final origin = AppConfig.webBaseUrl.replaceAll(RegExp(r'/+$'), '');
    final res = await http
        .post(
          Uri.parse('$origin/api/auth/register'),
          headers: {'Content-Type': 'application/json'},
          body: badan,
        )
        .timeout(const Duration(seconds: 20));
    return tafsirResponsDaftar(res.statusCode, res.body);
  }

  /// Upload foto KTP pendaftar ke bucket PRIVAT `ktp-documents`, folder
  /// `pendaftaran/`. DIPANGGIL SEBELUM akun dibuat (user masih anon), jadi
  /// JANGAN pakai uploadToBucket — itu menyisipkan uid ke path & menuntut
  /// sesi. Policy insert anon khusus folder pendaftaran/ sudah ada di
  /// migrate-technician-ktp.sql (sama seperti alur web).
  static Future<String> uploadKtpPendaftaran(Uint8List bytes) async {
    final path = 'pendaftaran/ktp-${DateTime.now().millisecondsSinceEpoch}.jpg';
    await db.storage.from('ktp-documents').uploadBinary(path, bytes,
        fileOptions:
            const FileOptions(contentType: 'image/jpeg', upsert: false));
    return path;
  }

  /// Kirim email tautan reset kata sandi — lewat server web, BUKAN lewat
  /// mailer Supabase.
  ///
  /// `db.auth.resetPasswordForEmail` sudah TIDAK dipakai lagi: mailer bawaan
  /// Supabase hanya melayani alamat anggota tim project (2 pesan/jam) sehingga
  /// akun pelanggan biasa tidak pernah menerima emailnya, walau layar berkata
  /// "Tautan terkirim!" — kegagalan yang paling sulit terlihat justru di sini.
  /// Server (POST /api/auth/reset) membuat tautannya sendiri lalu mengirimnya
  /// lewat Resend; lihat src/lib/password-reset.js.
  ///
  /// [redirectTo] menentukan ke mana pengguna kembali setelah mengklik tautan:
  /// Android → deep link `fixify://reset-password` (AppConfig
  /// .resetPasswordRedirect) agar app terbuka dengan sesi pemulihan; null →
  /// server memakai Site URL (dipakai jalur web).
  ///
  /// Melempar:
  ///   - [AuthException] ber-`statusCode` 429 saat server menolak karena jeda
  ///     per alamat — dibedakan supaya layar tidak bilang "terkirim";
  ///   - [Exception] biasa untuk kegagalan lain (server mati, email belum siap).
  ///     Kegagalan jaringan dilempar apa adanya oleh `http` supaya layar bisa
  ///     memakai kalimat "Tidak ada koneksi internet…".
  static Future<void> sendPasswordReset(String email,
      {String? redirectTo}) async {
    final origin = AppConfig.webBaseUrl.replaceAll(RegExp(r'/+$'), '');
    final res = await http
        .post(
          Uri.parse('$origin/api/auth/reset'),
          headers: {'Content-Type': 'application/json'},
          body: badanPermintaanReset(email, redirectTo),
        )
        .timeout(const Duration(seconds: 15));

    final hasil = tafsirResponsReset(res.statusCode, res.body);
    if (hasil.ok) return;

    if (hasil.jeda) {
      // Diteruskan sebagai AuthException agar layar memakai jalur yang sama
      // dengan batas pengiriman email versi lama (gagalKarenaBatasEmail).
      throw AuthException(
        hasil.pesan ?? 'Permintaan tautan baru saja dikirim.',
        statusCode: '429',
        code: 'jeda_per_alamat',
      );
    }
    throw Exception(hasil.pesan ?? 'HTTP ${res.statusCode}');
  }

  /// Simpan kata sandi baru untuk sesi pemulihan yang sedang aktif
  /// (hasil klik tautan email reset). Sesi ini bersifat sementara —
  /// panggil setelah pengguna mengisi form "Kata Sandi Baru".
  static Future<void> updatePassword(String newPassword) =>
      db.auth.updateUser(UserAttributes(password: newPassword));

  static Future<void> signOut() => db.auth.signOut();

  // ============ push FCM (Android) ============

  /// Daftarkan token FCM perangkat ini ke tabel fcm_tokens agar server
  /// bisa mengirim push (tugas baru, status pesanan) walau app tertutup.
  /// on-conflict token → baris diambil alih user sekarang (pindah akun
  /// di perangkat sama). Dipanggil pasca-login & tiap app start.
  static Future<void> registerFcmToken(String token) async {
    final uid = session?.user.id;
    if (uid == null || token.isEmpty) return;
    try {
      await db.from('fcm_tokens').upsert(
        {
          'user_id': uid,
          'token': token,
          'platform': 'android',
          'user_agent': 'flutter-app',
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        },
        onConflict: 'token',
      );
    } catch (_) {
      // tabel belum ada / offline — push saja yang tidak aktif, app tetap normal
    }
  }

  /// Hapus token perangkat ini saat logout agar push berhenti ke
  /// perangkat ini (kecuali diambil alih user lain yang login berikutnya).
  static Future<void> unregisterFcmToken(String token) async {
    if (token.isEmpty) return;
    try {
      await db.from('fcm_tokens').delete().eq('token', token);
    } catch (_) {}
  }

  /// Preferensi notifikasi per peristiwa milik user ini.
  /// Key yang tidak ada = aktif (default server), sama seperti panel web.
  static Future<Map<String, bool>> fetchNotificationPrefs() async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) return {};
    final row = await db
        .from('profiles')
        .select('notification_prefs')
        .eq('id', uid)
        .maybeSingle();
    final raw = row?['notification_prefs'];
    if (raw is! Map) return {};
    return {
      for (final e in raw.entries) e.key.toString(): e.value != false,
    };
  }

  /// Simpan perubahan preferensi notifikasi (partial: hanya key yang diubah).
  /// Dibaca-dulu-lalu-tulis agar key lain tidak hilang — server web memakai
  /// aturan merge yang sama (src/app/actions/notifications.js).
  static Future<void> saveNotificationPrefs(Map<String, bool> patch) async {
    if (patch.isEmpty) return;
    final uid = db.auth.currentUser?.id;
    if (uid == null) return;
    final merged = {...await fetchNotificationPrefs(), ...patch};
    await db
        .from('profiles')
        .update({'notification_prefs': merged}).eq('id', uid);
  }

  /// Profil user saat ini (row di tabel profiles).
  static Future<Profile?> myProfile() async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) return null;
    final row = await db.from('profiles').select().eq('id', uid).maybeSingle();
    return row == null ? null : Profile.fromMap(row);
  }

  /// Ringkasan penilaian (rating) teknisi untuk dirinya sendiri — jumlah
  /// ulasan + rata-ratanya.
  ///
  /// Policy `reviews readable by everyone` (supabase/migrate-reviews.sql)
  /// membolehkan SELECT untuk siapa pun, jadi teknisi bisa membaca penilaiannya
  /// sendiri tanpa RPC security definer. Hitungannya memakai aturan yang sama
  /// dengan panel admin web (agregat `rating` per teknisi di
  /// src/app/actions/admin.js).
  ///
  /// Mengembalikan null bila TIDAK BISA dibaca (tidak ada sesi, tabel belum
  /// ada, offline). Sengaja dibedakan dari [RatingSummary.kosong] (0 ulasan):
  /// "Belum ada rating" adalah pernyataan tentang teknisi, sedangkan kegagalan
  /// baca bukan — layar harus menyembunyikan lencananya, bukan berbohong.
  static Future<RatingSummary?> myRatingSummary() async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) return null;
    try {
      final rows =
          await db.from('reviews').select('rating').eq('technician_id', uid);
      return summarizeRatings(
        rows.map<int>((m) => (m['rating'] as num?)?.toInt() ?? 0),
      );
    } catch (_) {
      return null;
    }
  }

  /// Kartu skor MANDIRI teknisi — RPC `my_technician_scorecard`
  /// (supabase/migrate-technician-my-scorecard.sql).
  ///
  /// Identitas TIDAK dikirim dari klien: server memakai `auth.uid()` di dalam
  /// fungsi security definer, sehingga aplikasi tidak punya cara meminta skor
  /// teknisi lain. Ini bukan sekadar kenyamanan — inilah jaminan "tanpa
  /// membocorkan data teknisi lain" di sisi data.
  ///
  /// Hasil dibedakan:
  ///   * `data != null`        → angka periode itu;
  ///   * `gagal == false`      → server menjawab kosong (bukan teknisi / belum
  ///                             ada baris) — bukan error;
  ///   * `gagal == true`       → RPC/jaringan bermasalah (mis. migrasi belum
  ///                             dijalankan), layar menampilkan tombol coba lagi.
  static Future<({MyScorecard? data, bool gagal})> myTechnicianScorecard(
      {int days = 90}) async {
    try {
      final res =
          await db.rpc('my_technician_scorecard', params: {'p_days': days});
      final rows = res is List ? res : const [];
      if (rows.isEmpty) return (data: null, gagal: false);
      return (
        data: MyScorecard.fromMap((rows.first as Map).cast<String, dynamic>()),
        gagal: false,
      );
    } catch (_) {
      return (data: null, gagal: true);
    }
  }

  static Future<void> updateMyProfile(
      {String? name,
      String? phone,
      String? address,
      String? avatarUrl,
      String? serviceArea}) async {
    final uid = db.auth.currentUser!.id;
    final patch = <String, dynamic>{};
    if (name != null) patch['name'] = name;
    if (phone != null) patch['phone'] = phone;
    if (address != null) patch['address'] = address;
    if (avatarUrl != null) patch['avatar_url'] = avatarUrl;
    if (serviceArea != null) patch['service_area'] = serviceArea;
    await db.from('profiles').update(patch).eq('id', uid);
  }

  /// Simpan alamat berlabel ke buku alamat pelanggan
  /// (RPC `save_my_address`, migrate-customer-address-book.sql).
  ///
  /// Alamat yang sama tidak diduplikasi; `makePrimary` memindahkan tanda
  /// utama sekaligus menyamakan `profiles.address`. Mengembalikan seluruh isi
  /// buku terbaru supaya layar tidak menebak hasilnya.
  static Future<({bool ok, String? error, List<SavedAddress> alamat})>
      saveMyAddress({
    required String label,
    required String address,
    double? lat,
    double? lng,
    bool makePrimary = false,
  }) async {
    try {
      final res = await db.rpc('save_my_address', params: {
        'p_label': label,
        'p_address': address,
        'p_lat': lat,
        'p_lng': lng,
        'p_make_primary': makePrimary,
      });
      final m = res is Map ? res.cast<String, dynamic>() : <String, dynamic>{};
      return (
        ok: m['ok'] == true,
        error: (m['error'] as String?)?.trim(),
        alamat: parseSavedAddresses(m['saved_addresses']),
      );
    } catch (_) {
      return (
        ok: false,
        error: 'Gagal menyimpan alamat. Periksa koneksi lalu coba lagi.',
        alamat: const <SavedAddress>[],
      );
    }
  }

  /// Hapus satu alamat dari buku (RPC `delete_my_address`).
  static Future<({bool ok, String? error, List<SavedAddress> alamat})>
      deleteMyAddress(String id) async {
    try {
      final res = await db.rpc('delete_my_address', params: {'p_id': id});
      final m = res is Map ? res.cast<String, dynamic>() : <String, dynamic>{};
      return (
        ok: m['ok'] == true,
        error: (m['error'] as String?)?.trim(),
        alamat: parseSavedAddresses(m['saved_addresses']),
      );
    } catch (_) {
      return (
        ok: false,
        error: 'Gagal menghapus alamat. Periksa koneksi lalu coba lagi.',
        alamat: const <SavedAddress>[],
      );
    }
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
          fileOptions:
              const FileOptions(contentType: 'image/jpeg', upsert: true),
        );
    final url = db.storage.from('profile-media').getPublicUrl(path);
    await updateMyProfile(avatarUrl: url);
    return url;
  }

  // ============ bukti foto pekerjaan (sebelum/sesudah) ============

  /// Ambil foto bukti pekerjaan (kamera/galeri), kompres, lalu SIMPAN ke
  /// folder dokumen aplikasi.
  ///
  /// Disalin ke penyimpanan permanen — bukan cache — karena antrean luring
  /// harus bisa mengunggahnya berjam-jam kemudian setelah sinyal kembali.
  static Future<File?> pickJobPhoto({
    required ImageSource source,
    required String bookingId,
    required String kind,
  }) async {
    final bytes = await pickAndCompressImage(
      source: source,
      maxSide: 1400,
      quality: 70,
      maxBytes: 350 * 1024,
    );
    if (bytes == null) return null;
    final dir = await getApplicationDocumentsDirectory();
    final folder = Directory('${dir.path}/job-proofs');
    if (!await folder.exists()) await folder.create(recursive: true);
    final aman = bookingId.replaceAll(RegExp(r'[^A-Za-z0-9-]'), '');
    final file = File(
        '${folder.path}/$aman-$kind-${DateTime.now().millisecondsSinceEpoch}.jpg');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  /// Unggah satu foto bukti ke bucket privat `booking-proofs` lalu lampirkan
  /// path-nya ke pesanan lewat RPC `attach_job_photo` (server memverifikasi
  /// bahwa path itu memang milik pesanan & teknisi yang memanggil).
  ///
  /// Best-effort TIDAK berlaku di sini: antrean butuh jawaban jelas, jadi
  /// kegagalan dikembalikan sebagai nilai, bukan dilempar.
  static Future<({bool ok, String? error})> uploadJobPhotoFile({
    required String bookingId,
    required String kind,
    required String filePath,
  }) async {
    try {
      final file = File(filePath);
      if (!await file.exists()) {
        return (
          ok: false,
          error: 'Foto bukti sudah tidak ada di penyimpanan HP.',
        );
      }
      final path =
          '$bookingId/$kind-${DateTime.now().millisecondsSinceEpoch}.jpg';
      await db.storage.from('booking-proofs').upload(
            path,
            file,
            fileOptions: const FileOptions(contentType: 'image/jpeg'),
          );
      final res = await db.rpc('attach_job_photo', params: {
        'p_booking': bookingId,
        'p_kind': kind,
        'p_path': path,
      });
      final m = (res as Map?)?.cast<String, dynamic>() ?? const {};
      if (m['ok'] == true) return (ok: true, error: null);
      return (
        ok: false,
        error: m['error'] as String? ?? 'Foto tidak bisa dilampirkan.',
      );
    } catch (_) {
      return (
        ok: false,
        error: 'Foto belum terunggah — periksa koneksi.',
      );
    }
  }

  /// Signed URL (1 jam) untuk path foto bukti. Bucket-nya privat; RLS storage
  /// hanya mengizinkan teknisi yang ditugaskan, pelanggan pemilik, dan admin.
  static Future<String?> jobPhotoUrl(String? path) async {
    final p = (path ?? '').trim();
    if (p.isEmpty) return null;
    try {
      return await db.storage.from('booking-proofs').createSignedUrl(p, 3600);
    } catch (_) {
      return null;
    }
  }

  // ============ no-show pelanggan ============

  /// Laporkan pelanggan tidak ada di lokasi (RPC security definer).
  /// Server memeriksa: pemanggil teknisi pesanan ini, status masih `paid`,
  /// belum mulai, sudah lewat slot + 15 menit, dan (bila titik rumah + GPS
  /// tersedia) jarak ≤ 500 m. Koordinat/foto boleh null — GPS lapangan sering
  /// tidak akurat, dan bukti foto bersifat opsional.
  static Future<({bool ok, String? error})> reportCustomerNoShow(
    String bookingId, {
    double? lat,
    double? lng,
    String? photoPath,
    String? note,
  }) async {
    try {
      final res = await db.rpc('report_customer_no_show', params: {
        'p_booking': bookingId,
        'p_lat': lat,
        'p_lng': lng,
        'p_photo_path': (photoPath ?? '').trim().isEmpty ? null : photoPath,
        'p_note': (note ?? '').trim().isEmpty ? null : note!.trim(),
      });
      final m = _asMap(res);
      if (m['ok'] == true) {
        unawaited(notifyCustomerNoShow(bookingId));
        return (ok: true, error: null);
      }
      return (
        ok: false,
        error: (m['error'] as String?) ?? 'Laporan gagal dikirim.',
      );
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan);
      }
      return (ok: false, error: 'Laporan belum terkirim — periksa koneksi.');
    }
  }

  /// Pelanggan menekan "Saya di sini" setelah laporan no-show.
  static Future<({bool ok, String? error})> confirmCustomerPresent(
      String bookingId) async {
    try {
      final res =
          await db.rpc('confirm_customer_present', params: {'p_booking': bookingId});
      final m = _asMap(res);
      if (m['ok'] == true) {
        unawaited(notifyCustomerPresent(bookingId));
        return (ok: true, error: null);
      }
      return (
        ok: false,
        error: (m['error'] as String?) ?? 'Konfirmasi gagal dikirim.',
      );
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan);
      }
      return (ok: false, error: 'Konfirmasi belum terkirim — periksa koneksi.');
    }
  }

  /// Beri tahu server web (pemegang kunci push) tentang no-show supaya
  /// pelanggan menerima "kami tunggu 10 menit". Best-effort.
  static Future<void> notifyCustomerNoShow(String bookingId) async {
    await _notifyWeb('/api/notify-booking-status',
        {'bookingId': bookingId, 'event': 'customer_no_show'});
  }

  /// Beri tahu teknisi bahwa pelanggan sudah di lokasi. Best-effort.
  static Future<void> notifyCustomerPresent(String bookingId) async {
    await _notifyWeb('/api/notify-booking-change',
        {'bookingId': bookingId, 'event': 'customer_present'});
  }

  // ============ biaya tambahan di lokasi ============

  /// Semua usulan biaya tambahan satu pesanan, terbaru dulu.
  static Future<List<BookingExtraCharge>> fetchExtraCharges(
      String bookingId) async {
    final rows = await db
        .from('booking_extra_charges')
        .select('*')
        .eq('booking_id', bookingId)
        .order('created_at', ascending: false);
    return [
      for (final r in rows)
        BookingExtraCharge.fromMap((r as Map).cast<String, dynamic>()),
    ];
  }

  /// Fail-soft: migrasi belum jalan / offline = tidak ada kartu biaya tambahan.
  static Future<List<BookingExtraCharge>> fetchExtraChargesSafe(
      String bookingId) async {
    try {
      return await fetchExtraCharges(bookingId);
    } catch (_) {
      return const <BookingExtraCharge>[];
    }
  }

  /// Unggah foto temuan ke bucket privat `booking-proofs` dan kembalikan
  /// PATH-nya (bukan URL). Path dipakai saat mengusulkan biaya tambahan; RPC
  /// menolak path pesanan lain.
  static Future<({String? path, String? error})> uploadExtraChargePhoto({
    required String bookingId,
    required String filePath,
  }) async {
    try {
      final file = File(filePath);
      if (!await file.exists()) {
        return (path: null, error: 'Foto sudah tidak ada di penyimpanan HP.');
      }
      final path =
          '$bookingId/extra-${DateTime.now().millisecondsSinceEpoch}.jpg';
      await db.storage.from('booking-proofs').upload(
            path,
            file,
            fileOptions: const FileOptions(contentType: 'image/jpeg'),
          );
      return (path: path, error: null);
    } catch (_) {
      return (path: null, error: 'Foto gagal diunggah — periksa koneksi.');
    }
  }

  /// Teknisi mengusulkan biaya tambahan. BELUM menagih apa pun — menunggu
  /// persetujuan pelanggan lewat [decideExtraCharge].
  static Future<({bool ok, String? error})> proposeExtraCharge(
    String bookingId, {
    required int amount,
    required String reason,
    String? photoPath,
  }) async {
    try {
      final res = await db.rpc('propose_extra_charge', params: {
        'p_booking': bookingId,
        'p_amount': amount,
        'p_reason': reason,
        'p_photo_path':
            (photoPath ?? '').trim().isEmpty ? null : photoPath,
      });
      final m = _asMap(res);
      if (m['ok'] == true) {
        unawaited(_notifyWeb('/api/notify-booking-status',
            {'bookingId': bookingId, 'event': 'extra_charge'}));
        return (ok: true, error: null);
      }
      return (
        ok: false,
        error: (m['error'] as String?) ?? 'Usulan gagal dikirim.',
      );
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan);
      }
      return (ok: false, error: 'Usulan belum terkirim — periksa koneksi.');
    }
  }

  /// Pelanggan memutuskan usulan biaya tambahan. Persetujuan menaikkan total
  /// pesanan di server (atomik); penolakan tidak mengubah uang sama sekali.
  static Future<({bool ok, String? error, int? total})> decideExtraCharge(
      String chargeId, bool approve) async {
    try {
      final res = await db.rpc('decide_extra_charge', params: {
        'p_charge': chargeId,
        'p_approve': approve,
      });
      final m = _asMap(res);
      if (m['ok'] == true) {
        return (
          ok: true,
          error: null,
          total: (m['total_price'] as num?)?.toInt(),
        );
      }
      return (
        ok: false,
        error: (m['error'] as String?) ?? 'Keputusan gagal disimpan.',
        total: null,
      );
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan, total: null);
      }
      return (
        ok: false,
        error: 'Keputusan belum terkirim — periksa koneksi.',
        total: null,
      );
    }
  }

  // ============ langganan servis berkala ============

  /// Simpan pilihan "ulangi tiap N bulan" dari sebuah pesanan selesai.
  ///
  /// TIDAK membuat pesanan/tagihan apa pun — server hanya menyimpan jadwal
  /// pengingat. Keputusan membeli tetap di tangan pelanggan.
  static Future<({bool ok, String? error, DateTime? nextDate})>
      subscribeFromBooking(String bookingId, int months) async {
    try {
      final res = await db.rpc('subscribe_from_booking',
          params: {'p_booking': bookingId, 'p_months': months});
      final m = (res as Map?)?.cast<String, dynamic>() ?? const {};
      final raw = m['next_date'];
      return (
        ok: m['ok'] == true,
        error: m['error'] as String?,
        nextDate: raw is String ? DateTime.tryParse(raw) : null,
      );
    } catch (_) {
      return (
        ok: false,
        error: 'Langganan belum tersimpan — periksa koneksi.',
        nextDate: null,
      );
    }
  }

  /// Langganan aktif milik pengguna (kosong bila migrasi belum dijalankan).
  static Future<List<ServiceSubscription>> mySubscriptions() async {
    try {
      final res = await db.rpc('my_subscriptions');
      final rows = res is List ? res : const [];
      return [
        for (final r in rows)
          ServiceSubscription.fromMap((r as Map).cast<String, dynamic>())
      ];
    } catch (_) {
      return const <ServiceSubscription>[];
    }
  }

  static Future<bool> cancelSubscription(String id) async {
    try {
      final res = await db.rpc('cancel_subscription', params: {'p_id': id});
      return (res as Map?)?['ok'] == true;
    } catch (_) {
      return false;
    }
  }

  /// Majukan jadwal pengingat (dipakai "Pesan sekarang" & "Tunda").
  static Future<bool> advanceSubscription(String id, {int? months}) async {
    try {
      final res = await db
          .rpc('advance_subscription', params: {'p_id': id, 'p_bulan': months});
      return (res as Map?)?['ok'] == true;
    } catch (_) {
      return false;
    }
  }

  // ============ hapus akun (syarat Google Play) ============

  /// Status permintaan hapus akun milik pengguna + alasan yang menahannya.
  ///
  /// Server yang memutuskan kelayakannya (fungsi `hapus_akun_blokir` di
  /// supabase/migrate-account-deletion.sql) — aplikasi hanya menampilkan, supaya
  /// aturannya tidak terbelah dua antara klien dan database.
  static Future<AccountDeletionState> myAccountDeletion() async {
    try {
      final res = await db.rpc('my_account_deletion');
      return AccountDeletionState.fromRpc(_asMap(res));
    } catch (_) {
      return AccountDeletionState.kosong;
    }
  }

  /// Ajukan penghapusan akun dari dalam aplikasi.
  ///
  /// Identitas sudah terbukti oleh sesi login, jadi permintaan langsung masuk
  /// antrean operator (berbeda dari jalur web yang perlu konfirmasi email).
  static Future<({bool ok, String? error, AccountDeletionState state})>
      requestAccountDeletion(String? reason) async {
    final alasan = rapikanAlasan(reason);
    try {
      final res = await db.rpc('request_account_deletion', params: {
        if (alasan.isNotEmpty) 'p_alasan': alasan,
      });
      final m = _asMap(res);
      if (m['ok'] != true) {
        return (
          ok: false,
          error: hapusAkunBlokirPesan(m['error'] as String?),
          state: AccountDeletionState.kosong,
        );
      }
      return (ok: true, error: null, state: await myAccountDeletion());
    } catch (e) {
      return (
        ok: false,
        error: _pesanHapusAkunGagal(e),
        state: AccountDeletionState.kosong
      );
    }
  }

  /// Batalkan permintaan hapus akun yang belum dijalankan operator.
  static Future<({bool ok, String? error})> cancelAccountDeletion() async {
    try {
      final res = await db.rpc('cancel_account_deletion');
      final m = _asMap(res);
      if (m['ok'] != true) {
        return (
          ok: false,
          error: 'Tidak ada permintaan hapus akun yang bisa dibatalkan.'
        );
      }
      return (ok: true, error: null);
    } catch (e) {
      return (ok: false, error: _pesanHapusAkunGagal(e));
    }
  }

  /// Peta galat RPC hapus akun → kalimat untuk pengguna.
  ///
  /// Migrasi yang belum dijalankan muncul sebagai "function ... does not exist"
  /// (PostgREST) — itu BUKAN kesalahan pengguna, jadi dikatakan apa adanya dan
  /// disebut berkas migrasinya, bukan "terjadi kesalahan".
  static String _pesanHapusAkunGagal(Object e) {
    final s = e.toString();
    if (s.contains('does not exist') ||
        s.contains('Could not find the function')) {
      return 'Fitur hapus akun belum aktif di server. Coba lagi setelah operator menyelesaikan penyiapannya.';
    }
    return 'Gagal menghubungi server. Periksa koneksimu lalu coba lagi.';
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

  /// Semua pesan untuk beberapa pesanan sekaligus — dipakai penghitung badge
  /// chat saat aplikasi dibuka/dikembalikan ke depan. Satu query agar tidak
  /// menembak server sekali per pesanan.
  ///
  /// Urut TERBARU dulu + batas 1000 (batas default PostgREST): bila riwayat
  /// sangat panjang, yang terpotong adalah pesan lama, bukan pesan baru yang
  /// justru menentukan badge.
  static Future<List<ChatMessage>> fetchChatMessagesForBookings(
      Iterable<String> bookingIds) async {
    final ids = bookingIds.where((id) => id.isNotEmpty).toSet().toList();
    if (ids.isEmpty) return const <ChatMessage>[];
    final rows = await db
        .from('chat_messages')
        .select('id, booking_id, sender_id, body, created_at')
        .inFilter('booking_id', ids)
        .order('created_at', ascending: false)
        .limit(1000);
    return rows.map<ChatMessage>((m) => ChatMessage.fromMap(m)).toList();
  }

  /// Kirim pesan sebagai user yang sedang login (RLS memaksa sender = diri
  /// sendiri dan hanya peserta pesanan yang boleh).
  ///
  /// Setelah terkirim: picu worker push (fire-and-forget) agar notifikasi
  /// antrean (dibuat trigger DB) langsung dibagikan ke lawan bicara.
  static Future<void> sendChatMessage(String bookingId, String body) async {
    final uid = db.auth.currentUser!.id;
    await db.from('chat_messages').insert({
      'booking_id': bookingId,
      'sender_id': uid,
      'body': body.trim(),
    });
    unawaited(kickPushWorker());
  }

  /// Status blokir chat antara saya dan [peerId] (kedua arah).
  ///
  /// Gagal membaca (tabel `chat_blocks` belum ada karena migrasi belum
  /// dijalankan, atau jaringan bermasalah) SELALU dianggap "tidak ada blokir":
  /// mengunci chat karena kegagalan membaca status jauh lebih merugikan
  /// pengguna daripada sekali menampilkan kotak pesan yang nanti ditolak RLS.
  static Future<ChatBlockState> fetchChatBlockState(String peerId) async {
    final uid = db.auth.currentUser?.id;
    if (uid == null || uid.isEmpty || peerId.isEmpty || peerId == uid) {
      return ChatBlockState.none;
    }
    try {
      final rows = await db
          .from('chat_blocks')
          .select('blocker_id')
          .or('and(blocker_id.eq.$uid,blocked_id.eq.$peerId),'
              'and(blocker_id.eq.$peerId,blocked_id.eq.$uid)');
      var byMe = false;
      var byPeer = false;
      for (final r in rows) {
        if (r['blocker_id'] == uid) byMe = true;
        if (r['blocker_id'] == peerId) byPeer = true;
      }
      return ChatBlockState(byMe: byMe, byPeer: byPeer);
    } catch (_) {
      return ChatBlockState.none;
    }
  }

  /// Blokir [peerId] (idempoten — menekan dua kali tidak menggandakan baris).
  ///
  /// [bookingId] hanya jejak audit bagi admin; blokirnya sendiri berlaku di
  /// semua percakapan dengan pengguna itu. RLS memaksa blocker = diri sendiri.
  static Future<void> blockChatUser(
    String peerId, {
    String? bookingId,
    String? reason,
  }) async {
    final uid = db.auth.currentUser!.id;
    await db.from('chat_blocks').upsert({
      'blocker_id': uid,
      'blocked_id': peerId,
      if (bookingId != null && bookingId.isNotEmpty) 'booking_id': bookingId,
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    }, onConflict: 'blocker_id,blocked_id');
  }

  /// Buka blokir [peerId]. Hanya blokir milik sendiri yang bisa dihapus (RLS).
  static Future<void> unblockChatUser(String peerId) async {
    final uid = db.auth.currentUser!.id;
    await db
        .from('chat_blocks')
        .delete()
        .eq('blocker_id', uid)
        .eq('blocked_id', peerId);
  }

  /// Laporkan percakapan chat ke admin (kebijakan UGC Google Play).
  ///
  /// Masuk ke tabel `reports` yang sama dengan laporan pesanan supaya admin
  /// memprosesnya di satu tempat; kolom `kind` = 'chat' dan `reason` menandai
  /// jenisnya. `target_id` = lawan bicara supaya panel admin bisa menyebut
  /// siapa yang dilaporkan, dan `booking_id` supaya percakapannya bisa dibuka.
  static Future<void> reportChat({
    required String bookingId,
    required String bookingCode,
    required String peerId,
    required ChatReportReason reason,
    String? detail,
  }) async {
    final uid = db.auth.currentUser!.id;
    // Peran pelapor menentukan bagaimana admin membaca laporan ini; diambil
    // dari penetapan pada pesanan (paritas `createReport`).
    String authorRole = 'customer';
    final own = await db
        .from('bookings')
        .select('id')
        .eq('id', bookingId)
        .eq('technician_id', uid)
        .maybeSingle();
    if (own != null) authorRole = 'technician';

    final inserted = await db.from('reports').insert({
      'author_id': uid,
      'author_role': authorRole,
      'kind': 'chat',
      'reason': reason.value,
      'title': chatReportTitle(bookingCode),
      'content': chatReportContent(reasonLabel: reason.label, detail: detail),
      'booking_id': bookingId,
      'target_id': peerId,
    }).select('id');
    if (inserted.isNotEmpty) {
      unawaited(
          notifyAdminEvent('new_report', inserted.first['id'] as String?));
    }
  }

  /// URL worker push — origin diambil dari [AppConfig.webBaseUrl], sumber yang
  /// sama dengan pemanggilan API web lain dan bisa diarahkan lewat
  /// `--dart-define=WEB_BASE_URL=...`.
  ///
  /// JANGAN hardcode domain di sini. Sebelumnya nilai ini `https://fixify.id`
  /// yang TIDAK menunjuk deployment mana pun (koneksi gagal, HTTP 000),
  /// sehingga worker tak pernah dijalankan: antrean `push_outbox` menumpuk
  /// dengan `attempts=0` dan notifikasi chat tidak pernah sampai ke perangkat
  /// penerima. Dijaga oleh test/push_worker_origin_test.dart.
  static String pushWorkerUrl() {
    final origin = AppConfig.webBaseUrl.replaceAll(RegExp(r'/+$'), '');
    return '$origin/api/push-worker';
  }

  /// Picu POST /api/push-worker (fire-and-forget) untuk menyapu antrean push
  /// yang tertunda. Gagal = tidak masalah — worker dipicu lagi pada interaksi
  /// berikutnya atau saat aplikasi dibuka.
  static Future<void> kickPushWorker() =>
      WorkerKickHelper.kick(pushWorkerUrl());

  /// Berlangganan pesan baru secara realtime. Mengembalikan fungsi
  /// cleanup untuk membatalkan channel (dipanggil di dispose).
  /// Peta id → status laporan MILIK pengguna ini (query ringan: hanya dua
  /// kolom). Dipakai badge tab Laporan: angka dihitung dari selisih peta ini
  /// dengan snapshot "terakhir dilihat" milik perangkat (lib/report_seen.dart).
  static Future<Map<String, String>> fetchMyReportStatuses() async {
    final uid = db.auth.currentUser!.id;
    final rows =
        await db.from('reports').select('id,status').eq('author_id', uid);
    return {
      for (final r in rows)
        (r['id'] as String): (r['status'] as String?) ?? kReportStatusOpen,
    };
  }

  /// Realtime UPDATE laporan milik [uid] — admin menanggapi (status/catatan).
  ///
  /// Sama seperti laporan pesanan: tabel `reports` sudah ada di publication
  /// `supabase_realtime` (migrate-realtime-admin.sql) dan policy "author can
  /// view own reports" membuat RLS meneruskan event ini ke penulisnya.
  /// Hanya admin yang boleh meng-update reports, jadi tidak ada event
  /// pantulan aksi pengguna sendiri.
  static ChatUnsubscribe subscribeReportUpdates(
      String uid, void Function(ReportUpdate) onUpdate) {
    final channel = db.channel('reports-$uid');
    var active = true;

    void handle(PostgresChangePayload payload) {
      if (!active) return;
      final row = payload.newRecord;
      final id = row['id'] as String?;
      if (id == null || id.isEmpty) return;
      final old = payload.oldRecord;
      onUpdate(ReportUpdate(
        id: id,
        title: (row['title'] as String?) ?? (old['title'] as String?) ?? '',
        status: (row['status'] as String?) ?? kReportStatusOpen,
        prevStatus: old['status'] as String?,
        adminNote: row['admin_note'] as String?,
      ));
    }

    channel.onPostgresChanges(
      event: PostgresChangeEvent.update,
      schema: 'public',
      table: 'reports',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'author_id',
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

  /// Realtime KEPUTUSAN admin atas saldo teknisi [uid]: UPDATE pada
  /// `balance_deposits` (setoran disetujui/ditolak) dan `balance_withdrawals`
  /// (penarikan disetujui/ditolak).
  ///
  /// postgres_changes menghormati RLS, jadi yang diterima hanya baris milik
  /// teknisi ini (`bd_select_own` / `bw_select_own`). Tabel WAJIB terdaftar di
  /// publication `supabase_realtime` — jalankan
  /// `supabase/migrate-realtime-balance.sql`; tanpa itu channel tetap
  /// ter-subscribe tetapi tidak pernah menerima event, dan aplikasi masih
  /// memperbarui angka lewat pemeriksaan berkala di layar Pekerjaan.
  static ChatUnsubscribe subscribeBalanceUpdates(
      String uid, void Function() onChange) {
    final channel = db.channel('balance-$uid');
    var active = true;

    void handle(PostgresChangePayload payload) {
      if (!active) return;
      onChange();
    }

    for (final tabel in const ['balance_deposits', 'balance_withdrawals']) {
      channel.onPostgresChanges(
        event: PostgresChangeEvent.update,
        schema: 'public',
        table: tabel,
        filter: PostgresChangeFilter(
          type: PostgresChangeFilterType.eq,
          column: 'technician_id',
          value: uid,
        ),
        callback: handle,
      );
    }
    channel.subscribe();
    return () async {
      if (!active) return;
      active = false;
      await db.removeChannel(channel);
    };
  }

  /// Realtime SEMUA pesan chat yang boleh dilihat pengguna ini (RLS yang
  /// menyaring: pelanggan hanya pesanan miliknya, teknisi hanya yang
  /// ditugaskan). Dipakai badge chat global — tanpa ini badge hanya bergantung
  /// pada push FCM yang bisa telat atau dimatikan lewat preferensi.
  static ChatUnsubscribe subscribeIncomingChat(
      String uid, void Function(ChatMessage) onMessage) {
    final channel = db.channel('chat-inbox-$uid');
    var active = true;
    channel.onPostgresChanges(
      event: PostgresChangeEvent.insert,
      schema: 'public',
      table: 'chat_messages',
      callback: (payload) {
        if (!active) return;
        final row = payload.newRecord;
        if (row.isNotEmpty) onMessage(ChatMessage.fromMap(row));
      },
    );
    channel.subscribe();
    return () async {
      if (!active) return;
      active = false;
      await db.removeChannel(channel);
    };
  }

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
  /// [onRefundUpdate] dipanggil saat admin memutuskan pengembalian dana
  /// pesanan milik [uid] (tabel `booking_refunds`) — kotak masuk pelanggan
  /// menghitung ulang angka belum dibacanya tanpa menunggu aplikasi di-resume.
  /// Butuh `supabase/migrate-realtime-refunds.sql`; tanpa itu channel tetap
  /// berjalan dan angka diperbarui saat layar dimuat / app kembali ke depan.
  static ChatUnsubscribe subscribeBookingUpdates(
    String uid,
    void Function(BookingUpdate) onUpdate, {
    void Function()? onRefundUpdate,
  }) {
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
    // Keputusan refund (done/rejected) TIDAK mengubah baris bookings, jadi
    // perubahan status pengembalian dana butuh pendengar sendiri.
    if (onRefundUpdate != null) {
      channel.onPostgresChanges(
        event: PostgresChangeEvent.update,
        schema: 'public',
        table: 'booking_refunds',
        filter: PostgresChangeFilter(
          type: PostgresChangeFilterType.eq,
          column: 'user_id',
          value: uid,
        ),
        callback: (_) {
          if (active) onRefundUpdate();
        },
      );
    }
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
  ///
  /// Bila [lat]/[lng] tersedia (GPS on-duty), dipakai RPC available_jobs_nearby
  /// agar tiap job membawa jarak & daftar terurut terdekat; bila RPC itu
  /// belum ada (migrasi GPS belum dijalankan), jatuh ke available_jobs polos.
  static Future<List<AvailableJob>> fetchAvailableJobs(
      {double? lat, double? lng}) async {
    if (lat != null && lng != null) {
      try {
        final res = await db
            .rpc('available_jobs_nearby', params: {'p_lat': lat, 'p_lng': lng});
        return (res as List)
            .cast<Map<String, dynamic>>()
            .map(AvailableJob.fromMap)
            .toList();
      } catch (e) {
        // Migrasi GPS belum dijalankan → fungsi RPC tidak ada. Fallback,
        // error lain tetap dilempar.
        final msg = e.toString().toLowerCase();
        if (!msg.contains('does not exist') && !msg.contains('not found')) {
          rethrow;
        }
      }
    }
    final res = await db.rpc('available_jobs');
    return (res as List)
        .cast<Map<String, dynamic>>()
        .map(AvailableJob.fromMap)
        .toList();
  }

  /// Sisa kuota tiap slot pada satu tanggal (jumlah saja, bukan data pesanan).
  ///
  /// Gagal / migrasi `migrate-slot-capacity.sql` belum jalan → peta kosong;
  /// wizard lalu menampilkan semua slot (fail-open). Server tetap penentu
  /// terakhir lewat trigger, jadi tulisan tetap aman walau pembacaan ini gagal.
  static Future<Map<String, SlotUsage>> fetchSlotUsage(String date) async {
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date.trim())) {
      return const {};
    }
    try {
      final res =
          await db.rpc('booking_slot_usage', params: {'p_date': date.trim()});
      return slotUsageFrom(res);
    } catch (_) {
      return const {};
    }
  }

  /// GPS on-duty: simpan posisi terakhir teknisi (dipakai jarak ke job
  /// terbuka & pencarian teknisi terdekat oleh admin). Aman dipanggil
  /// berulang — upsert satu baris milik sendiri.
  static Future<({bool ok, String? error})> updateMyLocation(
      double lat, double lng) async {
    final res = await db
        .rpc('upsert_my_location', params: {'p_lat': lat, 'p_lng': lng});
    final m = (res as Map).cast<String, dynamic>();
    return (ok: m['ok'] == true, error: m['error'] as String?);
  }

  /// Klaim pekerjaan (atomik di server — satu pekerjaan satu teknisi).
  ///
  /// Setelah sukses, server web diberi tahu (fire-and-forget) agar pelanggan
  /// menerima push "teknisi ditugaskan": RPC ini hanya menulis baris bookings,
  /// sedangkan kunci VAPID/FCM ada di server web.
  ///
  /// [kode] adalah alasan terstruktur dari server — dipakai UI supaya tidak
  /// mencocokkan teks pesan (yang bisa berubah kapan saja). Yang sudah dipakai:
  ///   * `saldo_habis` — saldo 0/minus, pekerjaan baru ditolak sampai diisi
  ///     (supabase/migrate-claim-min-balance.sql); layar menawarkan isi saldo;
  ///   * `masih_bekerja` — masih memegang tugas `paid`/`in_progress`; selesaikan
  ///     dulu (atau lepas) sebelum mengambil yang baru;
  ///   * `tidak_tersedia` — sudah diambil teknisi lain / di luar keahlian;
  ///   * `bukan_teknisi_aktif` — belum disetujui admin.
  static Future<({bool ok, String? error, String? kode})> claimJob(
      String bookingId) async {
    final res = await db.rpc('claim_job', params: {'p_booking': bookingId});
    final m = (res as Map).cast<String, dynamic>();
    final ok = m['ok'] == true;
    if (ok) unawaited(notifyBookingStatus(bookingId, 'technician_assigned'));
    return (ok: ok, error: m['error'] as String?, kode: m['kode'] as String?);
  }

  /// Pekerjaan yang ditugaskan ke saya (teknisi).
  static Future<List<Booking>> fetchAssignedJobs() async {
    final uid = db.auth.currentUser!.id;
    final rows = await db
        .from('bookings')
        .select(
            // booking_items ikut dibaca: pesanan multi-varian / per m² butuh
            // rincian baris di kartu & detail (rincian hanya hidup di tabel
            // itu, bukan kolom bookings).
            '*, services(name), technician:profiles!bookings_technician_id_fkey(name, avatar_url), '
            'booking_items(*)')
        .eq('technician_id', uid)
        .order('booking_date', ascending: true);
    return rows.map<Booking>((m) => Booking.fromMap(m)).toList();
  }

  /// Ubah status pekerjaan oleh teknisi: 'in_progress' atau 'completed'.
  /// Completed otomatis memotong komisi dari saldo (idempoten di server).
  /// Bila completed: [commission] = komisi terpotong & [balance] = saldo
  /// terbaru (null bila migrasi `migrate-set-job-status-return.sql` belum
  /// dijalankan / sudah pernah dipotong sebelumnya).
  /// Bila sukses, server web diberi tahu (fire-and-forget) agar pelanggan
  /// menerima push "pengerjaan dimulai" / "pesanan selesai".
  static Future<({bool ok, String? error, num? commission, num? balance})>
      setJobStatus(String bookingId, String status) async {
    final res = await db.rpc('set_job_status',
        params: {'p_booking': bookingId, 'p_status': status});
    final m = (res as Map).cast<String, dynamic>();
    final ok = m['ok'] == true;
    if (ok) {
      unawaited(notifyBookingStatus(bookingId,
          status == 'completed' ? 'order_completed' : 'work_started'));
    }
    return (
      ok: ok,
      error: m['error'] as String?,
      commission: m['commission'] as num?,
      balance: m['balance'] as num?,
    );
  }

  /// Lepas tugas dengan alasan → pesanan kembali ke daftar Tersedia
  /// (technician_id null, status paid) dan bisa diambil teknisi lain.
  /// Setelah sukses, server web diberi tahu untuk mengirim push + email
  /// ke semua admin (fire-and-forget — gagal notif tidak menggagalkan).
  static Future<({bool ok, String? error})> releaseJob(
      String bookingId, String reason) async {
    final res = await db.rpc('release_job',
        params: {'p_booking': bookingId, 'p_reason': reason});
    final m = (res as Map).cast<String, dynamic>();
    final ok = m['ok'] == true;
    if (ok) unawaited(notifyAdminOfRelease(bookingId));
    return (ok: ok, error: m['error'] as String?);
  }

  /// Beri tahu server web (pemegang kunci push & email) bahwa tugas ini baru
  /// saja dilepas — server memverifikasi token, lalu meneruskan notifikasi
  /// berisi kode pesanan + alasan ke semua admin.
  /// Best-effort: gagal jaringan/env diabaikan.
  static Future<void> notifyAdminOfRelease(String bookingId) async {
    await _notifyWeb('/api/notify-job-release', {'bookingId': bookingId});
  }

  /// Beri tahu server web bahwa status pesanan baru berubah dari sisi teknisi
  /// (klaim / mulai / selesai) supaya pelanggan menerima PUSH. RPC Supabase
  /// hanya menulis DB; kunci VAPID & FCM ada di server web.
  /// [event]: 'technician_assigned' | 'work_started' | 'order_completed'.
  /// Best-effort: gagal jaringan/env diabaikan.
  static Future<void> notifyBookingStatus(
      String bookingId, String event) async {
    await _notifyWeb(
        '/api/notify-booking-status', {'bookingId': bookingId, 'event': event});
  }

  /// Beri tahu server web bahwa PELANGGAN membatalkan atau memindahkan
  /// pesanan, supaya teknisi yang sudah ditugaskan menerima push
  /// ([event] = 'order_cancelled' | 'order_rescheduled').
  ///
  /// Server memverifikasi pemanggil = pemilik pesanan DAN keadaan barisnya
  /// memang sesuai, jadi notifikasi tidak bisa dipalsukan.
  static Future<void> notifyBookingChange(
      String bookingId, String event) async {
    await _notifyWeb(
        '/api/notify-booking-change', {'bookingId': bookingId, 'event': event});
  }

  /// Beri tahu server web (pemegang kunci email) bahwa satu peristiwa perlu
  /// dinotifikasikan ke semua ADMIN: [event] salah satu 'new_booking',
  /// 'new_report', 'new_deposit', 'new_withdrawal' dengan [refId] = id barisnya.
  ///
  /// Server MEMVERIFIKASI bahwa baris itu memang milik pemanggil (RLS lewat
  /// JWT-nya) sebelum mengirim — aplikasi tidak bisa memicu email tentang
  /// pesanan/laporan orang lain. Isi email dibangun server dari database.
  /// Bila antrean `admin_email_outbox` sudah terpasang, baris sudah dimasukkan
  /// trigger DB dan panggilan ini cukup menyapunya (tidak ada email dobel);
  /// bila belum, email dikirim langsung agar notifikasi tetap sampai.
  /// Fire-and-forget: gagal kirim tak pernah mengganggu alur utama aplikasi.
  static Future<void> notifyAdminEvent(String event, String? refId) async {
    if (refId == null || refId.isEmpty) return;
    await _notifyWeb(
        '/api/notify-admin-event', {'event': event, 'refId': refId});
  }

  /// POST JSON ke server web dengan Bearer token sesi. Fire-and-forget —
  /// respons & kegagalan diabaikan supaya notifikasi tak pernah mengganggu
  /// alur utama aplikasi.
  static Future<void> _notifyWeb(String path, Map<String, dynamic> body) async {
    try {
      final token = db.auth.currentSession?.accessToken;
      if (token == null) return;
      await http
          .post(
            Uri.parse('${AppConfig.webBaseUrl}$path'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(body),
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
      db
          .from('service_options')
          .select()
          .eq('is_active', true)
          .order('sort_order'),
    ]);
    final optionRows = (results[1] as List).cast<Map<String, dynamic>>();
    final byService = <String, List<ServiceOption>>{};
    for (final o in optionRows) {
      byService
          .putIfAbsent(o['service_id'] as String, () => [])
          .add(ServiceOption.fromMap(o));
    }
    return (results[0] as List)
        .cast<Map<String, dynamic>>()
        .map((m) => Service.fromMap(m,
            options: byService[m['id'] as String] ?? const []))
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
  ///
  /// [quantity] dan [items] mendukung pesanan multi-varian
  /// (migrate-booking-items.sql); harga tiap baris tetap ditentukan server.
  /// [area] khusus layanan per meter persegi
  /// (migrate-service-area-pricing.sql) — di sana jumlah unit diabaikan dan
  /// luas yang menentukan nominal. [serviceName]/[serviceCategory] hanya
  /// melengkapi hasil RPC, yang tidak membawa join `services` (struk langsung
  /// menampilkan nama & satuan yang benar).
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
    double? lat,
    double? lng,
    int quantity = 1,
    List<({String optionId, int quantity})>? items,
    double? area,
    String? serviceName,
    String? serviceCategory,
  }) async {
    final res = await db.rpc('create_booking_security_definer', params: {
      'p_service_id': serviceId,
      if (optionId != null) 'p_option_id': optionId,
      'p_date': bookingDate,
      'p_time': bookingTime,
      'p_address': address,
      if (notes != null && notes.isNotEmpty) 'p_notes': notes,
      if (attachmentUrl != null) 'p_attachment': attachmentUrl,
      'p_payment': paymentMethod == 'qris' ||
              paymentMethod == 'virtual_account' ||
              paymentMethod == 'e_wallet'
          ? 'transfer'
          : paymentMethod,
      if (voucherId != null) 'p_voucher_id': voucherId,
      // pin lokasi opsional — dikirim hanya bila pasangan lengkap (RPC juga
      // memvalidasi: lat tanpa lng ditolak).
      if (lat != null && lng != null) 'p_lat': lat,
      if (lat != null && lng != null) 'p_lng': lng,
      'p_quantity': quantity,
      // Multi-varian: daftar baris pilihan pelanggan. Server memvalidasi
      // setiap option_id milik layanan ini dan memakai harga katalog.
      if (items != null && items.isNotEmpty)
        'p_items': [
          for (final i in items)
            {'option_id': i.optionId, 'quantity': i.quantity},
        ],
      // Luas (m²) hanya untuk layanan per m²; server MENOLAK p_area pada
      // layanan per unit, jadi null jangan pernah dikirim sebagai 0.
      if (area != null) 'p_area': area,
    });
    final map = res is List
        ? (res.first as Map<String, dynamic>)
        : (res as Map<String, dynamic>);
    if (map['error'] != null) {
      throw Exception(map['error']);
    }
    final booking = Booking.fromMap(
      (map['booking'] as Map).cast<String, dynamic>(),
      // RPC mengembalikan baris rincian terpisah (`items`): label & harga
      // sudah dibekukan server saat pesanan dibuat.
      items: bookingItemsFrom(map['items']),
      fallbackServiceName: serviceName,
      fallbackServiceCategory: serviceCategory,
    );
    // Email ke semua admin: "ada pesanan baru masuk".
    unawaited(notifyAdminEvent('new_booking', booking.id));
    return booking;
  }

  /// Daftar pesanan milik user (join layanan + teknisi), terbaru dulu.
  /// CATATAN: bookings menyimpan varian sebagai teks `option_label`
  /// (bukan FK ke service_options) — join ke service_options akan gagal 400.
  static Future<List<Booking>> fetchMyBookings() async {
    final rows = await db
        .from('bookings')
        .select(
            // booking_items ikut dibaca: pesanan multi-varian / per m² butuh
            // rincian baris di kartu & detail (rincian hanya hidup di tabel
            // itu, bukan kolom bookings).
            '*, services(name), technician:profiles!bookings_technician_id_fkey(name, avatar_url), '
            'booking_items(*)')
        .order('created_at', ascending: false);
    final reviewRows = await _myReviewedBookingIds();
    final reviewed = reviewRows.toSet();
    // Retensi riwayat (supabase/migrate-history-retention.sql): pesanan yang
    // sudah dipurge disembunyikan dari daftar — barisnya tetap ada (audit).
    final visible = rows.where((m) => m['history_purged_at'] == null);
    return visible
        .map<Booking>((m) =>
            Booking.fromMap(m, hasReview: reviewed.contains(m['id'] as String)))
        .toList();
  }

  /// Seperti [fetchMyBookings], tetapi TANPA melempar — sumber kotak masuk
  /// notifikasi pelanggan (kabar pesanan miliknya) yang tidak boleh kosong
  /// hanya karena satu sumber gagal.
  static Future<List<Booking>> fetchMyBookingsSafe() async {
    try {
      return await fetchMyBookings();
    } catch (_) {
      return const <Booking>[];
    }
  }

  /// Satu pesanan berdasarkan id — dipakai notifikasi chat agar bisa langsung
  /// membuka detail tanpa memuat seluruh daftar pesanan. RLS tetap menentukan
  /// boleh-tidaknya baris ini dibaca (pemilik atau teknisi yang ditugaskan).
  static Future<Booking?> fetchBookingById(String bookingId) async {
    final id = bookingId.trim();
    if (id.isEmpty) return null;
    final row = await db
        .from('bookings')
        .select(
            // booking_items ikut dibaca: pesanan multi-varian / per m² butuh
            // rincian baris di kartu & detail (rincian hanya hidup di tabel
            // itu, bukan kolom bookings).
            '*, services(name), technician:profiles!bookings_technician_id_fkey(name, avatar_url), '
            'booking_items(*)')
        .eq('id', id)
        .maybeSingle();
    if (row == null) return null;
    final reviewed = await _myReviewedBookingIds();
    return Booking.fromMap(row, hasReview: reviewed.contains(id));
  }

  static Future<List<String>> _myReviewedBookingIds() async {
    try {
      final rows = await db
          .from('reviews')
          .select('booking_id')
          .eq('user_id', db.auth.currentUser!.id);
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
        error: applied
            ? null
            : 'Metode bayar tidak bisa diubah (pesanan mungkin sudah diproses).',
      );
    } catch (e) {
      return (
        ok: false,
        error: 'Gagal mengubah metode bayar. Periksa koneksi lalu coba lagi.'
      );
    }
  }

  /// Samakan bentuk balikan RPC `returns jsonb` — bisa datang sebagai Map
  /// atau List satu elemen, tergantung bentuk fungsinya.
  static Map<String, dynamic> _asMap(dynamic res) {
    final raw =
        res is List ? (res.isEmpty ? <String, dynamic>{} : res.first) : res;
    return (raw as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
  }

  /// Apakah kegagalan ini karena fungsi di server belum ada (migrasi belum
  /// dijalankan)? Dibedakan agar pesannya tidak menyalahkan koneksi pengguna.
  static bool _fungsiBelumAda(Object e) {
    final s = e.toString();
    return s.contains('Could not find the function') ||
        s.contains('does not exist') ||
        s.contains('schema cache');
  }

  static const _pesanMigrasiBelumJalan =
      'Fitur ini belum aktif di server. Jalankan migrasi terbarunya dulu.';

  /// Pelanggan membatalkan pesanannya sendiri (RPC security definer).
  ///
  /// Aturan ditegakkan SERVER, bukan di sini: hanya pemiliknya, hanya status
  /// pending/paid, dan hanya sebelum jadwalnya mulai.
  ///
  /// Pembatalan SETELAH transfer kini diizinkan: RPC membuat baris
  /// `booking_refunds` 'pending' otomatis (supabase/migrate-booking-refunds.sql),
  /// sehingga uang pelanggan masuk antrean pengembalian yang terlihat admin.
  static Future<({bool ok, String? error})> cancelBooking(
      String bookingId, String reason) async {
    try {
      final res = await db.rpc('cancel_booking', params: {
        'p_booking': bookingId,
        'p_reason': reason,
      });
      final m = _asMap(res);
      if (m['ok'] != true) {
        return (
          ok: false,
          error: (m['error'] as String?) ?? 'Pesanan gagal dibatalkan.'
        );
      }
      // Teknisi yang sudah ditugaskan harus tahu SEBELUM berangkat ke lokasi.
      unawaited(notifyBookingChange(bookingId, 'order_cancelled'));
      return (ok: true, error: null);
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan);
      }
      return (
        ok: false,
        error: 'Gagal membatalkan pesanan. Periksa koneksi lalu coba lagi.'
      );
    }
  }

  /// Pelanggan mengubah jadwal pesanannya sendiri (RPC security definer).
  /// Dibatasi 3 kali per pesanan — server yang menghitung.
  static Future<({bool ok, String? error})> rescheduleBooking(
      String bookingId, String bookingDate, String bookingTime) async {
    try {
      final res = await db.rpc('reschedule_booking', params: {
        'p_booking': bookingId,
        'p_date': bookingDate,
        'p_time': bookingTime,
      });
      final m = _asMap(res);
      if (m['ok'] != true) {
        return (
          ok: false,
          error: (m['error'] as String?) ?? 'Jadwal gagal diubah.'
        );
      }
      // Teknisi bisa saja sudah menyusun rute harinya — beri tahu perubahan ini.
      unawaited(notifyBookingChange(bookingId, 'order_rescheduled'));
      return (ok: true, error: null);
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan);
      }
      return (
        ok: false,
        error: 'Gagal mengubah jadwal. Periksa koneksi lalu coba lagi.'
      );
    }
  }

  /// Posisi teknisi yang sedang MENUJU LOKASI untuk pesanan ini — hasil RPC
  /// `booking_technician_position` (supabase/migrate-technician-trip-share.sql).
  ///
  /// Berbeda dari [bookingTechnicianInfo] (yang sengaja hanya memberi jarak),
  /// RPC ini mengembalikan koordinat — tetapi server menutupnya dengan empat
  /// syarat: pesanan ini milik pemanggil, teknisi sudah ditugaskan, pesanan
  /// masih aktif, DAN teknisi sudah menekan "Berangkat" dengan posisi yang
  /// belum basi. Kegagalan apa pun (jaringan, migrasi belum jalan) jatuh ke
  /// [BookingTechPosition.kosong] → kartu peta tidak ditampilkan.
  static Future<BookingTechPosition> bookingTechnicianPosition(
      String bookingId) async {
    try {
      final res = await db
          .rpc('booking_technician_position', params: {'p_booking': bookingId});
      return BookingTechPosition.fromRpc(_asMap(res));
    } catch (_) {
      return BookingTechPosition.kosong;
    }
  }

  /// Teknisi MULAI membagikan posisinya untuk pesanan ini (tombol "Berangkat").
  /// Server membatasi: hanya teknisi yang ditugaskan, hanya pesanan aktif, dan
  /// hanya selama 90 menit. Sekali tekan, pelanggan pemilik pesanan mulai bisa
  /// melihat posisinya — jadi jangan panggil ini tanpa aksi sadar dari teknisi.
  static Future<({bool ok, String? error, DateTime? expiresAt})> startTripShare(
      String bookingId) async {
    try {
      final m = _asMap(await db.rpc('start_trip_share', params: {
        'p_booking': bookingId,
      }));
      if (m['ok'] != true) {
        return (
          ok: false,
          error: (m['error'] as String?) ?? 'Gagal memulai berbagi lokasi.',
          expiresAt: null,
        );
      }
      final exp = m['expires_at'] as String?;
      return (
        ok: true,
        error: null,
        expiresAt: exp == null ? null : DateTime.tryParse(exp)?.toLocal(),
      );
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan, expiresAt: null);
      }
      return (
        ok: false,
        error: 'Gagal memulai berbagi lokasi. Periksa koneksi lalu coba lagi.',
        expiresAt: null,
      );
    }
  }

  /// Kirim posisi terkini selama perjalanan.
  ///
  /// Jawabannya membawa tiga hal yang menentukan perilaku aplikasi, bukan
  /// sekadar "berhasil":
  ///   * [arrived] — server MENGHENTIKAN perjalanan karena teknisi sudah dalam
  ///     150 m dari titik pesanan. Klien harus berhenti mengirim, dan tidak
  ///     perlu menekan "Saya sudah tiba".
  ///   * [near] — ≤ 1 km: saatnya memberi tahu pelanggan "hampir tiba".
  ///   * [distanceM] — berapa meter lagi, untuk ditampilkan ke teknisi.
  /// Gagal (`ok == false`) berarti perjalanannya sudah tidak aktif — pemanggil
  /// harus berhenti, bukan mengulangi tanpa henti.
  static Future<
          ({bool ok, String? error, bool arrived, bool near, int? distanceM})>
      pushTripPosition(String bookingId, double lat, double lng) async {
    try {
      final m = _asMap(await db.rpc('push_trip_position', params: {
        'p_booking': bookingId,
        'p_lat': lat,
        'p_lng': lng,
      }));
      return (
        ok: m['ok'] == true,
        error: m['ok'] == true ? null : (m['error'] as String?),
        arrived: m['arrived'] == true,
        near: m['near'] == true,
        distanceM: (m['distance_m'] as num?)?.toInt(),
      );
    } catch (e) {
      return (
        ok: false,
        error: _fungsiBelumAda(e)
            ? _pesanMigrasiBelumJalan
            : 'Gagal mengirim posisi. Periksa koneksi lalu coba lagi.',
        arrived: false,
        near: false,
        distanceM: null,
      );
    }
  }

  /// Beri tahu PELANGGAN bahwa teknisi hampir tiba (≤1 km).
  ///
  /// Diverifikasi ulang server: hanya teknisi yang ditugaskan, dan hanya bila
  /// jarak nyatanya memang dekat — notifikasi ini tidak bisa dikarang klien.
  /// Fire-and-forget: gagal kirim tidak pernah mengganggu perjalanan.
  static Future<void> notifyTechnicianNear(String bookingId) async {
    await _notifyWeb('/api/notify-technician-near', {'bookingId': bookingId});
  }

  /// Teknisi berhenti membagikan posisinya (tombol "Saya sudah tiba"). Barisnya
  /// DIHAPUS server — bukan ditandai berhenti — sehingga tidak ada riwayat.
  static Future<({bool ok, String? error})> endTripShare(
      String bookingId) async {
    return _rpcAksi(
      'end_trip_share',
      {'p_booking': bookingId},
      gagal: 'Gagal menghentikan berbagi lokasi.',
    );
  }

  /// Pemanggil seragam untuk RPC aksi ber-return `{ok, error}`: memetakan
  /// "fungsi belum ada" (migrasi belum dijalankan) ke pesan yang bisa
  /// ditindaklanjuti, bukan kegagalan jaringan yang membingungkan.
  static Future<({bool ok, String? error})> _rpcAksi(
    String fn,
    Map<String, dynamic> params, {
    required String gagal,
  }) async {
    try {
      final m = _asMap(await db.rpc(fn, params: params));
      if (m['ok'] != true) {
        return (ok: false, error: (m['error'] as String?) ?? gagal);
      }
      return (ok: true, error: null);
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan);
      }
      return (ok: false, error: '$gagal Periksa koneksi lalu coba lagi.');
    }
  }

  /// Kontak + jarak teknisi untuk pesanan ini.
  ///
  /// Koordinat teknisi tidak pernah dikirim server (aturan privasi di
  /// supabase/migrate-technician-gps.sql) — yang diterima hanya jarak & umur
  /// posisinya. Gagal/belum ada migrasi → [BookingTechInfo.kosong], sehingga
  /// layar detail tetap tampil tanpa kartu teknisi.
  static Future<BookingTechInfo> bookingTechnicianInfo(String bookingId) async {
    try {
      final res = await db
          .rpc('booking_technician_info', params: {'p_booking': bookingId});
      final m = _asMap(res);
      if (m['ok'] != true) return BookingTechInfo.kosong;
      return BookingTechInfo.fromRpc(m);
    } catch (_) {
      return BookingTechInfo.kosong;
    }
  }

  /// Masa garansi + status klaim untuk satu pesanan.
  /// Pesanan tanpa garansi/klaim mengembalikan objek kosong (kartu disembunyikan).
  static Future<BookingWarrantyInfo> bookingWarrantyInfo(
      String bookingId) async {
    try {
      final res = await db
          .rpc('booking_warranty_info', params: {'p_booking': bookingId});
      final m = _asMap(res);
      if (m['ok'] != true) return const BookingWarrantyInfo();
      return BookingWarrantyInfo.fromRpc(m);
    } catch (_) {
      return const BookingWarrantyInfo();
    }
  }

  /// Status pengembalian dana pesanan ini (RPC booking_refund_info).
  ///
  /// Fail-soft: migrasi yang belum dijalankan / pesanan tanpa refund sama-sama
  /// menghasilkan [BookingRefund.kosong] — kartunya hanya tidak tampil, bukan
  /// membuat layar detail pesanan error.
  static Future<BookingRefund> bookingRefundInfo(String bookingId) async {
    try {
      final res = await db
          .rpc('booking_refund_info', params: {'p_booking': bookingId});
      final m = _asMap(res);
      if (m['ok'] != true) return BookingRefund.kosong;
      return BookingRefund.fromRpc(m, bookingId: bookingId);
    } catch (_) {
      return BookingRefund.kosong;
    }
  }

  /// Semua pengembalian dana milik pelanggan ini, terbaru dulu — sumber kabar
  /// di kotak masuk.
  ///
  /// Dibaca langsung dari `booking_refunds` (policy "user can view own booking
  /// refunds" membatasinya ke pesanan milik sendiri). Join `bookings` hanya
  /// untuk kode & nama layanan; bila PostgREST menolak bentuk join-nya, seluruh
  /// pembacaan TIDAK digagalkan — kotak masuk memakai data pesanan yang sudah
  /// dimuat sebagai cadangan.
  static Future<List<BookingRefund>> fetchMyRefunds() async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) return const <BookingRefund>[];
    const kolomDasar =
        'id, booking_id, amount, status, reason, note, rejection_reason, '
        'proof_url, payment_confirmed, created_at, decided_at';

    List<BookingRefund> baca(Iterable<dynamic> rows) => [
          for (final r in rows)
            BookingRefund.fromRow((r as Map).cast<String, dynamic>()),
        ];

    try {
      final rows = await db
          .from('booking_refunds')
          .select('$kolomDasar, booking:bookings(code, services(name))')
          .eq('user_id', uid)
          .order('created_at', ascending: false)
          .limit(100);
      return baca(rows);
    } catch (_) {
      // Bentuk join di atas bisa DITOLAK PostgREST (mis. relasi belum dikenal
      // skema cache). Kode & nama layanan hanya pemanis — kabar refund tidak
      // boleh hilang total karena itu, jadi baca ulang tanpa join dan biarkan
      // kotak masuk memakai data pesanan yang sudah dimuat.
      final rows = await db
          .from('booking_refunds')
          .select(kolomDasar)
          .eq('user_id', uid)
          .order('created_at', ascending: false)
          .limit(100);
      return baca(rows);
    }
  }

  /// [fetchMyRefunds] yang tidak pernah melempar: tabel belum dimigrasikan,
  /// offline, atau join gagal = tidak ada kabar refund, bukan layar error.
  static Future<List<BookingRefund>> fetchMyRefundsSafe() async {
    try {
      return await fetchMyRefunds();
    } catch (_) {
      return const <BookingRefund>[];
    }
  }

  /// Signed URL bukti transfer balik (bucket privat `refund-proofs`).
  /// Hanya admin dan pemilik pesanan yang diizinkan RLS Storage; pihak lain
  /// mendapat null alih-alih tautan yang tidak bisa dibuka.
  static Future<String?> refundProofUrl(String path) async {
    final p = path.trim();
    if (p.isEmpty) return null;
    try {
      return await db.storage.from('refund-proofs').createSignedUrl(p, 3600);
    } catch (_) {
      return null;
    }
  }

  /// Ajukan klaim garansi untuk pesanan yang sudah selesai dan masih bergaransi.
  static Future<({bool ok, String? error})> createWarrantyClaim(
      String bookingId, String reason) async {
    try {
      final res = await db.rpc('create_warranty_claim', params: {
        'p_booking': bookingId,
        'p_reason': reason,
      });
      final m = _asMap(res);
      if (m['ok'] != true) {
        return (
          ok: false,
          error: (m['error'] as String?) ?? 'Klaim garansi gagal diajukan.'
        );
      }
      return (ok: true, error: null);
    } catch (e) {
      if (_fungsiBelumAda(e)) {
        return (ok: false, error: _pesanMigrasiBelumJalan);
      }
      return (
        ok: false,
        error: 'Gagal mengajukan klaim garansi. Periksa koneksi lalu coba lagi.'
      );
    }
  }

  static Future<String> createSignedUrl(String bucket, String path,
      {int seconds = 3600}) async {
    final res = await db.storage.from(bucket).createSignedUrl(path, seconds);
    return res;
  }

  // ============ review ============

  /// Simpan/ubah penilaian untuk pesanan selesai. Satu review per booking
  /// (unique) — kalau sudah ada, update.
  ///
  /// Kalau reviews/upsert mengembalikan 0 baris (UPDATE ditolak RLS = sukses
  /// buta, pola sama dgn paymentProof), lempar error jelas: policy update
  /// belum terpasang → jalankan fix-reviews-policies.sql.
  ///
  /// Sertakan kolom `comment` eksplisit (jangan dilepas) supaya upsert
  /// menimpa ulasan lama dengan null saat dikosongkan — baris UPDATE tetap
  /// berisi kolom penuh, konsisten dgn submit web.
  static Future<({bool ok, String? error, Map<String, dynamic>? voucher})>
      submitReview({
    required String bookingId,
    required String technicianId,
    required int rating,
    String? comment,
  }) async {
    final uid = db.auth.currentUser!.id;

    // Apakah ini penilaian BARU? Hanya penilaian baru yang berhak voucher —
    // memperbarui penilaian lama tidak menerbitkan voucher lagi (paritas web).
    final prev = await db
        .from('reviews')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle();
    final isNewReview = prev == null;

    final row = await db
        .from('reviews')
        .upsert({
          'booking_id': bookingId,
          'user_id': uid,
          'technician_id': technicianId,
          'rating': rating,
          'comment': normalizeReviewComment(comment),
        }, onConflict: 'booking_id')
        .select('id')
        .single();
    if (row['id'] == null) {
      return (
        ok: false,
        error: 'Penilaian tidak tersimpan (RLS menolak). '
            'Jalankan supabase/fix-reviews-policies.sql di Supabase SQL Editor.',
        voucher: null,
      );
    }

    // ---- Insentif (paritas web): penilaian BARU → voucher TERIMAKASIH
    // Rp 2.000 berlaku 90 hari, terbit SEGERA (reviewIncentiveDays = 0).
    // Nilai & aturan wajib sama dgn grantReviewVoucher
    // (src/app/actions/reviews.js) + REVIEW_INCENTIVE_* (src/lib/pricing.js);
    // anti-dobel lintas platform ditopang unique partial index
    // vouchers_review_incentive_booking_uidx (fix-review-voucher-idempotent.sql)
    // + pre-check existing di bawah.
    Map<String, dynamic>? voucher;
    var voucherBaru = false;
    try {
      const reviewIncentiveDays = 0;
      const reviewIncentiveAmount = 2000;
      const voucherValidityDays = 90;

      // completed_at bisa belum ada di DB lama → nullable; dianggap 0 hari
      // (voucher tetap terbit karena syaratnya "sudah lewat >= 0 hari").
      final bk = await db
          .from('bookings')
          .select('completed_at')
          .eq('id', bookingId)
          .maybeSingle();
      final completedAt = bk?['completed_at'] as String?;
      final days = completedAt == null
          ? 0.0
          : DateTime.now()
                  .difference(DateTime.parse(completedAt))
                  .inMicroseconds /
              Duration.microsecondsPerDay;
      if (isNewReview && days >= reviewIncentiveDays) {
        // Pre-check anti-dobel (jalur lambat); race window sempit ditutup
        // oleh unique index di DB — insert kedua gagal dan ditangkap catch.
        final existing = await db
            .from('vouchers')
            .select('code, amount')
            .eq('source', 'review_incentive')
            .eq('booking_id', bookingId)
            .maybeSingle();
        if (existing != null) {
          voucher = Map<String, dynamic>.from(existing as Map);
        } else {
          final rand = DateTime.now()
              .microsecondsSinceEpoch
              .toRadixString(36)
              .toUpperCase();
          final code =
              'TERIMAKASIH-$rand${(DateTime.now().hashCode & 0xFFFFF).toRadixString(36).toUpperCase()}';
          final v = await db
              .from('vouchers')
              .insert({
                'user_id': uid,
                'code': code,
                'amount': reviewIncentiveAmount,
                'source': 'review_incentive',
                'booking_id': bookingId,
                'expires_at': DateTime.now()
                    .add(const Duration(days: voucherValidityDays))
                    .toIso8601String(),
              })
              .select('code, amount')
              .single();
          voucher = Map<String, dynamic>.from(v as Map);
          voucherBaru = true;
        }
      }
    } catch (_) {
      // kolom/voucher belum tersedia di DB → insentif dilewati, review tetap valid
    }

    // Trigger DB voucher menulis ke push_outbox. Sapu antrean sekarang agar
    // notifikasi "voucher baru" tidak menunggu jadwal cron; tetap best-effort.
    if (voucherBaru) unawaited(kickPushWorker());

    return (ok: true, error: null, voucher: voucher);
  }

  // ============ laporan ============

  /// Riwayat laporan yang ditulis pengguna ini (tab Laporan).
  /// Laporan yang menargetkan dirinya (mis. keluhan atas pekerjaannya) TIDAK
  /// ikut di sini — layar ini memang menampilkan tulisan sendiri saja, dan
  /// badge tab Laporan dihitung dari daftar yang sama.
  static Future<List<Report>> fetchMyReports() async {
    final uid = db.auth.currentUser!.id;
    final rows = await db
        .from('reports')
        .select('*, bookings(code)')
        .eq('author_id', uid)
        .order('created_at', ascending: false);
    return rows.map<Report>((m) => Report.fromMap(m)).toList();
  }

  /// Seperti [fetchMyReports], tetapi TANPA melempar — sumber kotak masuk.
  static Future<List<Report>> fetchMyReportsSafe() async {
    try {
      return await fetchMyReports();
    } catch (_) {
      return const <Report>[];
    }
  }

  /// Laporan. Untuk teknisi: [bookingId] wajib dan harus pekerjaan yang
  /// ditugaskan ke dia (paritas server-action web yang memvalidasi teknisi),
  /// author_role otomatis 'technician'; selain itu 'customer'.
  static Future<void> createReport({
    required String title,
    required String content,
    String? bookingId,
    String? attachmentPath,
  }) async {
    final uid = db.auth.currentUser!.id;
    String authorRole = 'customer';
    if (bookingId != null && bookingId.isNotEmpty) {
      // pastikan booking ini benar-benar tugasan teknisi yang login;
      // bukan → tetap dikirim sebagai laporan pelanggan biasa.
      final own = await db
          .from('bookings')
          .select('id')
          .eq('id', bookingId)
          .eq('technician_id', uid)
          .maybeSingle();
      if (own != null) authorRole = 'technician';
    }
    // `.select('id')` (tanpa `.single()`) supaya INSERT tetap gagal keras bila
    // ditolak, tapi id-nya bisa dibawa ke notifikasi admin. Bila baris tak
    // terbaca-balik (policy select belum ada), notifikasi saja yang dilewati.
    final inserted = await db.from('reports').insert({
      'author_id': uid,
      'author_role': authorRole,
      'title': title,
      'content': content,
      if (bookingId != null && bookingId.isNotEmpty) 'booking_id': bookingId,
      if (attachmentPath != null) 'attachment_url': attachmentPath,
    }).select('id');
    // Email ke semua admin: ada laporan baru (server verifikasi kepemilikan).
    if (inserted.isNotEmpty) {
      unawaited(
          notifyAdminEvent('new_report', inserted.first['id'] as String?));
    }
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
  static Future<
      ({
        TechnicianBalanceSummary summary,
        List<BalanceTransaction> transactions
      })> fetchMyBalancePage() async {
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
  /// Definisi (model TOP-UP, aturan potongan = komisi + biaya aplikasi):
  /// * Pendapatan = nilai pekerjaan selesai (total harga dari booking tiap
  ///   earning, BUKAN 2× komisi — bug lama yang sudah dikoreksi).
  /// * Komisi = Σ commission_amount baris earning (persen sesuai rate
  ///   admin); fallback Σ |amount| bila kolom kosong (row lama).
  /// * Biaya app = Σ (|amount| − commission_amount) tiap earning ber-amount
  ///   negatif — diturunkan dari POTONGAN RIIL, bukan fee booking penuh,
  ///   agar tetap cocok saat potongan dibatasi saldo (kebijakan saldo ≥ 0).
  /// * expectedBalance = setoran − komisi − biaya app − penarikan + refund
  ///   + penyesuaian; kalau ≠ profiles.balance ada anomali — termasuk state
  ///   SEBELUM migrate-earning-fee.sql dijalankan (fee belum dipotong DB →
  ///   selisih = total biaya app).
  ///
  /// `adjustment` WAJIB ikut: koreksi saldo admin dan penghapusan piutang
  /// menulis baris itu, dan mengabaikannya membuat koreksi yang benar terbaca
  /// sebagai selisih palsu di layar teknisi.
  static TechnicianBalanceSummary summarizeBalance(
      Profile? p, List<BalanceTransaction> tx) {
    var earned = 0;
    var commission = 0;
    var appFee = 0;
    var topup = 0;
    var withdrawal = 0;
    var refund = 0;
    // Baris `adjustment` = perubahan saldo TANPA uang masuk/keluar: koreksi
    // admin (bisa negatif, migrate-admin-balance-adjustment.sql) dan
    // penghapusan piutang (positif, migrate-piutang-writeoff.sql). Sebelumnya
    // baris ini DIABAIKAN, sehingga setiap koreksi yang sah membuat layar Saldo
    // menampilkan "Ada selisih …" padahal saldo dan buku besar sudah sama.
    var adjustment = 0;
    for (final t in tx) {
      switch (t.type) {
        case 'earning':
          // Nilai pekerjaan (kotor) — fee tak lagi dikurangi di sini
          // karena fee kini item potongan tersendiri dari saldo.
          final total = t.bookingTotalPrice;
          if (total != null && total > 0) earned += total;
          if (t.amount < 0) {
            // Potongan riil baris ini (amount DB negatif = saldo berkurang),
            // sudah dibatasi saldo tersedia di server (saldo tak boleh negatif).
            final cut = (-t.amount).round();
            // Komisi murni dari kolom; fallback |amount| untuk row lama yang
            // kolomnya kosong.
            final comm = (t.commissionAmount ?? cut).round();
            commission += comm;
            // Biaya app = SISA potongan setelah komisi — diturunkan dari
            // amount, bukan bookings.app_fee, supaya cocok dengan yang benar
            // benar dipotong (potongan bisa < komisi+fee penuh saat saldo
            // kurang; sisa itu tidak lagi menjadi utang teknisi).
            final fee = cut - comm;
            if (fee > 0) appFee += fee;
          }
        case 'topup':
          topup += t.amount.round();
        case 'withdrawal':
          // DB menyimpan amount penarikan NEGATIF (debit saldo) —
          // ambil mutlaknya agar total "Ditarik" positif dan rumus
          // expected tidak dobel tanda (akar selisih 300rb yang lama).
          withdrawal += (-t.amount).round();
        case 'refund':
          refund += t.amount.round();
        case 'adjustment':
          // Bertanda seperti di DB: koreksi turun mengurangi saldo, penghapusan
          // piutang menambah. Dijumlahkan apa adanya agar expectedBalance = Σ mutasi.
          adjustment += t.amount.round();
      }
    }
    final expected = topup - commission - appFee - withdrawal + refund + adjustment;
    return TechnicianBalanceSummary(
      balance: p?.balance ?? 0,
      earnedTotal: earned,
      commissionTotal: commission,
      appFeeTotal: appFee,
      topupTotal: topup,
      withdrawalTotal: withdrawal,
      refundTotal: refund,
      expectedBalance: expected,
      balanceReminderAt: p?.balanceReminderAt,
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

  /// Teknisi mengajukan SETOR saldo (model top-up) dari aplikasi:
  /// unggah foto bukti transfer ke bucket privat `balance-proofs` (folder
  /// `deposit/`) lalu catat baris `balance_deposits` berstatus 'pending'
  /// (RLS `bd_insert_own`: technician_id = auth.uid(), status pending).
  ///
  /// Saldo TIDAK diubah di sini — admin menambah saldo setelah memverifikasi
  /// bukti (sama seperti alur web `submitBalanceDeposit`). Kembalikan path bukti.
  static Future<String> submitBalanceDeposit({
    required int amount,
    required Uint8List bytes,
  }) async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) throw Exception('Belum login.');
    if (amount <= 0) throw Exception('Isi jumlah setor yang valid.');

    final path = await uploadToBucket(
      bucket: 'balance-proofs',
      folder: 'deposit',
      bytes: bytes,
      extension: 'jpg',
    );

    final inserted = await db.from('balance_deposits').insert({
      'technician_id': uid,
      'amount': amount,
      'claimed_amount': amount,
      'proof_url':
          path, // simpan PATH (bucket privat); admin lihat via signed URL
      'status': 'pending',
    }).select('id');
    // Email ke semua admin: teknisi mengajukan setor saldo (server verifikasi
    // bahwa baris ini memang milik teknisi yang memanggil).
    if (inserted.isNotEmpty) {
      unawaited(
          notifyAdminEvent('new_deposit', inserted.first['id'] as String?));
    }
    return path;
  }

  /// Teknisi mengajukan TARIK saldo ke rekening pribadi — paritas alur web
  /// (`requestWithdrawal` di src/app/actions/technician.js):
  ///
  ///   1. Saldo DITAHAN saat pengajuan: mutasi `withdrawal` (amount negatif)
  ///      dicatat dan `profiles.balance` langsung dikurangi supaya dana yang
  ///      sama tidak bisa dipakai dua kali (mis. untuk mengambil pekerjaan).
  ///   2. Baris `balance_withdrawals` 'pending' menunggu keputusan admin.
  ///      Ditolak → saldo kembali penuh (mutasi `refund`); disetujui → admin
  ///      mentransfer manual, saldo tidak berubah lagi.
  ///
  /// Aturan yang sama dengan server web: hanya teknisi/admin, jumlah ≤ saldo
  /// aktif, dan hanya SATU pengajuan pending dalam satu waktu. Galat dilempar
  /// dengan pesan siap tampil ke pengguna.
  static Future<void> requestWithdrawal({
    required int amount,
    required String bankName,
    required String accountNumber,
    required String accountHolder,
  }) async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) throw Exception('Belum login.');
    if (amount <= 0) throw Exception('Isi jumlah penarikan yang valid.');

    final bank = bankName.trim();
    final accNo = accountNumber.trim();
    final holder = accountHolder.trim();
    if (bank.isEmpty) throw Exception('Isi nama bank / e-wallet tujuan.');
    if (accNo.length < 6) {
      throw Exception('Isi nomor rekening yang valid (min. 6 karakter).');
    }
    if (holder.isEmpty) throw Exception('Isi nama pemilik rekening.');

    final profile = await db
        .from('profiles')
        .select('role, balance')
        .eq('id', uid)
        .maybeSingle();
    final role = profile?['role'] as String?;
    if (role != 'technician' && role != 'admin') {
      throw Exception('Hanya teknisi yang bisa menarik saldo.');
    }
    final saldo = (profile?['balance'] as num?)?.toDouble() ?? 0;
    if (saldo < amount) {
      throw Exception(
          'Saldo tidak cukup. Saldo aktifmu ${formatRupiah(saldo.round())}.');
    }

    // Satu kanal penarikan: pengajuan pending lain harus diputuskan admin dulu.
    final pending = await db
        .from('balance_withdrawals')
        .select('id')
        .eq('technician_id', uid)
        .eq('status', 'pending')
        .maybeSingle();
    if (pending != null) {
      throw Exception(
          'Kamu masih punya pengajuan penarikan yang menunggu verifikasi admin.');
    }

    // 1. Tahan saldo lewat mutasi (RLS `bt_insert_own_withdrawal` hanya
    //    mengizinkan type 'withdrawal' milik sendiri).
    final String txId;
    try {
      final tx = await db
          .from('balance_transactions')
          .insert({
            'technician_id': uid,
            'type': 'withdrawal',
            'amount': -amount,
            'note': 'Pengajuan tarik ke $bank ${accNo.substring(0, 4)}••••',
          })
          .select('id')
          .single();
      txId = tx['id'] as String;
    } catch (e) {
      final msg = e.toString();
      if (msg.contains('42501') || msg.contains('row-level security')) {
        throw Exception(
            'Izin mencatat penarikan ditolak database — minta admin menjalankan '
            'supabase/fix-balance-admin-policies.sql.');
      }
      if (msg.contains('relation') || msg.contains('does not exist')) {
        throw Exception(
            'Fitur penarikan belum aktif di database — minta admin menjalankan '
            'supabase/migrate-technician-withdrawals.sql.');
      }
      rethrow;
    }

    // 2. Catat pengajuan yang harus diproses admin.
    final String wdId;
    try {
      final wd = await db
          .from('balance_withdrawals')
          .insert({
            'technician_id': uid,
            'amount': amount,
            'bank_name': bank,
            'account_number': accNo,
            'account_holder': holder,
            'status': 'pending',
            'transaction_id': txId,
          })
          .select('id')
          .single();
      wdId = wd['id'] as String;
    } catch (e) {
      // Saldo sudah tertahan oleh mutasi di atas sedangkan pengajuannya gagal
      // tercatat. Teknisi tidak boleh dibiarkan mengira dananya hilang, jadi
      // pesannya menyebut penanda transaksi untuk dicek admin.
      throw Exception(
          'Pengajuan gagal dicatat, tetapi saldo ${formatRupiah(amount)} sudah '
          'tertahan (transaksi ${txId.substring(0, 8)}). Hubungi admin untuk '
          'mengembalikannya. ${e.toString().replaceFirst('Exception: ', '')}');
    }

    // 3. Kurangi saldo profil — langkah terakhir, sama seperti alur web.
    await db.from('profiles').update({'balance': saldo - amount}).eq('id', uid);

    // Email ke admin (server memverifikasi baris ini milik pemanggil).
    unawaited(notifyAdminEvent('new_withdrawal', wdId));
  }

  /// Seperti [fetchAssignedJobs], tetapi TANPA melempar — dipakai kotak masuk
  /// notifikasi yang tidak boleh kosong hanya karena satu sumber gagal.
  static Future<List<Booking>> fetchAssignedJobsSafe() async {
    try {
      return await fetchAssignedJobs();
    } catch (_) {
      return const <Booking>[];
    }
  }

  /// ID pesanan yang komisinya SUDAH dipotong dari saldo teknisi ini.
  ///
  /// Dipakai kotak masuk teknisi: saat pesanan yang sudah ditugaskan
  /// dibatalkan, teknisi perlu tahu apakah pembatalan itu menyentuh saldonya
  /// (komisi sudah terpotong dan TIDAK dikembalikan otomatis) atau belum
  /// (komisi baru dipotong setelah pekerjaan selesai).
  ///
  /// Policy `bt_select_own` membatasi baris ke milik teknisi ini; admin yang
  /// memakai aplikasi pelanggan hanya melihat barisnya sendiri (tidak ada).
  static Future<Set<String>> fetchMyCommissionedBookingIds() async {
    final uid = db.auth.currentUser?.id;
    if (uid == null) return const <String>{};
    final rows = await db
        .from('balance_transactions')
        .select('booking_id')
        .eq('technician_id', uid)
        .eq('type', 'earning')
        .order('created_at', ascending: false)
        .limit(1000);
    return {
      for (final r in rows)
        if (r['booking_id'] is String) r['booking_id'] as String,
    };
  }

  /// [fetchMyCommissionedBookingIds] yang tidak pernah melempar — mengembalikan
  /// `null` bila datanya TIDAK diketahui (tabel saldo belum dimigrasikan /
  /// offline). Bedanya penting: himpunan kosong berarti "komisi belum pernah
  /// dipotong", sedangkan null tidak boleh diklaim begitu.
  static Future<Set<String>?> fetchMyCommissionedBookingIdsSafe() async {
    try {
      return await fetchMyCommissionedBookingIds();
    } catch (_) {
      return null;
    }
  }

  /// Riwayat mutasi saldo (100 terbaru, terbaru dulu).
  /// join bookings supaya transaksi komisi menampilkan kode pesanan,
  /// nilai pekerjaan, dan biaya aplikasi yang ikut dipotong dari saldo.
  static Future<List<BalanceTransaction>> fetchMyBalanceTransactions(
      {int limit = 100}) async {
    final rows = await db
        .from('balance_transactions')
        .select(
            'id, type, amount, commission_amount, note, created_at, bookings(code, total_price, app_fee)')
        .order('created_at', ascending: false)
        .limit(limit);
    return rows
        .map<BalanceTransaction>((m) => BalanceTransaction.fromMap(m))
        .toList();
  }

  /// Riwayat pengajuan SETOR + TARIK milik teknisi yang login, terbaru dulu.
  ///
  /// Ini satu-satunya cara teknisi tahu nasib uangnya: aplikasi hanya bisa
  /// MENGIRIM pengajuan, jadi tanpa daftar ini status "pending/disetujui/ditolak"
  /// (dan alasan penolakan) hanya hidup di teks push yang mudah hilang.
  ///
  /// Kedua tabel dibaca terpisah supaya migrasi yang baru separuh jalan (mis.
  /// `migrate-technician-withdrawals.sql` belum dijalankan) tidak
  /// menyembunyikan riwayat setor yang sudah ada. Keduanya tidak ada → galat
  /// asli dilempar agar layar menampilkan ajakan migrasi, bukan "belum ada
  /// pengajuan" yang menyesatkan.
  static Future<List<BalanceRequest>> fetchMyBalanceRequests(
      {int limit = 30}) async {
    final SupabaseClient client;
    try {
      client = db;
    } catch (_) {
      // Supabase belum diinisialisasi (mis. widget test tanpa backend).
      return const <BalanceRequest>[];
    }
    final uid = client.auth.currentUser?.id;
    if (uid == null) return const <BalanceRequest>[];

    final gagal = <Object>[];

    Future<List<Map<String, dynamic>>> ambil(String tabel, String kolom) async {
      try {
        return await client
            .from(tabel)
            .select(kolom)
            .eq('technician_id', uid)
            .order('created_at', ascending: false)
            .limit(limit);
      } catch (e) {
        if (!_tabelBelumAda(e)) rethrow;
        gagal.add(e);
        return const <Map<String, dynamic>>[];
      }
    }

    final hasil = await Future.wait([
      ambil(
          'balance_withdrawals',
          'id, amount, status, rejection_reason, bank_name, account_number, '
              'account_holder, reviewed_at, created_at'),
      ambil('balance_deposits',
          'id, amount, status, rejection_reason, reviewed_at, created_at'),
    ]);

    if (gagal.length == 2) throw gagal.first;

    return <BalanceRequest>[
      ...hasil[0].map(BalanceRequest.withdrawal),
      ...hasil[1].map(BalanceRequest.deposit),
    ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  /// Seperti [fetchMyBalanceRequests], tetapi TANPA melempar: migrasi belum
  /// jalan / jaringan bermasalah / sesi belum pulih → daftar kosong. Dipakai
  /// penanda kabar saldo di tab Pekerjaan yang tidak boleh mengganggu daftar
  /// pekerjaan.
  static Future<List<BalanceRequest>> fetchMyBalanceRequestsSafe() async {
    try {
      return await fetchMyBalanceRequests();
    } catch (_) {
      return const <BalanceRequest>[];
    }
  }

  /// Tabel belum ada di database (migrasi belum dijalankan). Dibedakan dari
  /// galat izin/jaringan supaya UI bisa memilih pesan yang tepat.
  static bool _tabelBelumAda(Object e) {
    final s = e.toString();
    return s.contains('Could not find the table') ||
        s.contains('PGRST205') ||
        s.contains('relation') ||
        s.contains('does not exist') ||
        s.contains('schema cache');
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
  /// kualitas mulai [quality]) — pola yang sama dengan web sebelum upload.
  /// Kamera 50 MP (atau mode malam) bisa memaksa hasil >1 MB walau sudah
  /// di-resize, jadi
  /// kualitas diturunkan bertahap (−10) sampai hasil ≤ [maxBytes] (default
  /// 400 KB) atau mentok di [minQuality]; ukuran sepatutnya masih terbaca
  /// admin. Return null kalau pengguna batal atau gambar gagal dikompres.
  /// Avatar memakai maxSide kecil (512) agar upload cepat.
  static Future<Uint8List?> pickAndCompressImage(
      {ImageSource source = ImageSource.gallery,
      int maxSide = 1200,
      int quality = 75,
      int maxBytes = 400 * 1024,
      int minQuality = 40}) async {
    final picked = await ImagePicker()
        .pickImage(source: source, imageQuality: 85, maxWidth: 2000);
    if (picked == null) return null;
    final raw = await picked.readAsBytes();
    Uint8List compressed;
    try {
      compressed = await _compressBytes(raw, maxSide, quality);
    } catch (_) {
      rethrow; // gambar tak bisa dikodekan — biarkan pemanggil tampilkan error
    }
    // Cap ukuran: turunkan kualitas bertahap sampai ≤ cap atau mentok.
    var q = quality;
    while (compressed.length > maxBytes && q > minQuality) {
      q = (q - 10 < minQuality) ? minQuality : q - 10;
      Uint8List attempt;
      try {
        attempt = await _compressBytes(raw, maxSide, q);
      } catch (_) {
        break; // pertahankan iterasi sukses terakhir
      }
      if (attempt.length >= compressed.length) {
        break; // kualitas turun tak mengecilkan → stop
      }
      compressed = attempt;
    }
    return compressed;
  }

  /// Kompres byte gambar ke JPEG (sisi terpanjang ≤ maxSide, kualitas [q]).
  static Future<Uint8List> _compressBytes(
      Uint8List raw, int maxSide, int q) async {
    return FlutterImageCompress.compressWithList(
      raw,
      minWidth: maxSide,
      minHeight: maxSide,
      quality: q,
      format: CompressFormat.jpeg,
    );
  }

  /// URL navigasi Google Maps ke titik (lat,lng) — dibuka url_launcher:
  /// aplikasi Maps di Android / peta di browser, dengan rute belokan.
  static String directionsUrl(double lat, double lng) {
    return 'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving';
  }

  /// URL rute Google Maps ke sebuah tujuan.
  ///
  /// Titik exact (lat/lng) dipakai bila tersedia — paling akurat. Bila
  /// pelanggan TIDAK memasang pin, tujuan diisi alamat lengkap sebagai teks
  /// (Google Maps mencari alamatnya sendiri): teknisi yang sudah menerima
  /// alamat tetap bisa langsung navigasi, tidak lagi bergantung pada pin.
  ///
  /// Mengembalikan null hanya bila tidak ada tujuan sama sekali (tanpa
  /// koordinat DAN tanpa alamat).
  static String? routeUrl({double? lat, double? lng, String? address}) {
    if (lat != null && lng != null) return directionsUrl(lat, lng);
    final q = (address ?? '').trim();
    if (q.isEmpty) return null;
    return 'https://www.google.com/maps/dir/?api=1'
        '&destination=${Uri.encodeComponent(q)}&travelmode=driving';
  }

  /// Upload ke bucket dan kembalikan PATH-nya (bukan publicUrl).
  static Future<String> uploadToBucket({
    required String bucket,
    required String folder,
    required Uint8List bytes,
    String extension = 'jpg',
  }) async {
    final uid = db.auth.currentUser!.id;
    final path =
        '$folder/$uid-${DateTime.now().millisecondsSinceEpoch}.$extension';
    await db.storage.from(bucket).uploadBinary(path, bytes,
        fileOptions:
            const FileOptions(contentType: 'image/jpeg', upsert: false));
    return path;
  }
}
