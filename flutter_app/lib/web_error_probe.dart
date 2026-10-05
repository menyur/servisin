/// Jembatan diagnostik web (SEMENTARA, untuk uji wizard lewat preview):
/// dump detail error ke localStorage browser agar terbaca dari luar.
///
/// Conditional import — pola yang sama dengan receipt_download.dart:
///   - Web   : web_error_probe_web.dart (dart:html tersedia)
///   - Mobile: web_error_probe_stub.dart (no-op — dart:html tidak tersedia
///     di platform Android/iOS, sehingga build APK tidak gagal di
///     kernel_snapshot dengan "Dart library 'dart:html' is not available")
library;

export 'web_error_probe_stub.dart'
    if (dart.library.html) 'web_error_probe_web.dart';
