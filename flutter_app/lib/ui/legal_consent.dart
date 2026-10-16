import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../theme.dart';

/// Kalimat persetujuan di layar Daftar, dengan DUA tautan yang BENAR-BENAR bisa
/// diketuk: "syarat layanan" dan "kebijakan privasi".
///
/// Kenapa jadi widget tersendiri: sebelumnya keduanya hanya `TextSpan` berwarna
/// brand — tampak seperti tautan tetapi tidak punya `recognizer` sama sekali,
/// sehingga satu-satunya jalan membaca kebijakan privasi dari dalam aplikasi
/// mati (keluhan "tidak bisa diklik"). Halaman legalnya hidup di situs web, dan
/// tautan privasi termasuk yang dinilai saat verifikasi OAuth Google (lihat
/// `scripts/verify-legal-links.mjs`).
///
/// Tautan dibuka di BROWSER LUAR, dan kegagalannya tidak diam-diam: pengguna
/// diberi tahu lewat SnackBar supaya tidak terasa seperti tombol rusak.
class LegalConsentText extends StatelessWidget {
  /// Seam uji: buka satu URL halaman legal (default: `launchUrl` mode
  /// [LaunchMode.externalApplication]). Mengembalikan true bila terbuka.
  final Future<bool> Function(String url)? openPage;

  const LegalConsentText({super.key, this.openPage});

  /// Teks tautan — dipakai juga oleh uji supaya tidak ada string ajaib ganda.
  static const String syaratLabel = 'syarat layanan';
  static const String privasiLabel = 'kebijakan privasi';

  /// Ganti ini bila kalimatnya diubah; uji memastikan kedua label tetap ada.
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
          _tautan(context, syaratLabel, AppConfig.syaratUrl),
          const TextSpan(text: ' dan '),
          _tautan(context, privasiLabel, AppConfig.privasiUrl),
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
  WidgetSpan _tautan(BuildContext context, String label, String url) => WidgetSpan(
        alignment: PlaceholderAlignment.baseline,
        baseline: TextBaseline.alphabetic,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _buka(context, label, url),
          child: Padding(
            // Menambah tinggi area ketuk tanpa mengubah besar hurufnya.
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Text(label, style: _gayaTautan),
          ),
        ),
      );

  Future<void> _buka(BuildContext context, String label, String url) async {
    final buka = openPage ??
        (String u) => launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication);
    var ok = false;
    try {
      ok = await buka(url);
    } catch (_) {
      ok = false; // URL tidak bisa dibuka / tidak ada penangannya
    }
    if (ok || !context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('Gagal membuka $label. Periksa koneksi lalu coba lagi.'),
      backgroundColor: AppColors.coral,
    ));
  }
}
