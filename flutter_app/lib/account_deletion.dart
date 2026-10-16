/// Jalur HAPUS AKUN di aplikasi — model + aturan tampilan.
///
/// Aplikasi Android wajib punya jalur permintaan hapus akun di dalam aplikasi
/// (syarat "Data deletion" Google Play), di samping halaman web /hapus-akun yang
/// bisa dipakai tanpa memasang aplikasi. Berkas ini memegang sisi tampilannya:
/// pembacaan jawaban RPC `my_account_deletion`/`request_account_deletion`
/// (supabase/migrate-account-deletion.sql) dan kalimat yang muncul ke pengguna.
///
/// Sengaja murni (tanpa Supabase/Flutter) supaya bisa diuji di
/// test/account_deletion_test.dart tanpa emulator maupun jaringan.
library;

/// Status permintaan hapus akun milik pengguna saat ini.
class AccountDeletionState {
  /// Kode penolakan dari server (null = boleh mengajukan).
  final String? blokir;

  /// menunggu_konfirmasi | diminta | dibatalkan | selesai | ditolak
  final String? status;

  final String? permintaanId;

  const AccountDeletionState({this.blokir, this.status, this.permintaanId});

  static const AccountDeletionState kosong = AccountDeletionState();

  /// Jawaban RPC `my_account_deletion()` → model.
  factory AccountDeletionState.fromRpc(Map<String, dynamic> m) {
    if (m['ok'] != true) return kosong;
    return AccountDeletionState(
      blokir: m['blokir'] as String?,
      status: m['status'] as String?,
      permintaanId: m['permintaan'] as String?,
    );
  }

  /// Ada permintaan yang sedang menunggu dijalankan operator?
  bool get menungguOperator => status == 'diminta';

  /// Boleh menekan "Hapus akun" sekarang?
  bool get bolehAjukan => blokir == null && !menungguOperator && status != 'menunggu_konfirmasi';

  /// Kalimat yang menjelaskan kenapa belum bisa diajukan (kosong bila bisa).
  String get alasanBlokir => hapusAkunBlokirPesan(blokir);
}

/// Kalimat manusiawi untuk tiap kode penolakan dari `hapus_akun_blokir` di
/// database — teks yang sama dipakai server web (src/app/actions/account-deletion.js),
/// jadi pengguna membaca aturan yang sama di kedua jalur. Murni.
String hapusAkunBlokirPesan(String? kode) {
  switch (kode) {
    case null:
      return '';
    case 'belum_masuk':
      return 'Kamu perlu masuk dulu untuk mengajukan penghapusan akun.';
    case 'profil_tidak_ada':
      return 'Profil akun ini sudah tidak ada.';
    case 'akun_admin':
      return 'Akun admin tidak bisa dihapus dari aplikasi. Hubungi admin lain.';
    case 'pesanan_aktif':
      return 'Masih ada pesanan yang belum selesai. Selesaikan atau batalkan dulu pesanan itu, lalu ajukan lagi.';
    case 'tugas_aktif':
      return 'Masih ada pekerjaan yang sedang kamu kerjakan. Selesaikan atau lepaskan tugas itu dulu.';
    case 'saldo_belum_nol':
      return 'Saldo kamu belum nol (ada komisi/biaya yang belum disetor). Bereskan saldo dulu.';
    case 'penarikan_menunggu':
      return 'Masih ada pengajuan penarikan saldo yang menunggu persetujuan admin.';
    case 'setoran_menunggu':
      return 'Masih ada pengajuan setor saldo yang menunggu verifikasi admin.';
    default:
      // Tanpa alamat surel di sini: kode `lib/` tidak boleh memuat domain
      // fixify.id (dijaga test/push_worker_origin_test.dart — domain itu tidak
      // menunjuk deployment mana pun, dan riwayatnya pernah bikin worker push
      // tak pernah jalan). Alamat dukungan ada di halaman web /hapus-akun.
      return 'Permintaan belum bisa diajukan sekarang. Coba lagi nanti; bila tetap gagal, hubungi dukungan Fixify.';
  }
}

/// Label singkat status permintaan untuk baris di halaman Profil. Murni.
String hapusAkunStatusLabel(String? status) {
  switch (status) {
    case 'menunggu_konfirmasi':
      return 'Menunggu konfirmasi dari emailmu';
    case 'diminta':
      return 'Sedang diproses — paling lambat 7 hari';
    case 'ditolak':
      return 'Ditolak — periksa syaratnya lalu ajukan lagi';
    case 'dibatalkan':
      return 'Dibatalkan';
    case 'selesai':
      return 'Selesai';
    default:
      return 'Belum ada permintaan';
  }
}

/// Gerbang dialog: pengguna wajib mengetik [kataKonfirmasi] sebelum tombol hapus
/// aktif. Penghapusan akun tidak bisa dibatalkan, jadi satu langkah sengaja
/// dibuat repot — tapi tetap terjangkau (bukan disembunyikan). Murni.
const String kataKonfirmasi = 'HAPUS';

bool konfirmasiKetikSah(String input) =>
    input.trim().toUpperCase() == kataKonfirmasi;

/// Alasan opsional dibatasi panjangnya supaya kolom `alasan` tidak meluap dan
/// operator membaca ringkasannya. Murni.
String rapikanAlasan(String? input) {
  final t = (input ?? '').trim();
  if (t.isEmpty) return '';
  return t.length <= 300 ? t : t.substring(0, 300);
}
