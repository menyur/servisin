import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/services.dart' show rootBundle;

/// Watermark logo Fixify untuk file PNG struk hasil unduhan.
/// Logo digambar miring ~15° di tengah kartu dengan opacity rendah —
/// HANYA di file PNG (tampilan struk di layar tidak berubah).

ui.Image? _cachedLogo;

/// Muat logo dari aset sekali per proses; gagal muat → null
/// (struk tetap bisa diunduh tanpa watermark, tanpa error).
Future<ui.Image?> _loadLogo() async {
  final cached = _cachedLogo;
  if (cached != null) return cached;
  try {
    final data = await rootBundle.load('assets/logo.png');
    final codec =
        await ui.instantiateImageCodec(data.buffer.asUint8List(), targetWidth: 512);
    final frame = await codec.getNextFrame();
    _cachedLogo = frame.image;
    return _cachedLogo;
  } catch (_) {
    return null;
  }
}

/// Gabungkan gambar struk (hasil tangkapan RepaintBoundary) dengan
/// watermark logo, lalu enkode ke PNG.
Future<Uint8List> addLogoWatermark(ui.Image receipt) async {
  final logo = await _loadLogo();

  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  canvas.drawImage(receipt, ui.Offset.zero, ui.Paint());

  if (logo != null) {
    final w = receipt.width.toDouble();
    final h = receipt.height.toDouble();
    final logoW = w * 0.55;
    final logoH = logoW * logo.height / logo.width;

    final src = ui.Rect.fromLTWH(
        0, 0, logo.width.toDouble(), logo.height.toDouble());

    canvas.save();
    canvas.translate(w / 2, h * 0.52);
    canvas.rotate(-0.26); // miring ±15° ala stempel

    final dst = ui.Rect.fromCenter(
        center: ui.Offset.zero, width: logoW, height: logoH);
    // saveLayer dengan alpha 12% → seluruh logo digambar transparan.
    canvas.saveLayer(
      dst.inflate(8),
      ui.Paint()..color = const ui.Color(0x1F000000),
    );
    canvas.drawImageRect(
      logo,
      src,
      dst,
      ui.Paint()..filterQuality = ui.FilterQuality.high,
    );
    canvas.restore(); // komposit layer (alpha diterapkan di sini)
    canvas.restore();
  }

  final composed =
      await recorder.endRecording().toImage(receipt.width, receipt.height);
  final data = await composed.toByteData(format: ui.ImageByteFormat.png);
  composed.dispose();
  receipt.dispose();
  return data!.buffer.asUint8List();
}
