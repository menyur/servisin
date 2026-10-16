import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

/// Satu peluncuran URL yang BENAR-BENAR diserahkan aplikasi ke platform.
class LaunchedUrl {
  const LaunchedUrl(this.url, this.options);

  final String url;
  final LaunchOptions options;

  /// Mode yang diminta aplikasi — [PreferredLaunchMode.externalApplication]
  /// berarti keluar ke aplikasi Google Maps, bukan webview di dalam app.
  PreferredLaunchMode get mode => options.mode;

  /// Tujuan sebagai [Uri] supaya query parameter bisa diperiksa terurai
  /// (`destination`, `travelmode`) — bukan sekadar pencocokan substring.
  Uri get uri => Uri.parse(url);

  String? get destination => uri.queryParameters['destination'];
  String? get travelmode => uri.queryParameters['travelmode'];

  @override
  String toString() => 'LaunchedUrl($url, ${options.mode})';
}

/// Pemalsu [UrlLauncherPlatform] untuk test.
///
/// Dibuat karena tombol rute hanya berguna bila URL Google Maps-nya BENAR.
/// Callback yang terpanggil (pola `onRoute: () => routed = true`) tidak
/// membuktikan apa pun tentang tujuan rute: salah menukar lat/lng, mengirim
/// alamat padahal pin sudah dipasang, atau kehilangan `travelmode=driving`
/// semuanya lolos dari test bergaya callback. Pemalsu ini menangkap string URL
/// beserta mode peluncurannya, apa adanya.
///
/// Pakai:
///   final launcher = FakeUrlLauncher()..install();
///   addTearDown(launcher.restore);
class FakeUrlLauncher extends UrlLauncherPlatform {
  FakeUrlLauncher({this.hasHandler = true, this.error});

  /// false = platform menolak membuka URL (return false, tanpa exception),
  /// seperti Maps tidak terpasang / intent tidak ada yang menangani.
  final bool hasHandler;

  /// Bila diisi: peluncuran melempar error ini (mis. gagal jaringan).
  final Object? error;

  /// Urutan peluncuran; index 0 = pertama. Kosong = tidak ada yang dibuka.
  final List<LaunchedUrl> launched = <LaunchedUrl>[];

  UrlLauncherPlatform? _sebelumnya;

  LaunchedUrl? get last => launched.isEmpty ? null : launched.last;
  String? get lastUrl => last?.url;

  /// Pasang pemalsu sebagai implementasi platform aktif selama test.
  void install() {
    _sebelumnya = UrlLauncherPlatform.instance;
    UrlLauncherPlatform.instance = this;
  }

  /// Kembalikan implementasi asli — wajib lewat `addTearDown(launcher.restore)`
  /// supaya test berikutnya tidak mewarisi pemalsu ini.
  void restore() {
    final asli = _sebelumnya;
    if (asli != null) UrlLauncherPlatform.instance = asli;
  }

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched.add(LaunchedUrl(url, options));
    final e = error;
    if (e != null) throw e;
    return hasHandler;
  }
}
