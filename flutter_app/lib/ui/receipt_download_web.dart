// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:async';
import 'dart:html' as html;
import 'dart:typed_data';

/// Web: simpan PNG sebagai file unduhan browser
/// (muncul di folder Downloads, sama seperti unduhan biasa).
Future<void> downloadReceiptFile(Uint8List bytes, String fileName) async {
  final blob = html.Blob([bytes], 'image/png');
  final url = html.Url.createObjectUrlFromBlob(blob);
  html.AnchorElement(href: url)
    ..setAttribute('download', fileName)
    ..click();
  // Beri jeda kecil sebelum mencabut URL agar download sudah dimulai.
  Future.delayed(const Duration(seconds: 2), () => html.Url.revokeObjectUrl(url));
}
