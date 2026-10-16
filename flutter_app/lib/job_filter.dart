import 'models.dart';

/// Hasil penyaringan "Pekerjaan Tersedia" untuk satu teknisi.
///
/// Satu sumber kebenaran untuk DUA pemakai:
///   * layar Pekerjaan (`JobsScreen`) — daftar kartu yang ditampilkan, dan
///   * badge angka di tab Pekerjaan (`availableJobCount`, lihat
///     `ui/common.dart`) — jumlah pekerjaan yang menunggu diambil.
///
/// Karena keduanya memakai fungsi yang sama, angka di badge tidak mungkin
/// berbeda dari jumlah kartu yang benar-benar dilihat teknisi saat tab dibuka.
class FilteredJobs {
  /// Pekerjaan yang ditampilkan (setelah filter area/keahlian, atau SEMUA
  /// pekerjaan bila filter fail-open aktif).
  final List<AvailableJob> shown;

  /// true = penyaringan ketat menghasilkan nol padahal ada pekerjaan →
  /// daftar dibuka lebar supaya pekerjaan tidak tampak "hilang".
  final bool fallbackAktif;

  const FilteredJobs(this.shown, {required this.fallbackAktif});

  /// Jumlah pekerjaan tersedia — nilai yang dipakai badge tab Pekerjaan.
  int get count => shown.length;
}

/// Saring daftar pekerjaan tersedia menurut area layanan & keahlian teknisi.
///
/// Aturan identik dengan yang sudah berlaku di layar Pekerjaan (dan paritas
/// dengan push "pekerjaan baru" di server, `src/lib/skill-match.js`):
///   * [serviceArea] kosong → tanpa filter area; terisi → dicocokkan
///     case-insensitive sebagai substring alamat pesanan;
///   * [skill] kosong → tanpa filter keahlian; terisi → dicocokkan lewat id
///     ATAU nama kategori ([skillMatchesCategory], toleran data warisan);
///   * [showAllAreas]/[showAllSkills] = pilihan manual "Lihat semua" —
///     mematikan filter masing-masing;
///   * FAIL-OPEN: bila filter ketat menghasilkan nol sementara ada pekerjaan,
///     seluruh pekerjaan ditampilkan (server tetap mengirim notifikasi sebagai
///     cadangan; daftar harus punya isi yang sama).
FilteredJobs filterAvailableJobs({
  required List<AvailableJob> jobs,
  String? serviceArea,
  String? skill,
  bool showAllAreas = false,
  bool showAllSkills = false,
}) {
  final area = (serviceArea ?? '').trim().toLowerCase();
  final hasArea = area.isNotEmpty;
  final s = (skill ?? '').trim();
  final hasSkill = s.isNotEmpty;

  final strict = jobs
      .where((j) {
        if (hasArea && !showAllAreas && !j.address.toLowerCase().contains(area)) {
          return false;
        }
        if (hasSkill && !showAllSkills) {
          // Cocokkan lewat id ATAU nama kategori — toleran terhadap nilai
          // skill warisan berupa label ('Service AC'). RPC lama tanpa kolom
          // kategori otomatis fail-open (lihat skillMatchesCategory).
          return skillMatchesCategory(s, j.serviceCategory, j.serviceCategoryName);
        }
        return true;
      })
      .toList(growable: false);

  final fallbackAktif = strict.isEmpty &&
      jobs.isNotEmpty &&
      ((hasArea && !showAllAreas) || (hasSkill && !showAllSkills));

  return FilteredJobs(fallbackAktif ? jobs : strict, fallbackAktif: fallbackAktif);
}
