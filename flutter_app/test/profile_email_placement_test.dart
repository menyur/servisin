import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/profile_screen.dart';

/// Email akun adalah identitas yang sering dicari saat menghubungi admin, jadi
/// ia harus terlihat di tempat yang wajar: satu deret dengan Nama lengkap dan
/// Nomor HP di kartu Data Diri — BUKAN terselip di header di bawah foto profil,
/// tempat ia mudah tertutup dan tidak bisa disalin dengan jelas.
///
/// Sejak halaman Profil diringkas, data diri tampil sebagai baris ringkasan dan
/// formulirnya ada di sheet "Ubah Data Diri". Urutan dan sifat read-only email
/// harus sama di kedua tempat.
void main() {
  Future<void> bukaProfil(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1000, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      home: ProfileScreen(
        loadProfile: () async => Profile(
          id: 'u-1',
          name: 'Sari Pelanggan',
          email: 'sari@example.com',
          role: 'customer',
        ),
        // Pelanggan tidak memakai rating; seam tetap diberikan agar layar tidak
        // menyentuh jaringan sama sekali.
        loadRating: () async => const RatingSummary(count: 0, average: 0),
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('email ada di kartu Data Diri, di antara nama dan nomor HP',
      (tester) async {
    await bukaProfil(tester);

    expect(find.text('sari@example.com'), findsOneWidget);

    final emailY = tester.getCenter(find.text('sari@example.com')).dy;
    final namaY = tester.getCenter(find.text('Nama lengkap')).dy;
    final teleponY = tester.getCenter(find.text('Nomor HP')).dy;
    final judulKartuY = tester.getCenter(find.text('Data Diri')).dy;

    expect(emailY, greaterThan(judulKartuY),
        reason: 'email harus di dalam kartu Data Diri, bukan di header foto');
    expect(emailY, greaterThan(namaY),
        reason: 'email berada SETELAH baris nama lengkap');
    expect(emailY, lessThan(teleponY),
        reason: 'email berada SEBELUM nomor HP — satu deret data diri');
  });

  testWidgets('email hanya tampil sekali (tidak diduplikasi di header)',
      (tester) async {
    await bukaProfil(tester);

    expect(find.text('sari@example.com'), findsOneWidget);
  });

  testWidgets('email tidak bisa diubah dari formulir (read-only)',
      (tester) async {
    await bukaProfil(tester);

    // Formulir ada di sheet "Ubah", jadi buka dulu.
    await tester.tap(find.text('Ubah'));
    await tester.pumpAndSettle();

    // TextFormField membungkus TextField; properti yang diperiksa ada di
    // TextField dalamnya (label & readOnly).
    final kolomEmail = find.byWidgetPredicate(
      (w) => w is TextField && w.decoration?.labelText == 'Email',
    );
    expect(kolomEmail, findsOneWidget);

    final field = tester.widget<TextField>(kolomEmail);
    expect(field.readOnly, isTrue,
        reason: 'email = identitas login; perubahan harus lewat verifikasi');
    expect(field.controller?.text, 'sari@example.com');

    // Di formulir pun email tetap di antara nama lengkap dan nomor HP.
    // Label yang sama juga ada di baris ringkasan di belakang sheet, jadi
    // yang dibandingkan adalah kolom isian di dalam sheet.
    Finder kolom(String label) => find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == label);
    final emailY = tester.getCenter(kolomEmail).dy;
    expect(emailY, greaterThan(tester.getCenter(kolom('Nama lengkap')).dy));
    expect(emailY, lessThan(tester.getCenter(kolom('Nomor HP')).dy));
  });
}
