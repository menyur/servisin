import 'format.dart';
import 'models.dart';

/// Pengingat **penilaian teknisi** untuk pelanggan.
///
/// Kenapa ada berkas sendiri: tombol "Beri penilaian teknisi" hanya hidup di
/// layar detail pesanan, jadi pelanggan yang tidak membuka pesanan lama tidak
/// pernah tahu masih ada pesanan selesai yang belum ia nilai. Kotak masuk
/// menyebutnya sekali (kabar "Pesanan selesai"), tetapi begitu kabar itu
/// ditandai terbaca — atau tertimbun kabar lain — ajakannya hilang padahal
/// penilaiannya belum pernah dikirim. Beranda butuh pengingat yang **menetap
/// sampai dinilai**, dan itulah yang disusun di sini.
///
/// Semua aturan "layak dinilai" ditaruh di satu tempat agar kartu di beranda
/// memakai syarat yang SAMA dengan tombol di detail pesanan
/// (order_detail_screen.dart): status selesai, teknisi benar-benar ada, dan
/// belum pernah dinilai. Teknisi yang membuka aplikasinya tidak boleh menerima
/// pengingat menilai dirinya sendiri — daftar pesanan teknisi berisi pekerjaan
/// miliknya, jadi pemanggil wajib melewati [pesananBelumDinilai] hanya untuk
/// pelanggan.

/// Satu pesanan layak diingatkan untuk dinilai?
///
/// `technicianId` wajib ada: tanpa teknisi tidak ada yang bisa dinilai, dan
/// `submitReview` menolak permintaan seperti itu (penilaian selalu terikat ke
/// satu teknisi). `hasReview` berasal dari tabel `reviews` (lihat
/// `Api._myReviewedBookingIds`), bukan kolom bookings.
bool perluDinilai(Booking b) =>
    b.status == BookingStatus.completed &&
    b.technicianId != null &&
    !b.hasReview;

/// Daftar pesanan yang menunggu penilaian, **terbaru dulu**.
///
/// Urutan memakai `completedAt` (kapan pekerjaan benar-benar selesai) dengan
/// `createdAt` sebagai cadangan untuk baris lama yang stempelnya kosong.
/// Pesanan yang paling baru selesai adalah yang paling mungkin masih diingat
/// pelanggan, jadi ia yang tampil lebih dulu.
List<Booking> pesananBelumDinilai(List<Booking> bookings) {
  final hasil = bookings.where(perluDinilai).toList();
  hasil.sort((a, b) {
    final ta = a.completedAt ?? a.createdAt;
    final tb = b.completedAt ?? b.createdAt;
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1; // tanpa waktu → paling bawah, bukan crash
    if (tb == null) return -1;
    return tb.compareTo(ta);
  });
  return hasil;
}

/// Judul kartu pengingat.
String reviewReminderTitle(int jumlah) => jumlah == 1
    ? 'Satu pesanan selesai belum dinilai'
    : '$jumlah pesanan selesai belum dinilai';

/// Kalimat penjelas: kenapa menilai itu berguna bagi pelanggan.
String reviewReminderSubtitle(int jumlah) => jumlah == 1
    ? 'Beri bintang untuk teknisimu — sekali ketuk, selesai.'
    : 'Beri bintang untuk tiap teknisimu — sekali ketuk per pesanan.';

/// Baris pertama satu pesanan: kode + rincian layanan (mis. "Cuci AC · 2 unit").
String reviewReminderBaris(Booking b) {
  final kode = b.code.trim();
  final awalan = kode.isEmpty ? '' : '#$kode · ';
  return '$awalan${b.labelKartu}';
}

/// Baris kedua: siapa yang dinilai + kapan selesainya.
///
/// Tanggal saja (tanpa jam): baris ini satu baris di kartu, dan nama teknisi
/// yang panjang sudah menghabiskan ruangnya — jam selesai tidak pernah jadi
/// patokan pelanggan, sedangkan tanggalnya membantu mengingat pesanan mana.
String reviewReminderTeknisi(Booking b) {
  final nama = (b.technicianName ?? '').trim();
  final siapa = nama.isEmpty ? 'Teknisi' : nama;
  final selesai = b.completedAt;
  return selesai == null
      ? 'Teknisi: $siapa'
      : 'Teknisi: $siapa · selesai ${formatDateShort(selesai.toIso8601String())}';
}

/// Ajakan membuka tab Pesanan bila pesanan yang menunggu lebih banyak daripada
/// yang ditampilkan di kartu.
String reviewReminderSisa(int sisa) => sisa == 1
    ? '+1 pesanan lain menunggu penilaian'
    : '+$sisa pesanan lain menunggu penilaian';
