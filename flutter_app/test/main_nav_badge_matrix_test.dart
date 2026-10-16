import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Matriks angka badge MainNav — menjaga KEEMPAT angka (Pesanan, Laporan,
/// Pekerjaan, Voucher) tidak pernah tertukar, baik antar tab maupun antar peran.
///
/// Kenapa perlu: tab ke-2 & ke-3 BERGESER antar peran — pelanggan
/// `[Beranda, Pesanan, Laporan, Voucher, Profil]`, teknisi
/// `[Beranda, Pesanan, Pekerjaan, Laporan, Profil]`. Satu salah indeks di
/// `_badgeSource`/`_badgeSemantics` cukup untuk menempelkan angka laporan ke
/// tombol Voucher (pelanggan) atau ke Pekerjaan (teknisi) — dan angka yang
/// salah itu tetap "terlihat benar" kalau yang diperiksa hanya jumlah widget.
///
/// Karena itu setiap angka diuji TIGA hal sekaligus:
///   1. ADA/TIDAK-nya (dan tepat satu);
///   2. GEOMETRI — lencananya harus berada di kolom tab yang benar, di atas
///      label tab itu (bukan sekadar "ada angka 5 di layar");
///   3. SATUAN — label pembaca layarnya menyebut hal yang benar
///      ("5 laporan belum dibaca", bukan "5 pembaruan pesanan…").
///
/// Angka penanda sengaja berbeda satu sama lain (2 / 5 / 7) supaya pertukaran
/// langsung terbaca, dan semuanya < 10 supaya tidak terkena pemangkasan "9+".
const _tabPelanggan = ['Beranda', 'Pesanan', 'Laporan', 'Voucher', 'Profil'];
const _tabTeknisi = ['Beranda', 'Pesanan', 'Pekerjaan', 'Laporan', 'Profil'];

/// Satuan label aksesibilitas per jenis badge (lihat `_badgeSemantics`).
const _satuanPesanan = 'pembaruan pesanan belum dibaca';
const _satuanLaporan = 'laporan belum dibaca';
const _satuanPekerjaan = 'pekerjaan tersedia';

void main() {
  setUp(() {
    // Notifier badge hidup global — nol-kan supaya test tidak mewarisi angka.
    unseenBookingUpdates.value = 0;
    unseenReportUpdates.value = 0;
    availableJobCount.value = 0;
  });

  Future<void> pompa(WidgetTester tester, {
    required bool isTechnician,
    int currentIndex = 0,
  }) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: const SizedBox.shrink(),
        bottomNavigationBar:
            MainNav(currentIndex: currentIndex, isTechnician: isTechnician),
      ),
    ));
    await tester.pumpAndSettle();
  }

  /// Label badge hanya ada saat pohon semantik hidup, dan framework MENUNTUT
  /// handle-nya dibuang sebelum badan test selesai (addTearDown sudah
  /// terlambat — verifikasi framework jalan lebih dulu).
  Future<void> denganSemantik(
    WidgetTester tester,
    Future<void> Function() badan,
  ) async {
    final semantik = tester.ensureSemantics();
    try {
      await badan();
    } finally {
      semantik.dispose();
    }
  }

  /// Periksa satu angka: tampil/tidaknya, kolomnya, dan satuannya.
  void periksaAngka(
    WidgetTester tester, {
    required int angka,
    required String satuan,
    required String namaTab,
    required int indeksTab,
    required bool isTechnician,
    required int currentIndex,
    String tampilSebagai = '',
  }) {
    final tabs = isTechnician ? _tabTeknisi : _tabPelanggan;
    final teks = find.text(tampilSebagai.isEmpty ? '$angka' : tampilSebagai);
    // Label pembaca layar SELALU menyebut jumlah sebenarnya (12), sementara
    // lencana visualnya dipangkas ke "9+" (_badgeSemantics memakai n apa
    // adanya; hanya teks _UnseenBadge yang dipangkas) — jadi labelnya dihitung
    // dari [angka], bukan dari [tampilSebagai].
    final label = find.bySemanticsLabel(RegExp(RegExp.escape('$angka $satuan')));

    if (indeksTab == currentIndex) {
      expect(teks, findsNothing,
          reason: 'tab $namaTab sedang dibuka → angkanya disembunyikan');
      expect(label, findsNothing,
          reason: 'label pembaca layar pun tidak boleh tertinggal');
      return;
    }

    expect(teks, findsOneWidget,
        reason: 'angka $angka harus tampil untuk tab $namaTab');
    expect(label, findsWidgets,
        reason: 'pembaca layar harus mendengar "$angka $satuan"');

    // (2) Geometri: kolom tab terdekat dari lencana HARUS tab yang benar.
    final pusat = tester.getCenter(teks);
    var terdekat = -1;
    var jarak = double.infinity;
    for (var i = 0; i < tabs.length; i++) {
      final d = (tester.getCenter(find.text(tabs[i])).dx - pusat.dx).abs();
      if (d < jarak) {
        jarak = d;
        terdekat = i;
      }
    }
    expect(terdekat, indeksTab,
        reason: 'angka $angka nyangkut di tab "${tabs[terdekat]}", bukan $namaTab');
    // Lencana menempel di IKON (di atas label tabnya), bukan di badan tab lain.
    expect(pusat.dy, lessThan(tester.getCenter(find.text(namaTab)).dy),
        reason: 'lencana $angka harus di ikon tab $namaTab');
  }

  /// Periksa seluruh matriks untuk satu peran & satu tab aktif.
  Future<void> periksaMatriks(
    WidgetTester tester, {
    required bool isTechnician,
    int currentIndex = 0,
    int pesanan = 2,
    int laporan = 5,
    int pekerjaan = 7,
  }) async {
    await pompa(tester, isTechnician: isTechnician, currentIndex: currentIndex);

    periksaAngka(tester,
        angka: pesanan,
        satuan: _satuanPesanan,
        namaTab: 'Pesanan',
        indeksTab: kOrdersTabIndex,
        isTechnician: isTechnician,
        currentIndex: currentIndex);
    periksaAngka(tester,
        angka: laporan,
        satuan: _satuanLaporan,
        namaTab: 'Laporan',
        indeksTab: reportsTabIndex(isTechnician),
        isTechnician: isTechnician,
        currentIndex: currentIndex);

    if (isTechnician) {
      periksaAngka(tester,
          angka: pekerjaan,
          satuan: _satuanPekerjaan,
          namaTab: 'Pekerjaan',
          indeksTab: kJobsTabIndex,
          isTechnician: isTechnician,
          currentIndex: currentIndex);
    } else {
      // Pelanggan tidak punya tab Pekerjaan: angka itu tidak boleh muncul di
      // mana pun — termasuk di tab Voucher yang menempati indeks 3.
      expect(find.text('$pekerjaan'), findsNothing,
          reason: 'pelanggan tidak punya badge pekerjaan sama sekali');
      expect(find.bySemanticsLabel(RegExp(_satuanPekerjaan)), findsNothing,
          reason: 'satuan "pekerjaan tersedia" tidak berlaku untuk pelanggan');
      expect(find.text('Voucher'), findsOneWidget,
          reason: 'pelanggan memang punya tab Voucher (tab tanpa badge)');
    }
  }

  group('peran pelanggan (Beranda, Pesanan, Laporan, Voucher, Profil)', () {
    testWidgets('Pesanan=2 di tab Pesanan, Laporan=5 di tab Laporan, Voucher tanpa angka',
        (tester) async {
      unseenBookingUpdates.value = 2;
      unseenReportUpdates.value = 5;
      availableJobCount.value = 7; // milik teknisi — harus diabaikan total

      await denganSemantik(tester, () => periksaMatriks(tester, isTechnician: false));
      expect(tester.takeException(), isNull);
    });

    testWidgets('tab Pesanan dibuka: angka Pesanan hilang, angka Laporan tetap',
        (tester) async {
      unseenBookingUpdates.value = 2;
      unseenReportUpdates.value = 5;

      await denganSemantik(tester, () async {
        await periksaMatriks(tester, isTechnician: false, currentIndex: kOrdersTabIndex);
        expect(find.text('5'), findsOneWidget, reason: 'angka Laporan tidak ikut hilang');
      });
    });

    testWidgets('tab Laporan dibuka: angka Laporan hilang, angka Pesanan tetap',
        (tester) async {
      unseenBookingUpdates.value = 2;
      unseenReportUpdates.value = 5;

      await denganSemantik(tester, () async {
        await periksaMatriks(tester, isTechnician: false, currentIndex: 2);
        expect(find.text('2'), findsOneWidget, reason: 'angka Pesanan tidak ikut hilang');
      });
    });

    testWidgets('tab Voucher dibuka: tidak mengubah angka tab lain', (tester) async {
      unseenBookingUpdates.value = 2;
      unseenReportUpdates.value = 5;

      await denganSemantik(tester, () => periksaMatriks(tester, isTechnician: false, currentIndex: 3));
    });

    testWidgets('angka di atas 9 dipangkas jadi "9+", tetap di tab yang benar, '
        'dan pembaca layar tetap mendengar jumlah sebenarnya', (tester) async {
      unseenBookingUpdates.value = 12;

      await denganSemantik(tester, () async {
        await pompa(tester, isTechnician: false);

        expect(find.text('9+'), findsOneWidget);
        expect(find.text('12'), findsNothing, reason: 'lencana tidak menampilkan 12 mentah');
        periksaAngka(tester,
            angka: 12,
            tampilSebagai: '9+',
            satuan: _satuanPesanan,
            namaTab: 'Pesanan',
            indeksTab: kOrdersTabIndex,
            isTechnician: false,
            currentIndex: 0);
        // Dikunci apa adanya: yang dibaca pembaca layar adalah 12, bukan "9+".
        expect(
          find.bySemanticsLabel(RegExp(RegExp.escape('12 $_satuanPesanan'))),
          findsWidgets,
        );
      });
    });
  });

  group('peran teknisi (Beranda, Pesanan, Pekerjaan, Laporan, Profil)', () {
    testWidgets('Pesanan=2, Pekerjaan=7, Laporan=5 — tiga angka di tiga tab berbeda',
        (tester) async {
      unseenBookingUpdates.value = 2;
      availableJobCount.value = 7;
      unseenReportUpdates.value = 5;

      await denganSemantik(tester, () async {
        await periksaMatriks(tester, isTechnician: true);
        expect(find.text('Voucher'), findsNothing,
            reason: 'teknisi: tab Voucher digantikan tab Pekerjaan');
      });
    });

    testWidgets('tab Pekerjaan dibuka: angka Pekerjaan hilang, Pesanan & Laporan tetap',
        (tester) async {
      unseenBookingUpdates.value = 2;
      availableJobCount.value = 7;
      unseenReportUpdates.value = 5;

      await denganSemantik(tester, () async {
        await periksaMatriks(tester, isTechnician: true, currentIndex: kJobsTabIndex);
        expect(find.text('2'), findsOneWidget);
        expect(find.text('5'), findsOneWidget, reason: 'angka Laporan ada di indeks 3, bukan 2');
      });
    });

    testWidgets('tab Laporan (indeks 3) dibuka: hanya angka itu yang hilang',
        (tester) async {
      unseenBookingUpdates.value = 2;
      availableJobCount.value = 7;
      unseenReportUpdates.value = 5;

      await denganSemantik(tester, () async {
        await periksaMatriks(tester, isTechnician: true, currentIndex: 3);
        expect(find.text('2'), findsOneWidget);
        expect(find.text('7'), findsOneWidget, reason: 'angka Pekerjaan tidak ikut hilang');
      });
    });

    testWidgets('angka pekerjaan tidak pernah memakai satuan laporan/pesanan',
        (tester) async {
      availableJobCount.value = 7;
      unseenReportUpdates.value = 5;
      unseenBookingUpdates.value = 2;

      await denganSemantik(tester, () async {
        await pompa(tester, isTechnician: true);

        // Kombinasi silang yang akan muncul bila pemetaan satuan tertukar.
        for (final salah in const [
          '7 laporan belum dibaca',
          '7 pembaruan pesanan belum dibaca',
          '5 pekerjaan tersedia',
          '2 pekerjaan tersedia',
        ]) {
          expect(find.bySemanticsLabel(RegExp(RegExp.escape(salah))), findsNothing,
              reason: 'kombinasi salah satuan: "$salah"');
        }
      });
    });
  });

  group('lintas peran', () {
    testWidgets('matriks pelanggan vs teknisi: angka yang sama, tab yang berbeda',
        (tester) async {
      // Angka yang sama dipasang di ketiga notifier, lalu dibaca per peran:
      // kalau ada satu saja indeks yang tertukar, geometrinya langsung gagal.
      unseenBookingUpdates.value = 2;
      unseenReportUpdates.value = 5;
      availableJobCount.value = 7;

      await denganSemantik(tester, () async {
        await periksaMatriks(tester, isTechnician: false, currentIndex: 4);
        await periksaMatriks(tester, isTechnician: true, currentIndex: 4);
      });
    });

    testWidgets('nol berarti tidak ada lencana sama sekali di kedua peran',
        (tester) async {
      await denganSemantik(tester, () async {
        await pompa(tester, isTechnician: false);
        expect(find.bySemanticsLabel(RegExp('belum dibaca|pekerjaan tersedia')), findsNothing);

        await pompa(tester, isTechnician: true);
        expect(find.bySemanticsLabel(RegExp('belum dibaca|pekerjaan tersedia')), findsNothing);
        expect(tester.takeException(), isNull);
      });
    });
  });
}
