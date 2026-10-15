import 'dart:convert';

/// Tafsir respons endpoint pendaftaran di server web
/// (`POST /api/auth/register`) — MURNI: tanpa jaringan, tanpa Supabase, jadi
/// bisa diuji langsung (test/register_http_test.dart).
///
/// Kenapa dipisah dari [Api.daftarAkun]: yang gagal diam-diam pada fitur ini
/// selalu bagian penafsiran respons — 429 dianggap sukses, atau kegagalan
/// server tidak dibedakan dari "email verifikasi sudah dikirim". Di sini
/// semuanya keputusan yang bisa diuji tanpa menunggu server.
class HasilDaftar {
  const HasilDaftar({
    required this.ok,
    this.jeda = false,
    this.jedaKuota = false,
    this.sisaDetik,
    this.pesan,
  });

  /// Server menerima pendaftaran (200 `{ok:true}`).
  ///
  /// Ini BUKAN bukti email verifikasi sampai: alamat yang sudah terdaftar pun
  /// dijawab `{ok:true}` tanpa email apa pun (perlindungan enumerasi) — lihat
  /// src/lib/signup-verification.js.
  final bool ok;

  /// Ditolak karena jeda per alamat (HTTP 429).
  final bool jeda;

  /// Ditolak karena kuota pendaftaran per IP (HTTP 429).
  final bool jedaKuota;

  /// Sisa detik tunggu bila server menyebutkannya.
  final int? sisaDetik;

  /// Kalimat siap tampil (dari server bila ada, selain itu cadangan lokal).
  final String? pesan;
}

/// Status HTTP yang berarti "layanan email belum siap" — dibedakan dari
/// kegagalan lain supaya tidak pernah dilaporkan sebagai "email terkirim".
const int kStatusLayananEmailBelumSiap = 503;

/// Tanda tangan pengiriman pendaftaran pelanggan — seam uji widget supaya
/// layar dapat diuji tanpa jaringan (lihat Api.daftarAkun untuk produksi).
typedef KirimPendaftaran = Future<HasilDaftar> Function({
  required String email,
  required String password,
  String? name,
  String? phone,
  String? address,
  String? redirectTo,
});

/// Tanda tangan pengiriman pendaftaran TEKNISI — bidang kurasi (skill, KTP)
/// wajib, sebab pendaftar tanpa keduanya ditolak (lihat Api.daftarTeknisi).
typedef KirimPendaftaranTeknisi = Future<HasilDaftar> Function({
  required String email,
  required String password,
  required String name,
  required String phone,
  required String address,
  required String skill,
  required String ktpPath,
  String? redirectTo,
});

/// Tafsir (statusCode, badan) dari endpoint pendaftaran.
HasilDaftar tafsirResponsDaftar(int statusCode, String badan) {
  Map<String, dynamic>? json;
  try {
    final terurai = jsonDecode(badan);
    if (terurai is Map<String, dynamic>) json = terurai;
  } catch (_) {
    // badan bukan JSON (mis. halaman error HTML) — pakai cadangan per status.
  }

  final pesanServer = json?['pesan'];
  final pesan = (pesanServer is String && pesanServer.trim().isNotEmpty)
      ? pesanServer.trim()
      : null;

  if (statusCode == 200 && json?['ok'] == true) {
    return const HasilDaftar(ok: true);
  }

  if (statusCode == 429) {
    final sisa = json?['sisaDetik'];
    final kuota = json?['error'] == 'kuota_ip';
    return HasilDaftar(
      ok: false,
      jeda: !kuota,
      jedaKuota: kuota,
      sisaDetik: sisa is num && sisa > 0 ? sisa.round() : null,
      pesan: pesan ?? _pesanCadangan(statusCode, kuota: kuota),
    );
  }

  return HasilDaftar(ok: false, pesan: pesan ?? _pesanCadangan(statusCode));
}

/// Cadangan bila server tidak mengirim `pesan` (mis. gateway error).
String _pesanCadangan(int statusCode, {bool kuota = false}) {
  switch (statusCode) {
    case 400:
      return 'Periksa kembali data pendaftaranmu.';
    case kStatusLayananEmailBelumSiap:
      return 'Pendaftaran sedang tidak bisa mengirim email. Hubungi admin.';
    case 429:
      return kuota
          ? 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.'
          : 'Email verifikasi baru saja dikirim. Tunggu sebentar sebelum '
              'mendaftar lagi.';
    default:
      return 'Gagal membuat akun. Coba lagi nanti.';
  }
}

/// Badan JSON permintaan pendaftaran.
///
/// `redirectTo` (deep link `fixify://confirm` di Android) dihilangkan bila null
/// supaya server memakai Site URL — itu jalur web.
String badanPermintaanDaftar({
  required String email,
  required String password,
  required String name,
  String? phone,
  String? address,
  String? role,
  String? skill,
  String? ktpUrl,
  String? redirectTo,
}) =>
    jsonEncode({
      'email': email,
      'password': password,
      'name': name,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (address != null && address.isNotEmpty) 'address': address,
      if (role != null && role.isNotEmpty) 'role': role,
      if (skill != null && skill.isNotEmpty) 'skill': skill,
      if (ktpUrl != null && ktpUrl.isNotEmpty) 'ktp_url': ktpUrl,
      if (redirectTo != null && redirectTo.isNotEmpty) 'redirectTo': redirectTo,
    });
