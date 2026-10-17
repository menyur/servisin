/// Aturan & teks untuk **Laporkan** dan **Blokir** di chat pelanggan ↔ teknisi.
///
/// Dipisah dari `ui/chat_screen.dart` supaya bisa diuji tanpa widget, dan
/// supaya satu-satunya sumber kata-kata ada di sini (tombol, dialog, snack, dan
/// isi laporan tidak pernah berbeda). Ini bagian dari pemenuhan kebijakan
/// konten buatan pengguna (UGC) Google Play: pengguna harus bisa melaporkan
/// konten dan memblokir pengguna yang menyalahgunakan chat.
library;

/// Satu alasan pelaporan yang bisa dipilih pengguna.
class ChatReportReason {
  /// Nilai yang disimpan di `reports.reason` (stabil — jangan diubah).
  final String value;

  /// Kalimat yang dilihat pengguna.
  final String label;

  const ChatReportReason(this.value, this.label);
}

/// Daftar alasan yang ditawarkan di lembar "Laporkan percakapan".
///
/// Sengaja pendek dan konkret: alasan yang samar membuat admin tidak bisa
/// menindaklanjuti, sementara daftar panjang membuat pelapor berhenti di tengah
/// jalan. Urutannya dari yang paling sering terjadi di lapangan.
const List<ChatReportReason> chatReportReasons = [
  ChatReportReason('kasar', 'Kata kasar, ancaman, atau pelecehan'),
  ChatReportReason('penipuan', 'Penipuan atau minta bayar di luar aplikasi'),
  ChatReportReason('spam', 'Spam, iklan, atau promosi'),
  ChatReportReason('tidak_pantas', 'Konten tidak pantas (foto/tautan)'),
  ChatReportReason('lainnya', 'Lainnya'),
];

/// Label alasan dari [value], atau null bila tidak dikenal (mis. laporan lama
/// atau nilai yang diubah admin langsung di database).
String? chatReportReasonLabel(String value) {
  for (final r in chatReportReasons) {
    if (r.value == value) return r.label;
  }
  return null;
}

/// Judul laporan yang dilihat admin di panel — kode pesanan ikut supaya admin
/// bisa membuka percakapannya tanpa menebak.
String chatReportTitle(String bookingCode) => 'Laporan chat #$bookingCode';

/// Isi laporan: alasan yang dipilih, lalu catatan tambahan bila ada.
///
/// Admin membaca ini apa adanya; karena itu label (bukan nilai teknis) yang
/// ditulis, dan catatan kosong tidak menyisakan baris kosong yang membingungkan.
String chatReportContent({required String reasonLabel, String? detail}) {
  final note = (detail ?? '').trim();
  if (note.isEmpty) return 'Alasan: $reasonLabel.';
  return 'Alasan: $reasonLabel.\n\nCatatan pelapor: $note';
}

/// Ucapan terima kasih setelah laporan terkirim — menyebut tenggat tindak
/// lanjut supaya janji moderasi di `/syarat` benar-benar terlihat pengguna.
const String chatReportSentMessage =
    'Laporan terkirim. Tim kami meninjau laporan ini maksimal 2×24 jam.';

/// Id lawan bicara di sebuah percakapan pesanan.
///
/// Chat selalu dua orang: pelanggan ([userId]) dan teknisi ([technicianId]).
/// Siapa "lawan bicara" bergantung pada peran SAYA — dan salah menentukannya
/// berarti laporan/blokir menunjuk orang yang salah. Karena itu aturannya di
/// sini (satu fungsi murni), bukan disalin di dalam layar.
///
/// Mengembalikan null bila pesanan belum punya teknisi (chat belum boleh dibuka)
/// atau bila [myId] bukan peserta pesanan ini.
String? chatPeerId({
  required String myId,
  required String? technicianId,
  required String? userId,
}) {
  if (technicianId == null || technicianId.isEmpty) return null;
  if (myId == technicianId) return userId;
  if (myId == userId) return technicianId;
  return null;
}

/// Status blokir antara saya dan lawan bicara.
class ChatBlockState {
  /// Saya memblokir lawan bicara.
  final bool byMe;

  /// Lawan bicara memblokir saya.
  final bool byPeer;

  const ChatBlockState({this.byMe = false, this.byPeer = false});

  /// Keadaan sebelum migrasi dijalankan / belum sempat dibaca.
  static const ChatBlockState none = ChatBlockState();

  /// Ada blokir di arah mana pun → chat tidak bisa dipakai.
  bool get any => byMe || byPeer;

  /// Kotak kirim hanya aktif bila tidak ada blokir.
  bool get inputEnabled => !any;

  /// Tombol menu: "Blokir" atau "Buka blokir".
  bool get canUnblock => byMe;

  @override
  bool operator ==(Object other) =>
      other is ChatBlockState && other.byMe == byMe && other.byPeer == byPeer;

  @override
  int get hashCode => Object.hash(byMe, byPeer);

  @override
  String toString() => 'ChatBlockState(byMe: $byMe, byPeer: $byPeer)';
}

/// Keterangan di atas daftar pesan saat SAYA memblokir lawan bicara.
String chatBlockedByMeNotice(String peerName) =>
    'Kamu memblokir $peerName. Pesan dari dan untuknya tidak lagi tampil di sini.';

/// Keterangan saat LAWAN bicara memblokir saya. Tidak menyebut siapa yang
/// memblokir secara agresif, tetapi jujur — supaya pengguna tidak menunggu
/// balasan yang tidak akan pernah bisa dikirim.
String chatBlockedByPeerNotice(String peerName) =>
    'Chat dengan $peerName dinonaktifkan. Kamu tetap bisa melaporkan percakapan ini ke admin.';

/// Isi dialog konfirmasi sebelum memblokir — menyebut akibatnya lebih dulu.
String chatBlockConfirmBody(String peerName) =>
    '$peerName tidak bisa lagi mengirim pesan kepadamu, dan pesannya tidak akan tampil di chat ini. '
    'Kamu bisa membuka blokir kapan saja lewat menu yang sama.';

/// Keterangan bahwa laporan tidak menghapus percakapan — mencegah salah paham
/// bahwa menekan "Laporkan" sama dengan memblokir.
const String chatReportSheetIntro =
    'Laporkan percakapan ini ke admin. Percakapan tetap tersimpan sebagai bukti pemeriksaan.';
