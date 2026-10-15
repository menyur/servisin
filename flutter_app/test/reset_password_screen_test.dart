import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import 'package:fixify_app/ui/reset_password_screen.dart';

/// Layar langkah 1 "Lupa kata sandi?" — diuji lewat seam `sendReset` supaya
/// tidak butuh Supabase maupun jaringan.
///
/// Dua perilaku yang dijaga di sini berasal dari temuan produksi 13 Okt 2026:
///
///   POST /auth/v1/recover → HTTP 429
///   {"code":429,"error_code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}
///
/// Artinya: batas pengiriman email project inilah yang membuat tautan reset
/// tidak sampai, dan menekan tombol berulang kali TIDAK menolong — justru
/// memperpanjang blokir. Karena itu harus ada (1) pesan yang menyebut sebabnya,
/// dan (2) jeda yang mengunci tombol kirim ulang.
Widget _wrap({Future<void> Function(String email)? send}) {
  return MaterialApp(home: ResetPasswordScreen(sendReset: send));
}

Future<void> _isiDanKirim(WidgetTester tester, String email) async {
  await tester.enterText(find.byType(TextField), email);
  await tester.tap(find.text('Kirim Tautan Reset'));
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('email tanpa @ ditolak sebelum memanggil server', (tester) async {
    final dikirim = <String>[];
    await tester.pumpWidget(_wrap(send: (e) async => dikirim.add(e)));

    await _isiDanKirim(tester, 'bukan-email');

    expect(find.text('Masukkan email yang valid.'), findsOneWidget);
    expect(dikirim, isEmpty);
  });

  testWidgets('batas kirim email (429) → pesan sebabnya, bukan "coba lagi"', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(send: (e) async {
      throw const AuthException(
        'email rate limit exceeded',
        statusCode: '429',
        code: 'over_email_send_rate_limit',
      );
    }));

    await _isiDanKirim(tester, 'a@b.com');

    expect(find.text(pesanBatasKirimEmail()), findsOneWidget);
    // Gagal = tetap di form, bukan pindah ke layar "terkirim".
    expect(find.text('Tautan terkirim!'), findsNothing);
    expect(find.text('Kirim Tautan Reset'), findsOneWidget);
  });

  testWidgets('kegagalan lain (bukan batas email) memakai pesan server', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(send: (e) async {
      throw const AuthException('invalid email', statusCode: '400');
    }));

    await _isiDanKirim(tester, 'a@b.com');

    expect(find.text('invalid email'), findsOneWidget);
    expect(find.text(pesanBatasKirimEmail()), findsNothing);
  });

  testWidgets('kegagalan jaringan dibungkus AuthException tetap diterjemahkan', (
    tester,
  ) async {
    // gotrue bisa membungkus kegagalan jaringan sebagai AuthException — pesan
    // teknis ("ClientException with SocketException…") tidak boleh bocor ke UI.
    await tester.pumpWidget(_wrap(send: (e) async {
      throw const AuthException(
        "ClientException with SocketException: Failed host lookup: "
        "'sgxlnhzezknmdhefsvvu.supabase.co' (OS Error: No address associated "
        'with hostname, errno = 7)',
      );
    }));

    await _isiDanKirim(tester, 'a@b.com');

    expect(find.textContaining('Tidak ada koneksi internet'), findsOneWidget);
    expect(find.textContaining('Failed host lookup'), findsNothing);
  });

  testWidgets('berhasil → tombol kirim ulang terkunci selama jeda', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(send: (e) async {}));

    await _isiDanKirim(tester, 'a@b.com');

    expect(find.text('Tautan terkirim!'), findsOneWidget);
    // Janji yang jujur: email hanya dikirim KALAU alamatnya terdaftar
    // (Supabase menjawab sukses walau tidak ada akun).
    expect(find.textContaining('terdaftar'), findsOneWidget);

    final terkunci = find.text('Coba email lain dalam ${kJedaKirimResetDetik}s');
    expect(terkunci, findsOneWidget);
    expect(
      tester.widget<TextButton>(find.byType(TextButton)).onPressed,
      isNull,
      reason: 'menekan lebih cepat hanya memicu 429 lagi di Supabase',
    );

    // Hitung-mundur selesai pada 0 detik → tombol aktif kembali.
    await tester.pump(const Duration(seconds: kJedaKirimResetDetik));
    await tester.pump();
    expect(find.text('Email tidak sampai? Coba email lain'), findsOneWidget);
    expect(
      tester.widget<TextButton>(find.byType(TextButton)).onPressed,
      isNotNull,
    );
  });

  testWidgets('setelah jeda, "coba email lain" membuka form lagi', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(send: (e) async {}));

    await _isiDanKirim(tester, 'a@b.com');
    await tester.pump(const Duration(seconds: kJedaKirimResetDetik));
    await tester.pump();

    // Layar sukses lebih tinggi dari viewport uji (800×600) — pastikan tombol
    // benar-benar terlihat sebelum diketuk, kalau tidak ketukannya meleset.
    final tombol = find.text('Email tidak sampai? Coba email lain');
    await tester.ensureVisible(tombol);
    await tester.pumpAndSettle();
    await tester.tap(tombol);
    await tester.pump();

    expect(find.text('Kirim Tautan Reset'), findsOneWidget);
    expect(find.text('Tautan terkirim!'), findsNothing);
  });

  test('pengenalan batas email tidak bergantung pada satu bentuk pesan', () {
    expect(
      gagalKarenaBatasEmail(const AuthException('email rate limit exceeded',
          statusCode: '429', code: 'over_email_send_rate_limit')),
      isTrue,
    );
    // Hanya status/kode — beberapa versi server hanya mengisi salah satunya.
    expect(
      gagalKarenaBatasEmail(const AuthException('x', statusCode: '429')),
      isTrue,
    );
    expect(
      gagalKarenaBatasEmail(
          const AuthException('rate limit', code: 'over_email_send_rate_limit')),
      isTrue,
    );
    expect(
      gagalKarenaBatasEmail(const AuthException('invalid email', statusCode: '400')),
      isFalse,
    );
  });
}
