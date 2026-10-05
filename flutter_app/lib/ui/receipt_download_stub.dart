import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'dart:typed_data';

/// Mobile (Android/iOS): simpan PNG ke direktori aplikasi lalu buka
/// share sheet sistem — pengguna bisa memilih "Simpan ke Galeri/Files"
/// atau langsung membagikan struk via WhatsApp/email.
Future<void> downloadReceiptFile(Uint8List bytes, String fileName) async {
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$fileName');
  await file.writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(
    ShareParams(
      files: [XFile(file.path, mimeType: 'image/png')],
      text: 'Struk pesanan Fixify — $fileName',
      subject: 'Struk Fixify',
    ),
  );
}
