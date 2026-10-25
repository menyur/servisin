/// Perkiraan waktu kedatangan (ETA) teknisi untuk pelanggan.
///
/// Sumber angkanya SATU-SATUNYA jarak dari server: `distance_m` pada
/// `booking_technician_position` (jarak LURUS, dihitung PostGIS — lihat
/// supabase/migrate-technician-trip-share.sql). Aplikasi tidak punya rute
/// jalan, jadi waktu tempuh di sini adalah PERKIRAAN, bukan janji:
///
///   * jarak lurus lebih pendek daripada jarak berkendara (±30% di kota),
///   * kecepatan bergantung lalu lintas, hujan, dan jam sibuk.
///
/// Karena itu teksnya selalu memakai "±" dan tidak pernah "tepat". Yang penting
/// bukan presisi detik, melainkan jawaban atas pertanyaan yang paling sering
/// diketik pelanggan ke chat: "sudah di mana / berapa lama lagi?".
library;

/// Detik tempuh per meter jarak lurus.
///
/// 0,22 detik/meter ≈ 16 km/jam efektif jarak-lurus. Dengan faktor belokan
/// ±1,3× itu setara ±21 km/jam di jalan — kecepatan rata-rata yang wajar untuk
/// kota besar Indonesia (berhenti-berhenti, lampu merah, gang sempit).
const double kJarakKeDetik = 0.22;

/// Perkiraan waktu tempuh dalam MENIT, dibulatkan ke menit terdekat.
///
/// `0` berarti "kurang dari satu menit" (jarak sangat dekat) — sengaja dibedakan
/// dari `null` yang berarti "tidak bisa diperkirakan" (jarak tidak dikirim
/// server karena pelanggan tidak memasang pin). UI tidak boleh menampilkan
/// angka karangan saat `null`.
///
/// Jarak 0/negatif/NaN juga `null`: teknisi yang sudah tiba tidak butuh ETA.
int? etaMenit(int? jarakM) {
  if (jarakM == null || jarakM <= 0) return null;
  final detik = jarakM * kJarakKeDetik;
  if (detik < 60) return 0;
  // Batas atas 24 jam: angka aneh (mis. bug satuan) tidak boleh menjadi
  // "±8640 menit lagi" di layar pelanggan.
  return (detik / 60).round().clamp(1, 24 * 60).toInt();
}

/// Kalimat siap tampil: "±4 menit lagi", "kurang dari 1 menit lagi",
/// "±1,5 jam lagi" — atau `null` bila jaraknya tidak diketahui.
String? ringkasanEtaDariJarak(int? jarakM) {
  final menit = etaMenit(jarakM);
  if (menit == null) return null;
  if (menit == 0) return 'kurang dari 1 menit lagi';
  if (menit < 90) return '±$menit menit lagi';

  // Perjalanan panjang: menit puluhan ("±135 menit") lebih sulit dibaca
  // daripada jam. Dibulatkan ke setengah jam supaya tidak berpura-pura presisi.
  final setengahJam = (menit / 30).round();
  final jam = setengahJam ~/ 2;
  final sisa = setengahJam.isOdd ? ',5' : '';
  return '±$jam$sisa jam lagi';
}
