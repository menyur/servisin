/// Antrean LURING untuk perubahan status pekerjaan teknisi.
///
/// Kenapa ada: di lapangan sinyal sering hilang tepat saat pekerjaan selesai.
/// Dulu `setJobStatus` memanggil RPC dan langsung gagal — pekerjaan tetap
/// "berjalan" di server walau teknisi sudah tuntas, dan pelanggan tidak
/// menerima struk. Sekarang perubahan status (beserta foto bukti) disimpan di
/// HP, lalu dikirim otomatis saat sinyal kembali.
///
/// Aturan penting:
///   * SATU aksi per (pesanan, status). Menekan "Selesai" dua kali tidak
///     mengirim dua kali — id aksinya sama.
///   * Foto diunggah SEBELUM status dikirim, supaya "selesai" tidak pernah
///     tercatat tanpa bukti yang sudah tersimpan.
///   * Server yang sudah lebih dulu punya status itu (mis. aplikasi ditutup
///     setelah RPC sukses tapi sebelum antrean dibersihkan) dianggap selesai:
///     antrean tidak boleh macet selamanya karena pekerjaan yang sudah benar.
///   * Kegagalan jaringan tidak membuang aksi. Hanya kegagalan yang jelas
///     ditolak server (bukan tugasnya, dibatalkan) yang menghentikan aksi itu
///     dan dilaporkan ke layar.
library;

import 'dart:convert';
import 'dart:io';

import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

/// Satu perubahan status yang belum terkirim.
class JobAction {
  /// Identitas unik: `<bookingId>:<status>`.
  final String id;
  final String bookingId;
  final String code;
  final String status; // 'in_progress' | 'completed'

  /// Foto bukti lokal yang belum diunggah (sudah disalin ke folder aplikasi,
  /// jadi tidak hilang walau cache sistem dibersihkan).
  final String? photoPath;
  final String? photoKind; // 'before' | 'after'
  final int attempts;
  final String? lastError;
  final DateTime createdAt;

  const JobAction({
    required this.id,
    required this.bookingId,
    required this.code,
    required this.status,
    this.photoPath,
    this.photoKind,
    this.attempts = 0,
    this.lastError,
    required this.createdAt,
  });

  JobAction copyWith({
    String? photoPath,
    String? photoKind,
    int? attempts,
    String? lastError,
  }) =>
      JobAction(
        id: id,
        bookingId: bookingId,
        code: code,
        status: status,
        photoPath: photoPath ?? this.photoPath,
        photoKind: photoKind ?? this.photoKind,
        attempts: attempts ?? this.attempts,
        lastError: lastError ?? this.lastError,
        createdAt: createdAt,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'booking_id': bookingId,
        'code': code,
        'status': status,
        'photo_path': photoPath,
        'photo_kind': photoKind,
        'attempts': attempts,
        'last_error': lastError,
        'created_at': createdAt.toIso8601String(),
      };

  static JobAction? fromJson(Map<String, dynamic> m) {
    final bookingId = m['booking_id'] as String? ?? '';
    final status = m['status'] as String? ?? '';
    if (bookingId.isEmpty || status.isEmpty) return null;
    return JobAction(
      id: m['id'] as String? ?? '$bookingId:$status',
      bookingId: bookingId,
      code: m['code'] as String? ?? '',
      status: status,
      photoPath: m['photo_path'] as String?,
      photoKind: m['photo_kind'] as String?,
      attempts: (m['attempts'] as num?)?.toInt() ?? 0,
      lastError: m['last_error'] as String?,
      createdAt:
          DateTime.tryParse(m['created_at'] as String? ?? '') ?? DateTime.now(),
    );
  }

  /// Pesan singkat untuk banner layar.
  String get label => status == 'completed'
      ? 'Selesai (#$code) menunggu dikirim'
      : 'Mulai kerja (#$code) menunggu dikirim';
}

/// Hasil satu kali pengiriman antrean.
class HasilSinkron {
  final int terkirim;
  final int sisa;
  final String? error;

  const HasilSinkron({this.terkirim = 0, this.sisa = 0, this.error});

  bool get adaSisa => sisa > 0;
}

/// Pengirim status (seam uji: default `Api.setJobStatus`).
typedef KirimStatus = Future<({bool ok, String? error})> Function(
    String bookingId, String status);

/// Pengunggah foto (seam uji: default `Api.uploadJobPhotoFile`).
typedef UnggahFoto = Future<({bool ok, String? error})> Function(
    JobAction aksi);

class JobQueue {
  static const String kunci = 'job_queue_v1';

  /// Batas wajar: antrean seharusnya 1–2 baris. Bila sampai puluhan, ada yang
  /// salah dan menyimpan terus hanya menghabiskan baterai/penyimpanan.
  static const int maksAksi = 20;

  static String idUntuk(String bookingId, String status) =>
      '$bookingId:$status';

  static Future<List<JobAction>> semua() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(kunci);
      if (raw == null || raw.isEmpty) return const <JobAction>[];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const <JobAction>[];
      final hasil = <JobAction>[];
      for (final e in decoded) {
        if (e is Map) {
          final a = JobAction.fromJson(e.map((k, v) => MapEntry('$k', v)));
          if (a != null) hasil.add(a);
        }
      }
      return hasil;
    } catch (_) {
      return const <JobAction>[];
    }
  }

  static Future<void> tulis(List<JobAction> daftar) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
          kunci, jsonEncode(daftar.map((a) => a.toJson()).toList()));
    } catch (_) {
      // Penyimpanan gagal bukan alasan menggagalkan aksi pengguna; aksi itu
      // tetap dicoba segera dan pelanggan melihat pesan error dari server.
    }
  }

  /// Tambah (atau perbarui) satu aksi. Idempoten per (pesanan, status).
  static Future<List<JobAction>> tambah({
    required String bookingId,
    required String code,
    required String status,
    String? photoPath,
    String? photoKind,
  }) async {
    final daftar = [...await semua()];
    final id = idUntuk(bookingId, status);
    final lama = daftar.indexWhere((a) => a.id == id);
    if (lama >= 0) {
      daftar[lama] = daftar[lama].copyWith(
        photoPath: photoPath,
        photoKind: photoKind,
      );
    } else {
      daftar.add(JobAction(
        id: id,
        bookingId: bookingId,
        code: code,
        status: status,
        photoPath: photoPath,
        photoKind: photoKind,
        createdAt: DateTime.now(),
      ));
    }
    daftar.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    final dipangkas = daftar.length > maksAksi
        ? daftar.sublist(daftar.length - maksAksi)
        : daftar;
    await tulis(dipangkas);
    return dipangkas;
  }

  /// Hapus satu aksi (dan berkas fotonya bila sudah tidak dipakai).
  static Future<List<JobAction>> hapus(String id) async {
    final daftar = [...await semua()];
    final target = daftar.where((a) => a.id == id).toList();
    daftar.removeWhere((a) => a.id == id);
    await tulis(daftar);
    for (final a in target) {
      await _hapusBerkas(a.photoPath);
    }
    return daftar;
  }

  /// Aksi yang masih menunggu untuk satu pesanan (dipakai layar detail).
  static Future<List<JobAction>> untukBooking(String bookingId) async =>
      (await semua()).where((a) => a.bookingId == bookingId).toList();

  static Future<void> _hapusBerkas(String? path) async {
    if (path == null || path.isEmpty) return;
    try {
      final f = File(path);
      if (await f.exists()) await f.delete();
    } catch (_) {
      // Berkas sudah hilang / tidak bisa dihapus — bukan masalah pengguna.
    }
  }

  /// Kirim semua aksi berurutan. Berhenti pada kegagalan pertama yang bukan
  /// "sudah tidak relevan" supaya tidak menghajar server saat sinyal buruk.
  static Future<HasilSinkron> kirimSemua({
    KirimStatus? kirim,
    UnggahFoto? unggah,
    String? bookingId,
  }) async {
    final semuaAksi = await semua();
    final target = bookingId == null
        ? semuaAksi
        : semuaAksi.where((a) => a.bookingId == bookingId).toList();
    if (target.isEmpty) return const HasilSinkron();

    var terkirim = 0;
    String? errorTerakhir;

    for (final aksi in target) {
      try {
        // 1) Foto dulu: "selesai" tanpa bukti yang tersimpan tidak berguna.
        if (aksi.photoPath != null && aksi.photoKind != null) {
          ({bool ok, String? error}) up;
          if (unggah != null) {
            up = await unggah(aksi);
          } else {
            up = await Api.uploadJobPhotoFile(
              bookingId: aksi.bookingId,
              kind: aksi.photoKind!,
              filePath: aksi.photoPath!,
            );
          }
          if (!up.ok) {
            errorTerakhir = up.error ?? 'Foto bukti gagal diunggah.';
            await _catatGagal(aksi, errorTerakhir);
            break;
          }
        }

        // 2) Status.
        final ({bool ok, String? error}) r;
        if (kirim != null) {
          r = await kirim(aksi.bookingId, aksi.status);
        } else {
          final penuh = await Api.setJobStatus(aksi.bookingId, aksi.status);
          r = (ok: penuh.ok, error: penuh.error);
        }
        if (r.ok) {
          await hapus(aksi.id);
          terkirim += 1;
          continue;
        }

        final pesan = r.error ?? 'Gagal mengubah status.';
        // Sudah lebih dulu tercatat di server (mis. app ditutup setelah RPC
        // sukses) atau pesanan sudah tidak bisa diubah: aksi ini selesai,
        // antrean tidak boleh macet karenanya.
        if (_sudahTidakRelevan(pesan)) {
          await hapus(aksi.id);
          continue;
        }

        // Ditolak karena aturan (bukan tugasnya, saldo, dsb.) → jangan ulang
        // terus; berhenti dan laporkan.
        errorTerakhir = pesan;
        await _catatGagal(aksi, pesan);
        break;
      } catch (e) {
        // Jaringan mati/timeout: simpan, coba lagi nanti.
        errorTerakhir = 'Menunggu sinyal…';
        await _catatGagal(aksi, errorTerakhir);
        break;
      }
    }

    return HasilSinkron(
      terkirim: terkirim,
      sisa: (await semua()).length,
      error: errorTerakhir,
    );
  }

  static bool _sudahTidakRelevan(String pesan) {
    final p = pesan.toLowerCase();
    return p.contains('tidak ditemukan') ||
        p.contains('bukan milik') ||
        p.contains('sudah') ||
        p.contains('dibatalkan') ||
        p.contains('tidak valid');
  }

  static Future<void> _catatGagal(JobAction aksi, String pesan) async {
    final daftar = [...await semua()];
    final i = daftar.indexWhere((a) => a.id == aksi.id);
    if (i < 0) return;
    daftar[i] = daftar[i].copyWith(
      attempts: daftar[i].attempts + 1,
      lastError: pesan,
    );
    await tulis(daftar);
  }
}
