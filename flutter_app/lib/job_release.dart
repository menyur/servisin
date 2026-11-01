import 'format.dart';

/// Satu jejak **teknisi melepas tugas** (tabel `job_releases`).
///
/// Sebelumnya pelepasan tugas hanya meninggalkan jejak di database: RPC
/// `release_job` mencatat alasan, tetapi aplikasi teknisi tidak punya satu pun
/// layar yang menampilkannya — teknisi hanya melihat snacbar sesaat lalu
/// pekerjaan itu hilang dari daftar. Akibatnya pertanyaan "tugas mana yang tadi
/// saya lepas, dan apa alasannya?" tidak bisa dijawab dari HP.
///
/// Kode pesanan & nama layanan disalin ke baris ini saat pelepasan
/// (`supabase/migrate-job-release-history.sql`), bukan di-join: setelah dilepas,
/// `bookings.technician_id` dikosongkan sehingga RLS tidak lagi memperlihatkan
/// pesanan itu kepada teknisi tersebut.
class JobRelease {
  final String id;
  final String bookingId;

  /// Kode pesanan saat dilepas (mis. `SV-4821`); kosong untuk baris lama yang
  /// dibuat sebelum kolomnya ada dan tidak bisa ditambal.
  final String code;
  final String serviceName;
  final String reason;
  final DateTime? createdAt;

  const JobRelease({
    required this.id,
    required this.bookingId,
    this.code = '',
    this.serviceName = '',
    required this.reason,
    this.createdAt,
  });

  factory JobRelease.fromMap(Map<String, dynamic> m) => JobRelease(
        id: (m['id'] as String?) ?? '',
        bookingId: (m['booking_id'] as String?) ?? '',
        code: ((m['booking_code'] as String?) ?? '').trim(),
        serviceName: ((m['service_name'] as String?) ?? '').trim(),
        reason: ((m['reason'] as String?) ?? '').trim(),
        createdAt: m['created_at'] == null
            ? null
            : DateTime.tryParse(m['created_at'] as String),
      );

  /// Judul baris: kode pesanan bila ada, selain itu nama layanan, dan
  /// akhirnya penanda netral supaya baris lama tidak tampil kosong.
  String get judul {
    final bagian = [
      if (code.isNotEmpty) '#$code',
      if (serviceName.isNotEmpty) serviceName,
    ];
    return bagian.isEmpty ? 'Pekerjaan yang dilepas' : bagian.join(' · ');
  }

  /// Keterangan waktu: "8 Okt 2026 · 14:05", atau string kosong bila stempel
  /// waktunya tidak terbaca (baris rusak) — UI yang memilih tidak menampilkannya.
  String get waktu => createdAt == null ? '' : formatDateTimeId(createdAt!);

  /// Alasan siap tampil. Alasan kosong tidak mungkin terjadi menurut constraint
  /// database (5–500 karakter), tetapi baris lama/rusak tetap tidak boleh
  /// membuat kartu kosong tanpa penjelasan.
  String get alasan =>
      reason.isEmpty ? 'Tanpa alasan tercatat.' : reason;
}
