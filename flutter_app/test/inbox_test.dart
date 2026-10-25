import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/inbox.dart';
import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/inbox_screen.dart';
import 'package:fixify_app/ui/jobs_screen.dart';

BalanceRequest _saldo({
  String id = 'w1',
  String kind = 'withdrawal',
  String status = 'rejected',
  DateTime? reviewedAt,
  String? reason = 'Rekening tidak aktif',
}) =>
    BalanceRequest(
      id: id,
      kind: kind,
      amount: 50000,
      status: status,
      rejectionReason: reason,
      createdAt: DateTime(2026, 10, 20, 9, 0),
      reviewedAt: reviewedAt ?? DateTime(2026, 10, 22, 8, 0),
      bankName: kind == 'withdrawal' ? 'BCA' : null,
      accountNumber: kind == 'withdrawal' ? '1234567890' : null,
    );

Booking _booking({
  String id = 'b1',
  BookingStatus status = BookingStatus.completed,
  DateTime? completedAt,
  DateTime? createdAt,
  bool paymentRejected = false,
  String? paymentRejectionReason,
  String? technicianId,
  String? technicianName,
  int rescheduleCount = 0,
}) =>
    Booking(
      id: id,
      code: 'SV-$id',
      serviceName: 'Service AC',
      subtotalPrice: 100000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 105000,
      status: status,
      bookingDate: '2026-10-21',
      bookingTime: '08:00-10:00',
      address: 'Jl. Contoh 1',
      createdAt: createdAt ?? DateTime(2026, 10, 19, 7, 0),
      completedAt: completedAt,
      paymentRejected: paymentRejected,
      paymentRejectionReason: paymentRejectionReason,
      technicianId: technicianId,
      technicianName: technicianName,
      rescheduleCount: rescheduleCount,
    );

Report _report({
  String id = 'r1',
  String status = 'reviewed',
  String? adminNote,
  DateTime? createdAt,
}) =>
    Report(
      id: id,
      title: 'AC bocor',
      content: 'Air menetes',
      status: status,
      adminNote: adminNote,
      createdAt: createdAt ?? DateTime(2026, 10, 18, 6, 0),
    );

BookingRefund _refund({
  String id = 'rf1',
  String bookingId = 'b1',
  String status = 'pending',
  int amount = 155000,
  String? rejectionReason,
  bool paymentConfirmed = true,
  String? proofPath,
  DateTime? createdAt,
  DateTime? decidedAt,
}) =>
    BookingRefund(
      id: id,
      bookingId: bookingId,
      status: status,
      amount: amount,
      rejectionReason: rejectionReason,
      paymentConfirmed: paymentConfirmed,
      proofPath: proofPath,
      createdAt: createdAt ?? DateTime(2026, 10, 22, 9, 0),
      decidedAt: decidedAt,
    );

InboxData _data({
  List<BalanceRequest> requests = const [],
  List<Booking> bookings = const [],
  List<BookingRefund> refunds = const [],
  List<Report> reports = const [],
  Map<String, String> seen = const {},
  bool technician = true,
}) {
  final items = buildInboxItems(
    requests: requests,
    bookings: bookings,
    refunds: refunds,
    reports: reports,
    seen: seen,
    technician: technician,
  );
  return InboxData(
    items: items,
    requests: requests,
    reports: reports,
    uid: 'u1',
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    mainTabIndex.value = 0;
    unseenInboxUpdates.value = 0;
  });

  group('penyusunan kotak masuk', () {
    test('menggabungkan saldo, pesanan, dan laporan — terbaru dulu', () {
      final data = _data(
        requests: [_saldo()],
        bookings: [
          _booking(completedAt: DateTime(2026, 10, 21, 12, 0)),
          // Belum dibayar/ditugaskan → bukan kabar.
          _booking(id: 'b2', status: BookingStatus.pending),
        ],
        reports: [
          _report(adminNote: 'Sudah kami tindak lanjuti'),
          // Belum ditanggapi → bukan kabar.
          _report(id: 'r2', status: 'open'),
        ],
      );

      expect(data.items.map((i) => i.key),
          ['saldo:w1', 'pesanan:b1', 'laporan:r1']);
      expect(data.items.first.title, 'Penarikan ditolak');
      expect(data.items.first.body, contains('kembali ke saldo aktifmu'));
      expect(data.items.first.unread, isTrue);
      expect(data.unread, 3);

      // Jenis & judul kabar pesanan mengikuti statusnya.
      expect(data.items[1].title, 'Pesanan selesai');
      expect(data.items[1].body, contains('#SV-b1'));
      expect(data.items[2].title, 'Balasan admin untuk laporanmu');
      expect(data.items[2].body, contains('Sudah kami tindak lanjuti'));
    });

    test('judul kabar pesanan per status', () {
      expect(orderInboxNotice(_booking(status: BookingStatus.paid))?.$1,
          'Tugas baru untukmu');
      expect(orderInboxNotice(_booking(status: BookingStatus.inProgress))?.$1,
          'Pengerjaan dimulai');
      expect(orderInboxNotice(_booking(status: BookingStatus.completed))?.$1,
          'Pesanan selesai');
      expect(orderInboxNotice(_booking(status: BookingStatus.cancelled))?.$1,
          'Pesanan dibatalkan');
      expect(orderInboxNotice(_booking(status: BookingStatus.pending)), isNull);
    });

    test('kabar pesanan pelanggan memakai bahasa sisi pesanannya', () {
      final ditolak = _booking(
        status: BookingStatus.pending,
        paymentRejected: true,
        paymentRejectionReason: 'Bukti buram',
      );
      expect(customerOrderNotice(ditolak)?.$1, 'Bukti pembayaran ditolak');
      expect(customerOrderNotice(ditolak)?.$2, contains('Bukti buram'));

      final menunggu = _booking(status: BookingStatus.pending);
      expect(customerOrderNotice(menunggu)?.$1, 'Menunggu pembayaran');

      final dibayar = _booking(status: BookingStatus.paid);
      expect(customerOrderNotice(dibayar)?.$1, 'Pembayaran dikonfirmasi');

      final ditugaskan = _booking(
        status: BookingStatus.paid,
        technicianId: 't1',
        technicianName: 'Budi',
      );
      expect(customerOrderNotice(ditugaskan)?.$1, 'Teknisi ditugaskan');
      expect(customerOrderNotice(ditugaskan)?.$2, contains('Budi'));

      expect(
        customerOrderNotice(_booking(status: BookingStatus.inProgress))?.$1,
        'Pengerjaan dimulai',
      );
      expect(
        customerOrderNotice(_booking(status: BookingStatus.completed))?.$1,
        'Pesanan selesai',
      );
      expect(
        customerOrderNotice(_booking(status: BookingStatus.cancelled))?.$1,
        'Pesanan dibatalkan',
      );

      // Teknisi mendapat kalimat berbeda untuk pesanan yang sama.
      expect(
        orderInboxNotice(_booking(status: BookingStatus.paid))?.$1,
        'Tugas baru untukmu',
      );
    });

    test('versi pesanan ikut berubah saat bayar ditolak / teknisi / jadwal',
        () {
      final dasar = _booking(status: BookingStatus.paid);
      expect(bookingNoticeVersion(dasar), bookingNoticeVersion(dasar));
      expect(
        bookingNoticeVersion(
            _booking(status: BookingStatus.paid, technicianId: 't1')),
        isNot(bookingNoticeVersion(dasar)),
      );
      expect(
        bookingNoticeVersion(
            _booking(status: BookingStatus.pending, paymentRejected: true)),
        isNot(bookingNoticeVersion(_booking(status: BookingStatus.pending))),
      );
      expect(
        bookingNoticeVersion(
            _booking(status: BookingStatus.paid, rescheduleCount: 1)),
        isNot(bookingNoticeVersion(dasar)),
      );

      // Pelanggan: teknisi ditugaskan muncul sebagai kabar baru.
      final items = buildInboxItems(
        technician: false,
        bookings: [
          _booking(status: BookingStatus.paid, technicianId: 't1'),
        ],
        seen: {
          'pesanan:b1':
              bookingNoticeVersion(_booking(status: BookingStatus.paid)),
        },
      );
      expect(items.single.unread, isTrue);
    });

    test('versi yang sudah dilihat tidak lagi dihitung belum dibaca', () {
      final requests = [_saldo()];
      final bookings = [_booking(completedAt: DateTime(2026, 10, 21))];
      final reports = [_report(adminNote: 'Catatan lama')];

      final pertama = _data(
        requests: requests,
        bookings: bookings,
        reports: reports,
      );
      final seen = {for (final i in pertama.items) i.key: i.version};

      final kedua = _data(
        requests: requests,
        bookings: bookings,
        reports: reports,
        seen: seen,
      );
      expect(kedua.unread, 0);

      // Admin menambah catatan → kabar laporan itu jadi BARU lagi.
      final ketiga = _data(
        requests: requests,
        bookings: bookings,
        reports: [_report(adminNote: 'Catatan baru')],
        seen: seen,
      );
      expect(countUnreadInbox(ketiga.items), 1);
      expect(
        ketiga.items.firstWhere((i) => i.kind == InboxKind.laporan).unread,
        isTrue,
      );
    });

    test('allRead() menghapus semua penanda baru tanpa mengubah isi', () {
      final data = _data(
        requests: [_saldo()],
        bookings: [_booking(completedAt: DateTime(2026, 10, 21))],
      );
      expect(data.hasUnread, isTrue);

      final bersih = data.allRead();
      expect(bersih.hasUnread, isFalse);
      expect(bersih.unread, 0);
      // Isi, urutan, dan sumber mentah tetap sama — hanya status baca berubah.
      expect(bersih.items.map((i) => i.key), data.items.map((i) => i.key));
      expect(bersih.items.map((i) => i.title), data.items.map((i) => i.title));
      expect(bersih.requests.length, 1);
      expect(bersih.uid, 'u1');
    });

    test('filter jenis hanya mengembalikan kabar jenis itu', () {
      final data = _data(
        requests: [_saldo()],
        bookings: [_booking(completedAt: DateTime(2026, 10, 21))],
        reports: [_report(adminNote: 'ok')],
      );
      expect(data.ofKind(InboxKind.saldo).length, 1);
      expect(data.ofKind(InboxKind.pesanan).length, 1);
      expect(data.ofKind(InboxKind.laporan).length, 1);
      expect(data.ofKind(null).length, 3);
      expect(inboxKindLabel(InboxKind.laporan), 'Laporan');
    });
  });

  group('kabar pengembalian dana', () {
    test('pelanggan melihat kabar refund, teknisi tidak', () {
      final pelanggan = _data(
        technician: false,
        bookings: [_booking(id: 'b1', status: BookingStatus.cancelled)],
        refunds: [_refund()],
      );
      final refund = pelanggan.items.firstWhere((i) => i.kind == InboxKind.refund);
      expect(refund.key, 'refund:rf1');
      expect(refund.bookingId, 'b1');
      expect(refund.title, 'Pengembalian dana sedang diproses');
      expect(refund.body, contains('#SV-b1'));
      expect(refund.body, contains('Rp 155.000'));
      expect(refund.unread, isTrue);
      expect(pelanggan.unread, 2);

      // Teknisi tidak punya urusan refund pelanggan.
      final teknisi = _data(refunds: [_refund()]);
      expect(teknisi.items.where((i) => i.kind == InboxKind.refund), isEmpty);
    });

    test('status refund menentukan judul, nominal, dan alasan penolakan', () {
      final selesai = refundInboxNotice(_refund(
        status: 'done',
        decidedAt: DateTime(2026, 10, 23, 10, 0),
      ));
      expect(selesai.$1, 'Dana sudah dikembalikan');
      expect(selesai.$2, contains('sudah ditransfer balik'));

      final ditolak = refundInboxNotice(_refund(
        status: 'rejected',
        rejectionReason: 'Nomor rekening tidak valid',
      ));
      expect(ditolak.$1, 'Pengembalian dana ditolak');
      expect(ditolak.$2, contains('Nomor rekening tidak valid'));

      // Bukti bayar belum dikonfirmasi admin → jangan menjanjikan transfer.
      final periksa = refundInboxNotice(_refund(paymentConfirmed: false));
      expect(periksa.$1, 'Pengembalian dana menunggu pemeriksaan');
      expect(periksa.$2, contains('belum dikonfirmasi'));
    });

    test('keputusan admin membuat kabar refund BARU lagi', () {
      final awal = _refund();
      final seen = {
        'refund:rf1': refundNoticeVersion(awal),
      };

      final belumDiputuskan = buildInboxItems(
        technician: false,
        refunds: [awal],
        seen: seen,
      );
      expect(belumDiputuskan.single.unread, isFalse);

      // Admin mentransfer balik → versi berubah → angka belum dibaca naik.
      final diputuskan = buildInboxItems(
        technician: false,
        refunds: [
          _refund(
            status: 'done',
            proofPath: 'refund/rf1.jpg',
            decidedAt: DateTime(2026, 10, 23, 10, 0),
          ),
        ],
        seen: seen,
      );
      expect(diputuskan.single.unread, isTrue);
      expect(diputuskan.single.title, 'Dana sudah dikembalikan');
      expect(countUnreadInbox(diputuskan), 1);
    });

    test('refund tanpa nominal / id tidak masuk kotak masuk', () {
      final items = buildInboxItems(
        technician: false,
        refunds: [
          BookingRefund.kosong,
          _refund(amount: 0),
        ],
      );
      expect(items.where((i) => i.kind == InboxKind.refund), isEmpty);
    });
  });

  group('kabar pembatalan untuk teknisi', () {
    Booking dibatalkan() => _booking(
          status: BookingStatus.cancelled,
          technicianId: 't1',
          technicianName: 'Budi',
        );

    test('komisi belum dipotong → saldo dinyatakan tidak berubah', () {
      final kabar = orderInboxNotice(dibatalkan(), commissionedBookingIds: {});
      expect(kabar?.$1, 'Pesanan dibatalkan');
      expect(kabar?.$2, contains('Saldo kamu tidak berubah'));
      expect(kabar?.$2, contains('komisi baru dipotong setelah pekerjaan selesai'));
    });

    test('komisi sudah dipotong → teknisi diberi tahu tidak kembali otomatis',
        () {
      final kabar =
          orderInboxNotice(dibatalkan(), commissionedBookingIds: {'b1'});
      expect(kabar?.$2, contains('sudah terpotong'));
      expect(kabar?.$2, contains('TIDAK dikembalikan otomatis'));
      expect(kabar?.$2, contains('penyesuaian saldo'));
    });

    test('data saldo gagal dibaca → kalimat netral, tanpa klaim', () {
      final kabar = orderInboxNotice(dibatalkan(), commissionedBookingIds: null);
      expect(kabar?.$2, contains('cek layar Saldo'));
      expect(kabar?.$2, isNot(contains('tidak berubah')));
    });

    test('nominal refund pelanggan tidak bocor ke teknisi', () {
      final items = buildInboxItems(
        bookings: [dibatalkan()],
        refunds: [_refund(amount: 155000, status: 'done')],
        commissionedBookingIds: {'b1'},
      );
      expect(items.where((i) => i.kind == InboxKind.refund), isEmpty);
      expect(items.single.body, isNot(contains('Rp')));
      expect(items.single.body, isNot(contains('155')));
      expect(items.single.body, contains('#SV-b1'));
    });

    test('pembatalan muncul sebagai kabar belum dibaca bagi teknisi', () {
      final sebelum = _booking(
        status: BookingStatus.paid,
        technicianId: 't1',
        technicianName: 'Budi',
      );
      final items = buildInboxItems(
        bookings: [dibatalkan()],
        seen: {'pesanan:b1': bookingNoticeVersion(sebelum)},
        commissionedBookingIds: {},
      );
      expect(items.single.unread, isTrue);
      expect(countUnreadInbox(items), 1);
    });
  });

  group('penyimpanan kotak masuk', () {
    test('snapshot tersimpan per akun dan bisa dibaca kembali', () async {
      final data = _data(
        requests: [_saldo()],
        bookings: [_booking(completedAt: DateTime(2026, 10, 21))],
      );
      await InboxSeenStore.markSeen('u1', data.items);

      final seen = await InboxSeenStore.read('u1');
      expect(seen.keys, containsAll(['saldo:w1', 'pesanan:b1']));
      expect(await InboxSeenStore.read('u2'), isEmpty);
    });

    test('data rusak / uid kosong tidak melempar', () async {
      SharedPreferences.setMockInitialValues({
        InboxSeenStore.keyFor('u1'): 'bukan-json',
      });
      expect(await InboxSeenStore.read('u1'), isEmpty);
      await InboxSeenStore.markSeen('', const []);
      expect(await InboxSeenStore.read(''), isEmpty);
    });
  });

  group('layar kotak masuk', () {
    testWidgets('menampilkan gabungan kabar, filter, dan menandai sudah dibaca',
        (tester) async {
      final data = _data(
        requests: [_saldo()],
        bookings: [_booking(completedAt: DateTime(2026, 10, 21, 12, 0))],
        reports: [_report(adminNote: 'Sudah kami tindak lanjuti')],
      );
      InboxData? ditandai;

      await tester.pumpWidget(MaterialApp(
        home: InboxScreen(
          loadInbox: () async => data,
          markSeen: (d) async => ditandai = d,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Kotak Masuk'), findsOneWidget);
      expect(find.text('Semua 3'), findsOneWidget);
      expect(find.text('Saldo 1'), findsOneWidget);
      expect(find.text('Pesanan 1'), findsOneWidget);
      expect(find.text('Laporan 1'), findsOneWidget);

      expect(find.text('Penarikan ditolak'), findsOneWidget);
      expect(find.text('Pesanan selesai'), findsOneWidget);
      expect(find.text('Balasan admin untuk laporanmu'), findsOneWidget);
      // Semua kabar baru → penanda "Baru" di tiap kartu.
      expect(find.text('Baru'), findsNWidgets(3));

      // Dibuka = dibaca (penanda di daftar tetap tampil pada kunjungan ini).
      expect(ditandai?.items.length, 3);
      expect(find.text('Baru'), findsNWidgets(3));

      // Filter Saldo → hanya kabar saldo.
      await tester.tap(find.text('Saldo 1'));
      await tester.pumpAndSettle();
      expect(find.text('Penarikan ditolak'), findsOneWidget);
      expect(find.text('Pesanan selesai'), findsNothing);
      expect(find.text('Balasan admin untuk laporanmu'), findsNothing);
    });

    testWidgets('kosong → ajakan, bukan daftar kosong tanpa penjelasan',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: InboxScreen(
          loadInbox: () async => _data(),
          markSeen: (_) async {},
        ),
      ));
      await tester.pumpAndSettle();

      expect(
          find.textContaining('Belum ada notifikasi di sini'), findsOneWidget);
      expect(find.text('Semua 0'), findsOneWidget);
      // Tidak ada yang perlu ditandai → tombolnya tidak ditawarkan.
      expect(find.text('Tandai semua sudah dibaca'), findsNothing);
    });

    testWidgets(
        'tombol "Tandai semua sudah dibaca" menghapus penanda Baru + semua badge',
        (tester) async {
      final data = _data(
        requests: [_saldo()],
        bookings: [_booking(completedAt: DateTime(2026, 10, 21, 12, 0))],
        reports: [_report(adminNote: 'Sudah kami tindak lanjuti')],
      );
      // Badge dari layar lain yang sumbernya ikut terbaca di kotak masuk.
      unseenBookingUpdates.value = 4;
      unseenReportUpdates.value = 1;
      unseenBalanceNotices.value = 2;

      await tester.pumpWidget(MaterialApp(
        home: InboxScreen(loadInbox: () async => data),
      ));
      await tester.pumpAndSettle();

      // Membuka kotak masuk = semua sumbernya dilihat, termasuk Pesanan.
      expect(unseenBookingUpdates.value, 0);
      expect(find.text('Baru'), findsNWidgets(3));

      await tester.tap(find.text('Tandai semua sudah dibaca'));
      await tester.pumpAndSettle();

      // Penanda hilang tanpa membuka satu pun pesanan, tombolnya ikut lenyap.
      expect(find.text('Baru'), findsNothing);
      expect(find.text('Tandai semua sudah dibaca'), findsNothing);
      expect(unseenInboxUpdates.value, 0);
      expect(unseenReportUpdates.value, 0);
      expect(unseenBalanceNotices.value, 0);
      expect(find.text('Semua kabar ditandai sudah dibaca.'), findsOneWidget);
      // Daftar tetap utuh setelah ditandai.
      expect(find.text('Semua 3'), findsOneWidget);
      expect(find.text('Penarikan ditolak'), findsOneWidget);
    });
    testWidgets('pelanggan: tanpa filter Saldo, kabar pesanan versi pelanggan',
        (tester) async {
      final data = _data(
        technician: false,
        bookings: [
          _booking(
            status: BookingStatus.paid,
            technicianId: 't1',
            technicianName: 'Budi',
          ),
        ],
      );

      await tester.pumpWidget(MaterialApp(
        home: InboxScreen(
          technician: false,
          loadInbox: () async => data,
          markSeen: (_) async {},
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Semua 1'), findsOneWidget);
      expect(find.text('Pesanan 1'), findsOneWidget);
      expect(find.textContaining('Saldo'), findsNothing);
      expect(find.text('Teknisi ditugaskan'), findsOneWidget);
      expect(find.textContaining('Budi akan datang'), findsOneWidget);
    });

    testWidgets('kabar laporan pelanggan membuka tab Laporan pelanggan',
        (tester) async {
      final data =
          _data(technician: false, reports: [_report(adminNote: 'ok')]);

      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (ctx) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () => Navigator.push(
                  ctx,
                  MaterialPageRoute(
                    builder: (_) => InboxScreen(
                      technician: false,
                      loadInbox: () async => data,
                      markSeen: (_) async {},
                    ),
                  ),
                ),
                child: const Text('buka'),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('buka'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Balasan admin untuk laporanmu'));
      await tester.pumpAndSettle();

      expect(mainTabIndex.value, reportsTabIndex(false));
    });

    testWidgets('kabar laporan yang diketuk membuka tab Laporan',
        (tester) async {
      final data = _data(reports: [_report(adminNote: 'Sudah ditangani')]);

      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (ctx) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () => Navigator.push(
                  ctx,
                  MaterialPageRoute(
                    builder: (_) => InboxScreen(
                      loadInbox: () async => data,
                      markSeen: (_) async {},
                    ),
                  ),
                ),
                child: const Text('buka'),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('buka'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Balasan admin untuk laporanmu'));
      await tester.pumpAndSettle();

      expect(mainTabIndex.value, reportsTabIndex(true));
      expect(find.text('buka'), findsOneWidget);
    });
  });

  testWidgets('pelanggan: kabar refund punya filter sendiri + status terbaru',
      (tester) async {
    final data = _data(
      technician: false,
      refunds: [_refund(status: 'done', decidedAt: DateTime(2026, 10, 23))],
    );

    await tester.pumpWidget(MaterialApp(
      home: InboxScreen(
        technician: false,
        loadInbox: () async => data,
        markSeen: (_) async {},
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Semua 1'), findsOneWidget);
    expect(find.text('Refund 1'), findsOneWidget);
    expect(find.text('Dana sudah dikembalikan'), findsOneWidget);
    expect(find.textContaining('Rp 155.000'), findsOneWidget);

    // Filter mempertahankan kabar refund, bukan mengosongkan layar.
    await tester.tap(find.text('Refund 1'));
    await tester.pumpAndSettle();
    expect(find.text('Dana sudah dikembalikan'), findsOneWidget);
  });

  test('lonceng kotak masuk terpasang di kedua header Beranda', () {
    // Beranda memuat katalog & plugin (gambar, versi APK) sehingga mahal dan
    // rapuh dirender di widget test. Yang perlu dijaga di sini adalah
    // KABEL-nya: lonceng memakai angka global yang sama dan membuka kotak
    // masuk dengan peran pembaca yang benar — untuk pelanggan maupun teknisi.
    final sumber = File('lib/ui/home_screen.dart').readAsStringSync();

    expect(sumber.contains('unseenInboxUpdates'), isTrue,
        reason: 'angka lonceng Beranda harus dari notifier global');
    expect(
      sumber.contains('InboxBell(unread: unread, onTap: _bukaInbox)'),
      isTrue,
      reason: 'lonceng harus memakai InboxBell yang sama dengan tab Pekerjaan',
    );
    expect(
      RegExp(r'_inboxBell\(\)').allMatches(sumber).length,
      3,
      reason: 'satu definisi + dipasang di header normal DAN header galat',
    );
    expect(
      sumber
          .contains("InboxScreen(technician: _profile?.role == 'technician')"),
      isTrue,
      reason: 'peran pembaca menentukan sumber pesanan di kotak masuk',
    );
  });

  testWidgets('lonceng terpasang di header tab Pekerjaan (teknisi)',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: JobsScreen(
        availableUji: <AvailableJob>[],
        assignedUji: <Booking>[],
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.byTooltip('Kotak masuk notifikasi'), findsOneWidget);
  });

  group('lonceng kotak masuk', () {
    testWidgets('menampilkan angka kabar belum dibaca dan bisa diketuk',
        (tester) async {
      var dibuka = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(child: InboxBell(unread: 3, onTap: () => dibuka++)),
        ),
      ));

      expect(find.text('3'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.notifications_none_rounded));
      await tester.pump();
      expect(dibuka, 1);

      // Tanpa kabar baru → tanpa angka.
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(child: InboxBell(unread: 0, onTap: () {})),
        ),
      ));
      expect(find.text('0'), findsNothing);
    });
  });
}
