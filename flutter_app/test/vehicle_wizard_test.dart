import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/booking_wizard.dart';

/// Wizard layanan kendaraan: pelanggan WAJIB memilih Motor/Mobil lalu jumlah
/// kendaraan, dan harga di layar mengikuti pilihan itu (bukan harga dasar).
void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    try {
      Supabase.instance;
    } catch (_) {
      // Plugin native tidak ada di lingkungan test — cukup penyimpanan palsu.
      SharedPreferences.setMockInitialValues({});
      await Supabase.initialize(
        url: 'https://contoh-uji.supabase.co',
        publishableKey: 'kunci-uji-yang-tidak-dipakai-untuk-jaringan-1234567890',
      );
    }
  });

  Service layananKendaraan() => Service(
        id: 's-kendaraan',
        categoryId: 'kendaraan',
        name: 'Service Berkala Motor / Mobil',
        description: 'Servis rutin motor dan mobil di rumah.',
        basePrice: 100000,
        priceNote: 'mulai dari',
        options: [
          ServiceOption(id: 'o-motor', label: 'Motor', price: 100000),
          ServiceOption(id: 'o-mobil', label: 'Mobil', price: 140000),
        ],
      );

  Future<void> bukaWizard(WidgetTester tester, Service service) async {
    await tester.pumpWidget(
      MaterialApp(
        home: BookingWizard(args: BookingArgs(service: service, heroEnabled: false)),
      ),
    );
    await tester.pump();
  }

  testWidgets('menampilkan pilihan Motor/Mobil dan jumlah kendaraan',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(), (tester) async {
    await bukaWizard(tester, layananKendaraan());

    expect(find.text('Jenis kendaraan'), findsOneWidget);
    expect(find.text('Motor'), findsOneWidget);
    expect(find.text('Mobil'), findsOneWidget);
    expect(find.text('Jumlah kendaraan'), findsOneWidget);
    // Belum memilih jenis → harga belum dihitung dari varian mana pun.
    expect(find.text('Pilih Motor atau Mobil dulu.'), findsOneWidget);
    expect(find.text('Rp 100.000 / unit'), findsNothing);
  });

  testWidgets('pilih Mobil + 2 kendaraan → subtotal mengikuti harga Mobil',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(), (tester) async {
    await bukaWizard(tester, layananKendaraan());

    await tester.tap(find.text('Mobil'));
    await tester.pump();
    expect(find.text('Pilih Motor atau Mobil dulu.'), findsNothing);

    await tester.tap(find.byTooltip('Tambah kendaraan'));
    await tester.pump();

    // 2 kendaraan × Rp140.000 — bukan harga dasar Rp100.000.
    expect(find.text('2 kendaraan × Rp 140.000 = Rp 280.000'), findsOneWidget);
  });

  testWidgets('tombol lanjut menolak bila jenis kendaraan belum dipilih',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(), (tester) async {
    await bukaWizard(tester, layananKendaraan());

    final lanjut = find.text('Lanjut');
    await tester.ensureVisible(lanjut);
    await tester.tap(lanjut, warnIfMissed: false);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('Pilih jenis kendaraan (Motor/Mobil) dulu.'), findsOneWidget);
    // Masih di langkah 1 — jadwal belum muncul.
    expect(find.text('Alamat lengkap'), findsNothing);
  });
}
