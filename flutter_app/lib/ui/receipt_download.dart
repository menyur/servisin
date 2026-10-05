/// Unduh struk ke perangkat.
/// - Web  : buat Blob PNG lalu trigger download browser (dart:html).
/// - Mobile: simpan ke temp dir lalu buka share sheet (share_plus),
///   sehingga pengguna bisa "Simpan ke galeri/Files" atau kirim via WA.
///
/// Pemakaian:
///   import 'receipt_download.dart';
///   await downloadReceiptFile(bytes, 'struk-SV-1234.png');
library;

export 'receipt_download_stub.dart'
    if (dart.library.html) 'receipt_download_web.dart';
