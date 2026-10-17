import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/config.dart';
import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/profile_screen.dart';

/// Teknisi yang belum disetujui harus tahu statusnya dan apa yang bisa
/// diperbaiki. Status 'approved' dan pelanggan tidak boleh melihat kartu ini.
Profile _teknisi({
  String approvalStatus = 'pending',
  String? serviceArea = 'Bandung',
}) =>
    Profile(
      id: 'u-1',
      name: 'Andi Teknisi',
      email: 'andi@example.com',
      role: 'technician',
      phone: '081234567890',
      address: 'Jl. Mawar 1',
      serviceArea: serviceArea,
      skill: 'ac',
      approvalStatus: approvalStatus,
    );

void main() {
  // Lingkungan test memakai font Ahem (setiap huruf selebar font-size) yang
  // jauh lebih lebar daripada Roboto asli. Muat font aplikasi agar uji layar
  // 320 px mencerminkan perangkat sungguhan, bukan overflow palsu.
  setUpAll(() async {
    final loader = FontLoader('Roboto')
      ..addFont(rootBundle.load('assets/fonts/Roboto-Regular.ttf'))
      ..addFont(rootBundle.load('assets/fonts/Roboto-Medium.ttf'))
      ..addFont(rootBundle.load('assets/fonts/Roboto-Bold.ttf'));
    await loader.load();
  });

  group('Profile.approvalStatus', () {
    test('dibaca dari kolom approval_status', () {
      final p = Profile.fromMap({
        'id': 'u-1',
        'name': 'Andi',
        'email': 'andi@example.com',
        'role': 'technician',
        'approval_status': 'pending',
      });

      expect(p.approvalStatus, 'pending');
    });

    test('instalasi lama tanpa kolom dianggap approved', () {
      final p = Profile.fromMap({
        'id': 'u-1',
        'name': 'Andi',
        'email': 'andi@example.com',
        'role': 'technician',
      });

      expect(p.approvalStatus, 'approved');
    });
  });

  Future<void> pompa(
    WidgetTester tester,
    Profile profil, {
    Future<bool> Function(Uri)? openLink,
    Size ukuran = const Size(1000, 2800),
  }) async {
    tester.view.physicalSize = ukuran;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: ProfileScreen(
        loadProfile: () async => profil,
        loadRating: () async => RatingSummary.kosong,
        openLink: openLink,
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('pending: status, penjelasan, dan langkah menunggu tampil',
      (tester) async {
    await pompa(tester, _teknisi());

    expect(find.text('Menunggu persetujuan admin'), findsOneWidget);
    expect(find.textContaining('belum bisa mengambil pekerjaan'), findsOneWidget);
    expect(find.text('Langkah perbaikan'), findsOneWidget);
    expect(find.textContaining('Tunggu admin memeriksa'), findsOneWidget);
    expect(find.textContaining('buka halaman bantuan'), findsOneWidget);
    expect(find.text('Buka halaman bantuan'), findsOneWidget);
    // Data sudah lengkap → tidak ada langkah "Lengkapi ...".
    expect(find.textContaining('Lengkapi area layanan'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pending dengan data kosong: field yang kurang jadi langkah 1',
      (tester) async {
    await pompa(tester, _teknisi(serviceArea: null));

    expect(find.textContaining('Lengkapi area layanan'), findsOneWidget);
    // Kartu pengingat terpisah tidak boleh mengulang daftar yang sama.
    expect(find.text('Lengkapi data profil'), findsNothing);
  });

  testWidgets('ditolak: langkah perbaikan dan ajakan peninjauan ulang tampil',
      (tester) async {
    await pompa(tester, _teknisi(approvalStatus: 'rejected'));

    expect(find.text('Pendaftaran teknisi ditolak'), findsOneWidget);
    expect(find.textContaining('Perbaiki data'), findsOneWidget);
    expect(
      find.text('Tekan Simpan Perubahan setelah memperbaiki data.'),
      findsOneWidget,
    );
    expect(find.textContaining('Peninjauan ulang'), findsOneWidget);
    expect(find.text('Buka halaman bantuan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tombol bantuan membuka halaman kontak resmi', (tester) async {
    Uri? dibuka;
    await pompa(tester, _teknisi(), openLink: (uri) async {
      dibuka = uri;
      return true;
    });

    final tombol = find.text('Buka halaman bantuan');
    await tester.ensureVisible(tombol);
    await tester.tap(tombol);
    await tester.pumpAndSettle();

    expect(dibuka.toString(), AppConfig.tentangUrl);
    expect(dibuka!.path, '/tentang');
  });

  testWidgets('pending tetap muat di layar ponsel sempit tanpa overflow',
      (tester) async {
    await pompa(
      tester,
      _teknisi(serviceArea: null),
      ukuran: const Size(320, 2600),
    );

    expect(find.text('Menunggu persetujuan admin'), findsOneWidget);
    expect(find.text('Buka halaman bantuan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('approved: kartu status tidak ditampilkan', (tester) async {
    await pompa(tester, _teknisi(approvalStatus: 'approved'));

    expect(find.text('Menunggu persetujuan admin'), findsNothing);
    expect(find.text('Pendaftaran teknisi ditolak'), findsNothing);
    expect(find.text('Langkah perbaikan'), findsNothing);
  });

  testWidgets('pelanggan tidak pernah melihat status kurasi teknisi',
      (tester) async {
    await pompa(
      tester,
      Profile(
        id: 'u-2',
        name: 'Budi',
        email: 'budi@example.com',
        role: 'customer',
        approvalStatus: 'pending',
      ),
    );

    expect(find.text('Menunggu persetujuan admin'), findsNothing);
    expect(find.text('Langkah perbaikan'), findsNothing);
  });
}
