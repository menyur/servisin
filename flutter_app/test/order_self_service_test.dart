import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

/// Fitur pelanggan mengurus pesanannya sendiri:
///   * batalkan / ubah jadwal (RPC cancel_booking & reschedule_booking),
///   * kartu teknisi (jarak + kontak) tanpa membocorkan koordinat,
///   * klaim garansi pekerjaan.
///
/// Yang dijaga di sini adalah ATURAN, bukan sekadar render: tombol yang tampil
/// harus sama dengan yang akan diterima server, karena tombol yang selalu
/// ditolak hanya membuang waktu pelanggan. Server tetap memeriksa ulang —
/// nilai tes di bawah adalah cermin dari
/// supabase/migrate-customer-self-service.sql.

Booking _booking({
  BookingStatus status = BookingStatus.pending,
  String? bookingDate,
  String bookingTime = '08:00-10:00',
  String? paymentProofUrl,
  bool paymentRejected = false,
  String? userId = 'cust-1',
  String? technicianId,
  int rescheduleCount = 0,
}) =>
    Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 155000,
      status: status,
      bookingDate: bookingDate ?? _ymd(DateTime.now().add(const Duration(days: 2))),
      bookingTime: bookingTime,
      address: 'Jl. Mawar 2',
      paymentMethod: 'transfer',
      paymentProofUrl: paymentProofUrl,
      paymentRejected: paymentRejected,
      userId: userId,
      technicianId: technicianId,
      rescheduleCount: rescheduleCount,
    );

String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

Future<void> _pump(
  WidgetTester tester,
  Booking booking,
  String? viewerUid, {
  BookingTechInfo? tech,
  BookingWarrantyInfo? garansi,
}) async {
  // Viewport tinggi supaya SELURUH isi ListView terbangun (daftar bersifat lazy;
  // tombol di bawah fold tidak masuk pohon widget pada 800x600).
  await tester.binding.setSurfaceSize(const Size(600, 2600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: OrderDetailScreen(
      booking: booking,
      currentUserId: () => viewerUid,
      techInfoUji: tech,
      warrantyInfoUji: garansi,
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('bolehBatalkanAtauUbahJadwal — cermin aturan server', () {
    // Pukul 09.00, jadi slot 08:00-10:00 hari ini sudah berjalan.
    final sekarang = DateTime(2026, 10, 14, 9, 0);

    bool boleh({
      BookingStatus status = BookingStatus.pending,
      String? paymentProofUrl,
      bool paymentRejected = false,
      String date = '2026-10-15',
      String time = '08:00-10:00',
    }) =>
        bolehBatalkanAtauUbahJadwal(
          status: status,
          paymentProofUrl: paymentProofUrl,
          paymentRejected: paymentRejected,
          sekarang: sekarang,
          bookingDate: date,
          bookingTime: time,
        );

    test('pending tanpa bukti bayar & jadwal besok → boleh', () {
      expect(boleh(), isTrue);
    });

    test('bukti bayar sudah diunggah → tetap boleh (refund mengantre otomatis)', () {
      // Sejak migrate-booking-refunds.sql, server membuat baris pengembalian
      // dana saat pembatalan. Memblokir di aplikasi hanya membuat tombol lebih
      // ketat daripada server.
      expect(boleh(paymentProofUrl: 'proofs/x.jpg'), isTrue);
    });

    test('bukti ditolak admin → boleh lagi (uang memang tidak diterima)', () {
      expect(boleh(paymentProofUrl: 'proofs/x.jpg', paymentRejected: true), isTrue);
    });

    test('jadwal hari ini yang jamnya sudah lewat → TIDAK boleh', () {
      expect(boleh(date: '2026-10-14', time: '08:00-10:00'), isFalse);
      expect(boleh(date: '2026-10-14', time: '10:00-12:00'), isTrue);
    });

    test('sedang dikerjakan / selesai / dibatalkan → TIDAK boleh', () {
      for (final s in [
        BookingStatus.inProgress,
        BookingStatus.completed,
        BookingStatus.cancelled,
      ]) {
        expect(boleh(status: s), isFalse, reason: 'status $s');
      }
    });

    test('sudah dibayar tetapi belum dikerjakan → masih boleh', () {
      expect(boleh(status: BookingStatus.paid), isTrue);
    });
  });

  group('slotStart', () {
    test('mengurai jam mulai dari rentang "08:00-10:00"', () {
      expect(slotStart('2026-10-14', '08:00-10:00'), DateTime(2026, 10, 14, 8, 0));
      expect(slotStart('2026-10-14', '13:00-15:00'), DateTime(2026, 10, 14, 13, 0));
    });

    test('bentuk jam tak dikenal → awal hari (sama dengan database)', () {
      // Menyamakan perilaku booking_slot_start() supaya urutan data lama tidak
      // berbeda pendapat antara klien dan server.
      expect(slotStart('2026-10-14', ''), DateTime(2026, 10, 14));
      expect(slotStart('2026-10-14', 'sepanjang hari'), DateTime(2026, 10, 14));
    });
  });

  group('normalkanNomorId', () {
    test('awalan 0 → 62 (wa.me menolak "0")', () {
      expect(normalkanNomorId('0812-3456-7890'), '6281234567890');
    });

    test('sudah ber-kode negara, dengan spasi/plus', () {
      expect(normalkanNomorId('+62 812 3456 7890'), '6281234567890');
    });

    test('tanpa awalan apa pun', () {
      expect(normalkanNomorId('81234567890'), '6281234567890');
    });

    test('tidak ada digit yang cukup → null, bukan nomor rusak', () {
      expect(normalkanNomorId('123'), isNull);
      expect(normalkanNomorId(''), isNull);
      expect(normalkanNomorId(null), isNull);
    });
  });

  group('formatJarak & formatUmurLokasi', () {
    test('meter di bawah 1 km, kilometer di atasnya', () {
      expect(formatJarak(850), '850 m');
      expect(formatJarak(2400), '2,4 km');
    });

    test('jarak belum diketahui → kalimat, bukan "null"', () {
      expect(formatJarak(null), 'jarak belum tersedia');
    });

    test('umur posisi dalam kalimat', () {
      expect(formatUmurLokasi(0), 'posisi baru saja');
      expect(formatUmurLokasi(5), 'posisi 5 menit lalu');
      expect(formatUmurLokasi(90), 'posisi 1 jam lalu');
      expect(formatUmurLokasi(null), 'posisi belum tersedia');
    });
  });

  group('BookingTechInfo', () {
    test('membaca hasil RPC + kontak tersedia saat pesanan aktif', () {
      final t = BookingTechInfo.fromRpc({
        'ok': true,
        'active': true,
        'distance_m': 2400.0,
        'location_age_min': 5,
        'technician': {'id': 't1', 'name': 'Andi', 'phone': ' 081234567890 '},
      });

      expect(t.hasTechnician, isTrue);
      expect(t.bolehDihubungi, isTrue);
      expect(t.phone, '081234567890');
      expect(t.ringkasanJarak, '2,4 km · posisi 5 menit lalu');
    });

    test('server menutup nomor setelah pesanan selesai', () {
      final t = BookingTechInfo.fromRpc({
        'ok': true,
        'active': false,
        'technician': {'id': 't1', 'name': 'Andi', 'phone': null},
      });

      expect(t.hasTechnician, isTrue);
      expect(t.bolehDihubungi, isFalse);
      expect(t.phone, isNull);
    });

    test('tanpa teknisi → tidak ada yang bisa dihubungi', () {
      expect(BookingTechInfo.kosong.hasTechnician, isFalse);
      expect(BookingTechInfo.kosong.bolehDihubungi, isFalse);
      expect(BookingTechInfo.kosong.ringkasanJarak, 'Teknisi belum ditugaskan.');
    });

    test('lokasi basi (server menghapus jarak) → hanya umur posisi', () {
      final t = BookingTechInfo.fromRpc({
        'ok': true,
        'active': true,
        'distance_m': null,
        'location_age_min': 200,
        'technician': {'id': 't1', 'name': 'Andi', 'phone': '0812'},
      });
      expect(t.ringkasanJarak, 'posisi 3 jam lalu');
    });
  });

  group('BookingWarrantyInfo', () {
    test('masih bergaransi → boleh klaim + sisa hari', () {
      final g = BookingWarrantyInfo.fromRpc({
        'ok': true,
        'warranty_days': 7,
        'eligible': true,
        'days_left': 5,
        'claim': null,
      });
      expect(g.eligible, isTrue);
      expect(g.daysLeft, 5);
      expect(g.perluTampil, isTrue);
      expect(g.ringkasan, 'Bergaransi 5 hari lagi');
    });

    test('klaim sudah ada → tidak bisa klaim kedua, tetapi kartunya tetap tampil', () {
      final g = BookingWarrantyInfo.fromRpc({
        'ok': true,
        'warranty_days': 7,
        'eligible': false,
        'days_left': 3,
        'claim': {'id': 'c1', 'status': 'open', 'reason': 'AC bocor lagi'},
      });
      expect(g.adaKlaim, isTrue);
      expect(g.menunggu, isTrue);
      expect(g.eligible, isFalse);
      expect(g.perluTampil, isTrue);
      expect(g.ringkasan, 'Klaim garansi sedang ditinjau admin.');
    });

    test('layanan tanpa garansi & tanpa klaim → kartunya disembunyikan', () {
      final g = BookingWarrantyInfo.fromRpc({
        'ok': true,
        'warranty_days': 0,
        'eligible': false,
        'days_left': 0,
        'claim': null,
      });
      expect(g.perluTampil, isFalse);
    });
  });

  group('layar detail pesanan', () {
    testWidgets('pemilik dengan jadwal masih jauh: tombol Ubah Jadwal & Batalkan tampil',
        (tester) async {
      await _pump(tester, _booking(), 'cust-1');

      expect(find.text('Ubah Jadwal'), findsOneWidget);
      expect(find.text('Batalkan'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('bukti bayar sudah diunggah: tombol batal/ubah jadwal TETAP muncul',
        (tester) async {
      // Uang yang sudah terkirim tidak lagi menyandera pelanggan — server
      // membuat catatan refund otomatis, jadi aksinya harus terlihat.
      await _pump(tester, _booking(paymentProofUrl: 'proofs/x.jpg'), 'cust-1');

      expect(find.text('Ubah Jadwal'), findsOneWidget);
      expect(find.text('Batalkan'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('teknisi yang ditugaskan tidak melihat aksi milik pelanggan',
        (tester) async {
      await _pump(tester, _booking(technicianId: 'tech-1'), 'tech-1');

      expect(find.text('Ubah Jadwal'), findsNothing);
      expect(find.text('Batalkan'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('jumlah perubahan jadwal ditampilkan sebagai batas', (tester) async {
      await _pump(tester, _booking(rescheduleCount: 2), 'cust-1');

      expect(find.text('Jadwal sudah diubah 2× (maksimal 3).'), findsOneWidget);
    });

    testWidgets('dialog pembatalan menahan kirim sampai alasan cukup panjang',
        (tester) async {
      await _pump(tester, _booking(), 'cust-1');

      await tester.tap(find.text('Batalkan'));
      await tester.pumpAndSettle();

      expect(find.text('Batalkan pesanan?'), findsOneWidget);

      // < 5 karakter = batas yang sama dengan RPC di server.
      await tester.enterText(find.byType(TextField), 'ok');
      await tester.pump();
      final tombol = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Ya, batalkan'),
      );
      expect(tombol.onPressed, isNull, reason: 'server menolak alasan < 5 karakter');

      await tester.enterText(find.byType(TextField), 'rencana berubah');
      await tester.pump();
      final aktif = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Ya, batalkan'),
      );
      expect(aktif.onPressed, isNotNull);

      // Tutup tanpa mengirim — tes ini tidak menyentuh jaringan.
      await tester.tap(find.text('Batal'));
      await tester.pumpAndSettle();
      expect(find.text('Batalkan pesanan?'), findsNothing);
    });

    testWidgets('kartu teknisi: jarak + tombol Telepon/WhatsApp', (tester) async {
      await _pump(
        tester,
        _booking(status: BookingStatus.paid, technicianId: 'tech-1'),
        'cust-1',
        tech: BookingTechInfo.fromRpc({
          'ok': true,
          'active': true,
          'distance_m': 2400.0,
          'location_age_min': 5,
          'technician': {'id': 'tech-1', 'name': 'Andi', 'phone': '081234567890'},
        }),
      );

      expect(find.text('2,4 km · posisi 5 menit lalu'), findsOneWidget);
      expect(find.text('Telepon'), findsOneWidget);
      expect(find.text('WhatsApp'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('kartu teknisi: pesanan selesai → kartunya tidak muncul lagi',
        (tester) async {
      await _pump(
        tester,
        _booking(status: BookingStatus.completed, technicianId: 'tech-1'),
        'cust-1',
        tech: BookingTechInfo.fromRpc({
          'ok': true,
          'active': false,
          'distance_m': 2400.0,
          'location_age_min': 200,
          // Server sudah menutup nomornya karena pesanan tidak aktif.
          'technician': {'id': 'tech-1', 'name': 'Andi', 'phone': null},
        }),
      );

      expect(find.text('Telepon'), findsNothing);
      expect(find.text('WhatsApp'), findsNothing);
      expect(find.text('2,4 km · posisi 3 jam lalu'), findsNothing,
          reason: 'jarak pesanan yang sudah selesai tidak lagi ditampilkan');
    });

    testWidgets('teknisi tanpa nomor telepon: diarahkan memakai chat', (tester) async {
      await _pump(
        tester,
        _booking(status: BookingStatus.paid, technicianId: 'tech-1'),
        'cust-1',
        tech: BookingTechInfo.fromRpc({
          'ok': true,
          'active': true,
          'distance_m': 900.0,
          'location_age_min': 1,
          'technician': {'id': 'tech-1', 'name': 'Andi', 'phone': null},
        }),
      );

      expect(find.text('900 m · posisi baru saja'), findsOneWidget);
      expect(find.text('Telepon'), findsNothing);
      expect(find.text('Teknisi ini belum mencantumkan nomor telepon — pakai chat.'),
          findsOneWidget);
    });

    testWidgets('kartu teknisi milik pelanggan tidak tampil di layar teknisi',
        (tester) async {
      await _pump(
        tester,
        _booking(status: BookingStatus.paid, technicianId: 'tech-1'),
        'tech-1',
        tech: BookingTechInfo.fromRpc({
          'ok': true,
          'active': true,
          'distance_m': 900.0,
          'location_age_min': 1,
          'technician': {'id': 'tech-1', 'name': 'Andi', 'phone': '081234567890'},
        }),
      );

      expect(find.text('Telepon'), findsNothing);
      expect(find.text('WhatsApp'), findsNothing);
    });

    testWidgets('kartu garansi: tombol klaim dengan sisa hari', (tester) async {
      await _pump(
        tester,
        _booking(status: BookingStatus.completed, technicianId: 'tech-1'),
        'cust-1',
        garansi: BookingWarrantyInfo.fromRpc({
          'ok': true,
          'warranty_days': 7,
          'eligible': true,
          'days_left': 5,
          'claim': null,
        }),
      );

      expect(find.text('Garansi pekerjaan'), findsOneWidget);
      expect(find.text('Bergaransi 5 hari lagi'), findsOneWidget);
      expect(find.text('Ajukan klaim garansi (sisa 5 hari)'), findsOneWidget);
    });

    testWidgets('kartu garansi: klaim yang ditinjau tidak menawarkan klaim kedua',
        (tester) async {
      await _pump(
        tester,
        _booking(status: BookingStatus.completed, technicianId: 'tech-1'),
        'cust-1',
        garansi: BookingWarrantyInfo.fromRpc({
          'ok': true,
          'warranty_days': 7,
          'eligible': false,
          'days_left': 3,
          'claim': {
            'id': 'c1',
            'status': 'approved',
            'reason': 'AC bocor lagi',
            'admin_note': null,
            'revisit_booking_id': 'b9',
          },
        }),
      );

      expect(find.text('Klaimmu: AC bocor lagi'), findsOneWidget);
      expect(find.textContaining('Ajukan klaim garansi'), findsNothing);
    });

    testWidgets('tanpa garansi: tidak ada kartu garansi sama sekali', (tester) async {
      await _pump(
        tester,
        _booking(status: BookingStatus.completed, technicianId: 'tech-1'),
        'cust-1',
        garansi: BookingWarrantyInfo.fromRpc({
          'ok': true,
          'warranty_days': 0,
          'eligible': false,
          'days_left': 0,
          'claim': null,
        }),
      );

      expect(find.text('Garansi pekerjaan'), findsNothing);
    });

    testWidgets('sheet ubah jadwal tidak menawarkan jam yang sudah lewat',
        (tester) async {
      await _pump(tester, _booking(), 'cust-1');

      await tester.tap(find.text('Ubah Jadwal'));
      await tester.pumpAndSettle();

      expect(find.text('Ubah jadwal'), findsOneWidget);
      // Jadwal sekarang ditampilkan sebagai konteks (formatnya bergantung locale).
      expect(find.textContaining('Sekarang:'), findsOneWidget);

      // Slot yang DITAWARKAN = chip yang labelnya berupa slot jam.
      final ditawarkan = tester
          .widgetList<ChoiceChip>(find.byType(ChoiceChip))
          .map((c) => (c.label as Text).data)
          .where((t) => timeSlots.contains(t))
          .toSet();

      // Tanggal yang dipilih lebih dulu: hari ini bila masih ada jam tersisa,
      // kalau tidak besok — sama dengan _tanggalPertamaTersedia().
      final sekarang = DateTime.now();
      final hariIni = _ymd(sekarang);
      final tanggalDefault = timeSlots.any((s) => slotStart(hariIni, s).isAfter(sekarang))
          ? hariIni
          : _ymd(sekarang.add(const Duration(days: 1)));
      final diharapkan = timeSlots
          .where((s) => slotStart(tanggalDefault, s).isAfter(sekarang))
          .toSet();

      expect(ditawarkan, diharapkan,
          reason: 'jam yang sudah lewat hari ini tidak boleh ditawarkan');
      expect(diharapkan, isNotEmpty);
      expect(tester.takeException(), isNull);

      // Tutup sheet: route yang masih terbuka saat tes berakhir menahan State-nya
      // sehingga leak tracker melaporkannya sebagai bocor (bukan bocor kode app).
      Navigator.of(tester.element(find.text('Ubah jadwal'))).pop();
      await tester.pumpAndSettle();
      expect(find.text('Ubah jadwal'), findsNothing);
    });
  });
}
