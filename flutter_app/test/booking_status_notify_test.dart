import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/api.dart';

/// Regresi notifikasi PROGRES PESANAN dari sisi aplikasi.
///
/// Latar: aplikasi teknisi mengubah pesanan lewat RPC Supabase langsung
/// (`claim_job` → teknisi didapat, `set_job_status` → mulai/selesai). RPC itu
/// hanya menulis DB; server web (pemegang kunci VAPID & FCM) tidak pernah tahu,
/// sehingga aksi push di dashboard admin tak pernah jalan dan pelanggan TIDAK
/// menerima push "teknisi ditugaskan"/"pengerjaan dimulai"/"pesanan selesai"
/// selama teknisi bekerja dari aplikasi.
///
/// Perbaikan: setelah RPC sukses, aplikasi memanggil
/// `/api/notify-booking-status` (fire-and-forget) yang meneruskan push.
/// Test ini menjaga kabel itu tetap tersambung.
void main() {
  late String api;

  setUpAll(() {
    api = File('lib/api.dart').readAsStringSync();
  });

  test('origin notifikasi status pesanan memakai AppConfig.webBaseUrl', () {
    // Path relatif di-_notifyWeb, digabung ke AppConfig.webBaseUrl.
    expect(api.contains('${r"$"}{AppConfig.webBaseUrl}${r"$"}path'), isTrue,
        reason: 'notifikasi web harus memakai origin AppConfig.webBaseUrl');
    expect(api.contains('/api/notify-booking-status'), isTrue,
        reason: 'route notifikasi status pesanan hilang');
    expect(Api.pushWorkerUrl(), startsWith('https://'));
  });

  test('claimJob mengirim event technician_assigned saat sukses', () {
    final blok = _fungsi(api, 'claimJob');
    expect(
        blok.contains("notifyBookingStatus(bookingId, 'technician_assigned')"),
        isTrue,
        reason:
            'klaim pekerjaan harus memberi tahu pelanggan (teknisi ditugaskan)');
    expect(blok.contains('if (ok)'), isTrue,
        reason: 'notifikasi hanya saat RPC sukses');
  });

  test('setJobStatus memetakan status ke event yang benar', () {
    final blok = _fungsi(api, 'setJobStatus');
    // Toleran terhadap pembungkusan baris `dart format` — yang dijaga adalah
    // pemetaannya, bukan tata letak sumbernya.
    expect(
        RegExp(r"status\s*==\s*'completed'\s*\?\s*'order_completed'\s*:\s*'work_started'")
            .hasMatch(blok),
        isTrue,
        reason: 'mulai → work_started, selesai → order_completed');
    expect(blok.contains('if (ok)'), isTrue);
  });

  test('pengiriman notifikasi bersifat best-effort (tidak melempar)', () {
    final blok = _fungsi(api, '_notifyWeb');
    expect(blok.contains('catch (_)'), isTrue,
        reason: 'gagal notifikasi tak boleh mengganggu alur klaim/ubah status');
    expect(blok.contains('.timeout('), isTrue,
        reason: 'batasi waktu agar UI/aksi tidak menggantung');
  });
}

/// Ambil isi satu DEKLARASI method `static … nama(` (bukan pemanggilannya)
/// sampai method berikutnya. Cukup untuk pemeriksaan sumber; tidak perlu
/// parser Dart penuh.
///
/// Toleran terhadap tipe kembalian yang dibungkus `dart format` ke baris
/// berikutnya: mulai dari `static` TERAKHIR sebelum nama method, bukan dari
/// baris yang harus memuat nama itu juga.
String _fungsi(String sumber, String nama) {
  final baris = sumber.split('\n');
  final pola = RegExp('\\b$nama\\(');
  for (var i = 0; i < baris.length; i++) {
    if (!pola.hasMatch(baris[i])) continue;
    var mulai = i;
    // Tipe kembalian bisa dibungkus ke baris sebelumnya oleh `dart format`;
    // deklarasinya tetap dimulai dari baris yang diawali `static`.
    if (!baris[i].trimLeft().startsWith('static ')) {
      var j = i - 1;
      while (j >= 0 && baris[j].trim().isEmpty) {
        j--;
      }
      if (j < 0 || !baris[j].trimLeft().startsWith('static ')) continue;
      // Baris `static … async {` yang menjadi AWAL BADAN method bukan tanda
      // tangan: pemanggilan di baris berikutnya bukan deklarasinya.
      if (baris[j].trimRight().endsWith('{')) continue;
      mulai = j;
    }
    final blok = <String>[];
    for (var k = mulai; k < baris.length; k++) {
      if (k > mulai && baris[k].trimLeft().startsWith('static ')) break;
      blok.add(baris[k]);
    }
    return blok.join('\n');
  }
  return '';
}
