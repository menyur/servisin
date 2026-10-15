import 'dart:convert';

/// Tafsir respons endpoint reset kata sandi di server web
/// (`POST /api/auth/reset`) — MURNI: tanpa jaringan, tanpa Supabase, jadi bisa
/// diuji langsung (test/reset_http_test.dart).
///
/// Kenapa dipisah dari [Api.sendPasswordReset]: yang gagal diam-diam pada fitur
/// ini selalu bagian penafsiran respons — 429 dianggap sukses, atau kegagalan
/// server tidak dibedakan dari "email sudah dikirim". Di sini semuanya
/// keputusan yang bisa diuji tanpa menunggu server.
class HasilReset {
  const HasilReset({required this.ok, this.jeda = false, this.sisaDetik, this.pesan});

  /// Server menerima permintaan (200 `{ok:true}`). Ini BUKAN bukti email
  /// sampai: alamat tanpa akun pun dijawab `{ok:true}` (perlindungan
  /// enumerasi) — lihat src/lib/password-reset.js.
  final bool ok;

  /// Ditolak karena jeda per alamat (HTTP 429).
  final bool jeda;

  /// Sisa detik tunggu bila server menyebutkannya.
  final int? sisaDetik;

  /// Kalimat siap tampil (dari server bila ada, selain itu cadangan lokal).
  final String? pesan;
}

/// Status HTTP yang berarti "server email belum siap" — dibedakan dari
/// kegagalan lain supaya tidak pernah dilaporkan sebagai "email terkirim".
const int kStatusLayananEmailBelumSiap = 503;

/// Tafsir (statusCode, badan) dari endpoint reset.
HasilReset tafsirResponsReset(int statusCode, String badan) {
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
    return const HasilReset(ok: true);
  }

  if (statusCode == 429) {
    final sisa = json?['sisaDetik'];
    return HasilReset(
      ok: false,
      jeda: true,
      sisaDetik: sisa is num && sisa > 0 ? sisa.round() : null,
      pesan: pesan ?? _pesanCadangan(429),
    );
  }

  return HasilReset(ok: false, pesan: pesan ?? _pesanCadangan(statusCode));
}

/// Cadangan bila server tidak mengirim `pesan` (mis. gateway error).
String _pesanCadangan(int statusCode) {
  switch (statusCode) {
    case 400:
      return 'Masukkan alamat email yang benar.';
    case kStatusLayananEmailBelumSiap:
      return 'Layanan email belum siap di server. Hubungi admin.';
    case 429:
      return 'Permintaan tautan baru saja dikirim. Tunggu sebentar sebelum '
          'meminta lagi.';
    default:
      return 'Gagal mengirim email reset. Coba lagi nanti.';
  }
}

/// Badan JSON permintaan reset. `redirectTo` (deep link Android) dihilangkan
/// bila null supaya server memakai Site URL — itu jalur web.
String badanPermintaanReset(String email, String? redirectTo) => jsonEncode({
      'email': email,
      if (redirectTo != null && redirectTo.isNotEmpty) 'redirectTo': redirectTo,
    });
