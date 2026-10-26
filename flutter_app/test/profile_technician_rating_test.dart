import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/profile_screen.dart';

/// Profil teknisi harus memperlihatkan reputasinya: jumlah rating + rata-ratanya.
/// Sebelumnya angka ini tidak ada sama sekali di aplikasi (hanya panel admin web
/// yang menghitungnya), sehingga teknisi tidak punya cara melihat hasil
/// penilaian pelanggan atas pekerjaannya.
Profile _orang({required String role, String name = 'Andi Teknisi'}) => Profile(
      id: 'u-1',
      name: name,
      email: 'andi@example.com',
      role: role,
    );

void main() {
  Future<void> pompa(
    WidgetTester tester, {
    required Future<Profile?> Function() profil,
    Future<RatingSummary?> Function()? rating,
  }) async {
    // Layar panjang; perbesar permukaan agar ListView membangun seluruh isinya.
    tester.view.physicalSize = const Size(1000, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: ProfileScreen(loadProfile: profil, loadRating: rating),
    ));
    // _load() selesai (profil + hapus akun + rating) lalu setState.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('teknisi', () {
    testWidgets('menampilkan rata-rata & JUMLAH rating di bawah identitas',
        (tester) async {
      var ratingDipanggil = 0;
      await pompa(
        tester,
        profil: () async => _orang(role: 'technician'),
        rating: () async {
          ratingDipanggil++;
          return const RatingSummary(count: 12, average: 4.8);
        },
      );

      expect(ratingDipanggil, 1, reason: 'diambil sekali saat layar dibuka');
      expect(find.byType(TechRatingPill), findsOneWidget);
      expect(find.text('4,8 · 12 ulasan'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp(RegExp.escape('Penilaian teknisi: 4,8 dari 5 (12 ulasan)'))),
        findsWidgets,
        reason: 'pembaca layar mendengar rata-rata DAN jumlah ulasan',
      );
      expect(tester.takeException(), isNull);

      // Posisi: tepat di bawah nama di header, di atas kartu formulir — bagian
      // identitas. (Email tidak lagi di header; ia pindah ke formulir data diri.)
      final rectPill = tester.getRect(find.byType(TechRatingPill));
      final pill = rectPill.center.dy;
      expect(pill, greaterThan(tester.getCenter(find.text('Andi Teknisi').first).dy));
      expect(pill, lessThan(tester.getCenter(find.text('Data Diri')).dy));

      // Kartu form mengapung 24 px ke atas. Lencana harus benar-benar terlihat:
      // dulu dibungkus Transform.translate kedua (-46 px) sehingga tertutup
      // hampir seluruhnya oleh kartu dan rating tak tampak di layar.
      final kartu = tester.getRect(
        find.descendant(of: find.byType(FloatingCard), matching: find.byType(Container)).first,
      );
      expect(kartu.top, greaterThanOrEqualTo(rectPill.bottom),
          reason: 'kartu form tidak boleh menutupi lencana rating');
    });

    testWidgets('belum pernah dinilai: lencana tetap ada dengan kalimat jelas',
        (tester) async {
      await pompa(
        tester,
        profil: () async => _orang(role: 'technician'),
        rating: () async => RatingSummary.kosong,
      );

      expect(find.byType(TechRatingPill), findsOneWidget);
      expect(find.text('Belum ada rating'), findsOneWidget);
      expect(find.textContaining('ulasan'), findsNothing);
    });

    testWidgets('gagal membaca penilaian: lencana disembunyikan, layar tetap sehat',
        (tester) async {
      await pompa(
        tester,
        profil: () async => _orang(role: 'technician'),
        rating: () async => throw Exception('offline'),
      );

      expect(find.byType(TechRatingPill), findsNothing,
          reason: 'kegagalan baca bukan bukti "belum ada rating"');
      expect(find.text('Belum ada rating'), findsNothing);
      expect(find.text('Data Diri'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('bukan teknisi', () {
    testWidgets('pelanggan: tidak ada lencana penilaian dan tidak ada query tambahan',
        (tester) async {
      var ratingDipanggil = 0;
      await pompa(
        tester,
        profil: () async => _orang(role: 'customer', name: 'Budi Pelanggan'),
        rating: () async {
          ratingDipanggil++;
          return const RatingSummary(count: 3, average: 5);
        },
      );

      expect(find.byType(TechRatingPill), findsNothing);
      expect(find.textContaining('ulasan'), findsNothing);
      expect(find.text('Belum ada rating'), findsNothing);
      expect(ratingDipanggil, 0,
          reason: 'pelanggan tidak punya reputasi teknisi — jangan sampai ada query');
    });

    testWidgets('profil tidak terbaca (mis. belum masuk): layar tetap tampil',
        (tester) async {
      await pompa(
        tester,
        profil: () async => throw Exception('tidak ada sesi'),
        rating: () async => const RatingSummary(count: 1, average: 5),
      );

      expect(find.byType(TechRatingPill), findsNothing);
      expect(find.text('Data Diri'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
