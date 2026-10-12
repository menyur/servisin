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
    expect(blok.contains("notifyBookingStatus(bookingId, 'technician_assigned')"),
        isTrue,
        reason: 'klaim pekerjaan harus memberi tahu pelanggan (teknisi ditugaskan)');
    expect(blok.contains('if (ok)'), isTrue,
        reason: 'notifikasi hanya saat RPC sukses');
  });

  test('setJobStatus memetakan status ke event yang benar', () {
    final blok = _fungsi(api, 'setJobStatus');
    expect(blok.contains("status == 'completed' ? 'order_completed' : 'work_started'"),
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
String _fungsi(String sumber, String nama) {
  final m = RegExp('\n  static [^\n]*?\\b$nama\\(').firstMatch(sumber);
  if (m == null) return '';
  final setelah = sumber.substring(m.start + 1);
  final berikut = setelah.indexOf('\n  static ', 10);
  return berikut > 0 ? setelah.substring(0, berikut) : setelah;
}
