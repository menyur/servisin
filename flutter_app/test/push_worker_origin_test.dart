import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/api.dart';
import 'package:fixify_app/config.dart';

/// Regresi origin worker push.
///
/// Latar: `_kickPushWorker()` dulu meng-hardcode `https://fixify.id`, domain
/// yang TIDAK menunjuk deployment (koneksi gagal, HTTP 000). Karena aplikasi
/// Flutter satu-satunya klien yang memicu `/api/push-worker`, antrean
/// `push_outbox` tidak pernah disapu: barisnya menumpuk dengan `attempts = 0`
/// dan notifikasi chat tidak pernah sampai ke perangkat penerima.
///
/// URL kini HARUS berasal dari [AppConfig.webBaseUrl] (bisa diarahkan lewat
/// `--dart-define=WEB_BASE_URL=...`), dan tidak boleh ada domain mati yang
/// di-hardcode lagi di kode `lib/` (komentar penjelas boleh menyebutnya).
void main() {
  test('URL worker push memakai origin dari AppConfig.webBaseUrl', () {
    final url = Api.pushWorkerUrl();
    expect(url, '${AppConfig.webBaseUrl}/api/push-worker');
    expect(url, startsWith('https://'));
    expect(Uri.parse(url).path, '/api/push-worker');
  });

  test('worker menunjuk host yang sama dengan server web', () {
    expect(
      Uri.parse(Api.pushWorkerUrl()).host,
      Uri.parse(AppConfig.webBaseUrl).host,
    );
  });

  test('domain mati fixify.id tidak dipakai di kode lib/', () {
    final pelanggaran = <String>[];
    final pola = RegExp(r'fixify\.id');

    for (final entitas in Directory('lib').listSync(recursive: true)) {
      if (entitas is! File || !entitas.path.endsWith('.dart')) continue;

      final barisKode = entitas
          .readAsLinesSync()
          // Abaikan bagian komentar `// …` — komentar dokumentasi boleh
          // menyebut domain lama agar alasannya tetap terbaca.
          .map((l) => l.replaceAll(RegExp(r'//.*$'), ''));

      var no = 0;
      for (final baris in barisKode) {
        no++;
        if (pola.hasMatch(baris)) pelanggaran.add('${entitas.path}:$no');
      }
    }

    expect(
      pelanggaran,
      isEmpty,
      reason: 'fixify.id tidak menunjuk deployment (HTTP 000) sehingga worker '
          'push tak pernah jalan — pakai AppConfig.webBaseUrl',
    );
  });
}
