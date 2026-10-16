import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/common.dart';

/// Notifikasi tanggapan admin atas laporan pelanggan — diuji DETERMINISTIK.
///
/// Kenapa bukan lewat emulator: snack-nya hanya tampil ±4 detik, sementara
/// satu `uiautomator dump` di emulator makan 1–4 detik, jadi "menangkap"
/// snack di perangkat selalu soal keberuntungan waktu — bukan bukti. Di sini
/// jalur yang sama (`handleReportUpdate`, yang dipanggil `MainShell` untuk
/// SETIAP event realtime) dipanggil langsung di dalam pohon widget, lalu
/// diperiksa lewat pohon widget itu sendiri: tanpa websocket, tanpa tunggu.
///
/// Bukti berlapis: probe emulator membuktikan websocket benar-benar
/// mengantarkan event (angka tab Laporan 0 → 1 dalam hitungan detik, daftar
/// memuat ulang sendiri), dan test ini membuktikan event yang sama PASTI
/// menghasilkan notifikasi ke pelanggan.
void main() {
  /// Kerangka minimal yang sama bentuknya dengan tempat MainShell hidup:
  /// MaterialApp menyediakan ScaffoldMessenger, Scaffold-nya yang menampilkan
  /// SnackBar — persis seperti layar aslinya.
  Future<void> pompaShell(WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Text('Beranda uji'),
        bottomNavigationBar: SizedBox.shrink(),
      ),
    ));
  }

  BuildContext contextShell(WidgetTester tester) => tester.element(find.byType(Scaffold));

  const tanggapan = ReportUpdate(
    id: 'laporan-1',
    title: 'AC bocor',
    status: 'reviewed',
    prevStatus: 'open',
  );

  testWidgets('tanggapan admin (open → reviewed) MUNCUL sebagai SnackBar di layar pelanggan',
      (tester) async {
    await pompaShell(tester);

    var hitungUlang = 0;
    final diteruskan = <ReportUpdate>[];
    final sub = reportUpdatesTick.stream.listen(diteruskan.add);
    addTearDown(sub.cancel);

    handleReportUpdate(
      contextShell(tester),
      tanggapan,
      refreshBadge: () => hitungUlang++,
    );

    // Frame pertama: SnackBar masuk ke pohon widget; lalu animasinya selesai.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(SnackBar), findsOneWidget,
        reason: 'pelanggan harus melihat pemberitahuan bahwa laporannya ditanggapi');
    expect(
      find.text('Laporan "AC bocor" — Sedang Ditinjau'),
      findsOneWidget,
      reason: 'teks yang sama dengan reportUpdateSnack (judul + label status baru)',
    );
    expect(hitungUlang, 1, reason: 'angka badge tab Laporan dihitung ulang tepat sekali');
    expect(diteruskan.single.id, 'laporan-1', reason: 'tick diteruskan ke layar Laporan');
    expect(diteruskan.single.status, 'reviewed');

    // Memang notifikasi sesaat: hilang sendiri tanpa perlu disentuh.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing, reason: 'snack sesaat, bukan menetap');
    expect(tester.takeException(), isNull);
  });

  testWidgets('status tidak berubah: TIDAK ada SnackBar, tapi tick & hitung ulang tetap jalan',
      (tester) async {
    await pompaShell(tester);

    var hitungUlang = 0;
    handleReportUpdate(
      contextShell(tester),
      const ReportUpdate(
        id: 'laporan-1',
        title: 'AC bocor',
        status: 'reviewed',
        prevStatus: 'reviewed', // admin menyunting tanpa mengubah status
      ),
      refreshBadge: () => hitungUlang++,
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(SnackBar), findsNothing,
        reason: 'tidak ada kabar baru untuk pelanggan — jangan berisik');
    expect(hitungUlang, 1, reason: 'angka tetap dihitung ulang supaya tidak basi');
    expect(tester.takeException(), isNull);
  });

  testWidgets('event tiba setelah layar dilepas: tidak menempel ke context mati',
      (tester) async {
    await pompaShell(tester);
    final contextLama = contextShell(tester);

    // Layar ditutup (mis. app ditutup) sebelum event terakhir sampai.
    await tester.pumpWidget(const SizedBox());
    expect(contextLama.mounted, isFalse, reason: 'prasyarat test ini');

    var hitungUlang = 0;
    handleReportUpdate(
      contextLama,
      tanggapan,
      refreshBadge: () => hitungUlang++,
    );

    expect(tester.takeException(), isNull,
        reason: 'tanpa context.mounted ini melempar galat widget yang sudah dilepas');
    expect(hitungUlang, 1, reason: 'perhitungan angka tidak ikut hilang');
  });

  testWidgets('dua tanggapan berurutan: pelanggan melihat keduanya, angka dihitung dua kali',
      (tester) async {
    await pompaShell(tester);

    var hitungUlang = 0;
    handleReportUpdate(
      contextShell(tester),
      tanggapan,
      refreshBadge: () => hitungUlang++,
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Laporan "AC bocor" — Sedang Ditinjau'), findsOneWidget);

    handleReportUpdate(
      contextShell(tester),
      const ReportUpdate(
        id: 'laporan-1',
        title: 'AC bocor',
        status: 'resolved',
        prevStatus: 'reviewed',
      ),
      refreshBadge: () => hitungUlang++,
    );
    // SnackBar kedua berbaris menunggu yang pertama selesai (ScaffoldMessenger).
    await tester.pump(const Duration(seconds: 5));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('Laporan "AC bocor" — Selesai'), findsOneWidget,
        reason: 'tanggapan lanjutan juga diberitakan (bukan ditelan)');
    expect(hitungUlang, 2);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
