import 'package:flutter/material.dart';

import '../config.dart';
import '../theme.dart';
import 'legal_page_screen.dart';

/// Pembuat halaman legal — seam uji supaya tautan bisa diperiksa tanpa WebView.
typedef LegalPageBuilder = Widget Function(
    BuildContext context, String title, String url);

/// Kalimat persetujuan di layar Daftar (pelanggan & teknisi), dengan DUA tautan
/// yang BENAR-BENAR bisa diketuk: "syarat layanan" dan "kebijakan privasi".
///
/// Kenapa jadi widget tersendiri: sebelumnya keduanya hanya `TextSpan` berwarna
/// brand — tampak seperti tautan tetapi tidak punya `recognizer` sama sekali,
/// sehingga satu-satunya jalan membaca kebijakan privasi dari dalam aplikasi
/// mati (keluhan "tidak bisa diklik").
///
/// Sejak keluhan berikutnya ("jangan membuka browser"), tautan TIDAK lagi
/// meluncurkan browser/Custom Tab: dokumennya dimuat di [LegalPageScreen] di
/// dalam aplikasi, dengan tombol kembali di header. Keuntungannya bukan sekadar
/// kosmetik — pengguna yang menekan tautan tidak kehilangan alur pendaftaran,
/// dan halaman tetap terbaca di perangkat tanpa browser. Halaman legalnya tetap
/// hidup di situs web (jalur `/syarat` & `/privasi`, dijaga
/// `scripts/verify-legal-links.mjs`), karena itu juga yang dinilai saat
/// verifikasi OAuth Google.
class LegalConsentText extends StatelessWidget {
  /// Seam uji: bangun halaman sendiri (default [LegalPageScreen]).
  final LegalPageBuilder? pageBuilder;

  const LegalConsentText({super.key, this.pageBuilder});

  /// Teks tautan — dipakai juga oleh uji supaya tidak ada string ajaib ganda.
  static const String syaratLabel = 'syarat layanan';
  static const String privasiLabel = 'kebijakan privasi';

  /// Judul yang tampil di header halaman legal.
  static const String syaratJudul = 'Syarat layanan';
  static const String privasiJudul = 'Kebijakan privasi';

  static const TextStyle _gayaIsi =
      TextStyle(fontSize: 11.5, color: AppColors.inkSoft, height: 1.5);
  static const TextStyle _gayaTautan = TextStyle(
    fontSize: 11.5,
    color: AppColors.brand,
    fontWeight: FontWeight.w700,
    height: 1.5,
  );

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        style: _gayaIsi,
        children: [
          const TextSpan(text: 'Dengan mendaftar, kamu menyetujui '),
          _tautan(context, syaratLabel, syaratJudul, AppConfig.syaratUrl),
          const TextSpan(text: ' dan '),
          _tautan(context, privasiLabel, privasiJudul, AppConfig.privasiUrl),
          const TextSpan(text: ' Fixify.'),
        ],
      ),
      textAlign: TextAlign.center,
    );
  }

  /// Tautan inline sebagai [WidgetSpan].
  ///
  /// Sengaja BUKAN `TextSpan(recognizer: TapGestureRecognizer())`: recognizer
  /// harus di-dispose sendiri oleh pemiliknya (mudah bocor, dan di repo ini
  /// pelacak kebocoran menolak test yang lupa), sedangkan widget nyata juga
  /// membuat area ketuknya terukur — uji bisa mengetuknya seperti pengguna.
  WidgetSpan _tautan(
    BuildContext context,
    String label,
    String judul,
    String url,
  ) =>
      WidgetSpan(
        alignment: PlaceholderAlignment.baseline,
        baseline: TextBaseline.alphabetic,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _buka(context, judul, url),
          child: Padding(
            // Menambah tinggi area ketuk tanpa mengubah besar hurufnya.
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Text(label, style: _gayaTautan),
          ),
        ),
      );

  void _buka(BuildContext context, String judul, String url) {
    final buat = pageBuilder ??
        (BuildContext ctx, String t, String u) =>
            LegalPageScreen(title: t, url: u);
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (ctx) => buat(ctx, judul, url)),
    );
  }
}
