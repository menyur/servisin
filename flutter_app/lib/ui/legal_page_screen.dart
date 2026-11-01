import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../theme.dart';

/// Halaman legal (Syarat & Kebijakan Privasi) yang dibuka **di dalam aplikasi**.
///
/// Kenapa bukan browser: keluhan pengguna adalah tautan ini "keluar" ke Chrome.
/// Menjelajah ke browser lain memutus alur — pengguna yang baru setuju membaca
/// dokumen itu harus kembali sendiri ke aplikasi, dan di perangkat yang tidak
/// punya browser sama sekali halaman legalnya tidak terbaca. Sekarang dokumen
/// dimuat di WebView milik aplikasi, dengan tombol kembali di header.
///
/// Yang tetap dijaga:
///   * halaman tetap bisa dijangkau walau WebView gagal memuat — ada tombol
///     "Coba lagi" dan URL-nya bisa **disalin** dari header untuk dibuka di
///     perangkat lain;
///   * alamat yang dimuat HARUS halaman resmi situs (dikirim pemanggil dari
///     `AppConfig.syaratUrl` / `privasiUrl`), bukan URL dari data pengguna.
class LegalPageScreen extends StatefulWidget {
  /// Judul yang tampil di header, mis. "Syarat layanan".
  final String title;

  /// Alamat halaman resmi (https).
  final String url;

  /// Seam uji: pengganti WebView supaya layar bisa diuji tanpa platform
  /// channel. Null (produksi) = WebView sungguhan.
  final Widget Function(BuildContext, String url)? viewBuilder;

  const LegalPageScreen({
    super.key,
    required this.title,
    required this.url,
    this.viewBuilder,
  });

  @override
  State<LegalPageScreen> createState() => _LegalPageScreenState();
}

class _LegalPageScreenState extends State<LegalPageScreen> {
  Future<void> _salin() async {
    await Clipboard.setData(ClipboardData(text: widget.url));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('Tautan ${widget.title.toLowerCase()} disalin.'),
      backgroundColor: AppColors.mint,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: AppColors.brandDeep,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(widget.title,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        actions: [
          IconButton(
            onPressed: _salin,
            tooltip: 'Salin tautan',
            icon: const Icon(Icons.link_rounded),
          ),
        ],
      ),
      body: widget.viewBuilder?.call(context, widget.url) ??
          _LegalWebView(url: urlSematanAplikasi(widget.url)),
    );
  }
}

/// URL halaman legal dengan penanda "dibuka dari aplikasi" (`?embed=1`).
///
/// Penanda ini dibaca server (components/HideInApp.js) untuk menyembunyikan
/// navbar situs — logo Fixify + tombol "Masuk" — yang di dalam aplikasi tampil
/// sebagai header kedua di bawah AppBar, dan tombol Masuknya tidak berguna
/// karena pengguna sudah masuk lewat aplikasi. WebView berjalan tanpa
/// JavaScript, jadi penyaringan HARUS di server; itulah sebabnya penandanya
/// ikut di URL, bukan disuntikkan sebagai CSS setelah halaman termuat.
///
/// Parameter lain yang sudah ada di URL dipertahankan; `embed` ditimpa agar
/// tidak bisa dinonaktifkan dari luar.
String urlSematanAplikasi(String url) {
  final uri = Uri.parse(url);
  final query = Map<String, String>.from(uri.queryParameters)..['embed'] = '1';
  return uri.replace(queryParameters: query).toString();
}

/// WebView halaman legal: memuat URL, menampilkan progres, dan — bila gagal —
/// menawarkan "Coba lagi" alih-alih halaman kosong.
class _LegalWebView extends StatefulWidget {
  final String url;

  const _LegalWebView({required this.url});

  @override
  State<_LegalWebView> createState() => _LegalWebViewState();
}

class _LegalWebViewState extends State<_LegalWebView> {
  WebViewController? _controller;
  double _progress = 0;
  String? _error;

  /// Platform ini punya WebView? Di web (build pratinjau) dan lingkungan uji
  /// widget tidak ada implementasinya — jangan pernah membuat controller di
  /// sana, karena `WebViewController()` melempar dan mematikan halaman.
  bool _adaWebView = !kIsWeb;

  @override
  void initState() {
    super.initState();
    if (_adaWebView) {
      try {
        _pasang();
      } catch (_) {
        // Platform tanpa implementasi WebView: tampilkan penjelasan, bukan
        // layar merah. Halaman legal tidak boleh hilang hanya karenanya.
        _adaWebView = false;
      }
    }
  }

  void _pasang() {
    final controller = WebViewController()
      // Halaman legal tidak butuh JavaScript (halaman statis Next.js): mode
      // tanpa JS menutup permukaan serangan yang tidak diperlukan.
      ..setJavaScriptMode(JavaScriptMode.disabled)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) {
          if (!mounted) return;
          setState(() => _progress = p / 100);
        },
        onPageFinished: (_) {
          if (!mounted) return;
          setState(() => _progress = 1);
        },
        onWebResourceError: (e) {
          // Hanya kegagalan halaman utama yang layak mengganti tampilan;
          // aset/gambar yang gagal tidak boleh menutupi dokumennya.
          if (e.isForMainFrame == false) return;
          if (!mounted) return;
          setState(() => _error = e.description.isEmpty
              ? 'Halaman tidak bisa dimuat.'
              : e.description);
        },
      ))
      ..loadRequest(Uri.parse(widget.url));
    setState(() {
      _controller = controller;
      _error = null;
      _progress = 0;
    });
  }

  void _cobaLagi() {
    final c = _controller;
    setState(() {
      _error = null;
      _progress = 0;
    });
    if (c == null) {
      try {
        _pasang();
      } catch (_) {
        setState(() => _adaWebView = false);
      }
    } else {
      c.loadRequest(Uri.parse(widget.url));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_adaWebView) {
      return const _Info(
        ikon: Icons.phone_android_rounded,
        judul: 'Tampilan dalam aplikasi tidak tersedia',
        pesan: 'Halaman ini dibuka di dalam aplikasi Android. Gunakan tombol '
            'salin tautan di kanan atas untuk membukanya di perangkat lain.',
      );
    }
    final error = _error;
    if (error != null) {
      return _Info(
        ikon: Icons.wifi_off_rounded,
        judul: 'Halaman tidak bisa dimuat',
        pesan: '$error\nPeriksa koneksi lalu coba lagi.',
        aksi: FilledButton.icon(
          onPressed: _cobaLagi,
          icon: const Icon(Icons.refresh_rounded, size: 18),
          label: const Text('Coba lagi'),
        ),
      );
    }
    final c = _controller;
    if (c == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return Stack(children: [
      WebViewWidget(controller: c),
      if (_progress < 1)
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: LinearProgressIndicator(value: _progress == 0 ? null : _progress),
        ),
    ]);
  }
}

/// Keadaan pengganti (gagal memuat / tidak ada WebView di platform ini).
class _Info extends StatelessWidget {
  final IconData ikon;
  final String judul;
  final String pesan;
  final Widget? aksi;

  const _Info({
    required this.ikon,
    required this.judul,
    required this.pesan,
    this.aksi,
  });

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(ikon, size: 40, color: AppColors.inkSoft),
              const SizedBox(height: 12),
              Text(judul,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.navy)),
              const SizedBox(height: 6),
              Text(pesan,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 12.5, color: AppColors.inkSoft, height: 1.4)),
              if (aksi != null) ...[
                const SizedBox(height: 16),
                aksi!,
              ],
            ],
          ),
        ),
      );
}
