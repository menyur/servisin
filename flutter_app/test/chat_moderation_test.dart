import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/chat_moderation.dart';
import 'package:fixify_app/chat_unread.dart';
import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/chat_screen.dart';

// ============================================================================
// Aturan murni (tanpa widget): alasan, judul/isi laporan, status blokir.
// ============================================================================

void main() {
  group('daftar alasan pelaporan', () {
    test('nilai alasan unik dan tiap alasan punya kalimat untuk pengguna', () {
      final values = chatReportReasons.map((r) => r.value).toList();
      expect(values.toSet().length, values.length);
      for (final r in chatReportReasons) {
        expect(r.value.trim(), isNotEmpty);
        expect(r.label.trim(), isNotEmpty);
      }
    });

    test('"lainnya" selalu tersedia sebagai jalan keluar', () {
      expect(chatReportReasons.any((r) => r.value == 'lainnya'), isTrue);
    });

    test('label dicari dari nilai; nilai tak dikenal → null (bukan menebak)',
        () {
      expect(chatReportReasonLabel('kasar'),
          'Kata kasar, ancaman, atau pelecehan');
      expect(chatReportReasonLabel('penipuan'),
          contains('Penipuan'));
      expect(chatReportReasonLabel('entah-apa'), isNull);
    });
  });

  group('penentuan lawan bicara (chatPeerId)', () {
    test('saya pelanggan → lawan bicara adalah teknisi', () {
      expect(
        chatPeerId(myId: 'cust-1', technicianId: 'tech-1', userId: 'cust-1'),
        'tech-1',
      );
    });

    test('saya teknisi → lawan bicara adalah pelanggan (bukan diri sendiri)', () {
      expect(
        chatPeerId(myId: 'tech-1', technicianId: 'tech-1', userId: 'cust-1'),
        'cust-1',
      );
    });

    test('pesanan belum punya teknisi → null (chat belum boleh dibuka)', () {
      expect(
        chatPeerId(myId: 'cust-1', technicianId: null, userId: 'cust-1'),
        isNull,
      );
      expect(
        chatPeerId(myId: 'cust-1', technicianId: '', userId: 'cust-1'),
        isNull,
      );
    });

    test('saya bukan peserta pesanan → null (jangan menuduh orang lain)', () {
      expect(
        chatPeerId(myId: 'orang-lain', technicianId: 'tech-1', userId: 'cust-1'),
        isNull,
      );
    });
  });

  group('judul & isi laporan chat', () {
    test('judul menyebut kode pesanan supaya admin bisa membuka percakapannya',
        () {
      expect(chatReportTitle('SV-2001'), 'Laporan chat #SV-2001');
    });

    test('tanpa catatan: hanya alasannya', () {
      expect(
        chatReportContent(reasonLabel: 'Spam, iklan, atau promosi'),
        'Alasan: Spam, iklan, atau promosi.',
      );
    });

    test('catatan dipakai apa adanya (setelah di-trim)', () {
      expect(
        chatReportContent(
            reasonLabel: 'Kata kasar, ancaman, atau pelecehan',
            detail: '  Mengancam lewat chat  '),
        'Alasan: Kata kasar, ancaman, atau pelecehan.\n\n'
        'Catatan pelapor: Mengancam lewat chat',
      );
    });

    test('catatan berisi spasi saja tidak menghasilkan baris kosong', () {
      expect(
        chatReportContent(reasonLabel: 'Lainnya', detail: '   \n '),
        'Alasan: Lainnya.',
      );
    });

    test('pesan terkirim menjanjikan tenggat tindak lanjut', () {
      expect(chatReportSentMessage, contains('2×24 jam'));
    });
  });

  group('status blokir', () {
    test('tanpa blokir: kotak kirim aktif', () {
      expect(ChatBlockState.none.any, isFalse);
      expect(ChatBlockState.none.inputEnabled, isTrue);
    });

    test('blokir dari saya: kirim mati, tombolnya jadi "buka blokir"', () {
      const s = ChatBlockState(byMe: true);
      expect(s.any, isTrue);
      expect(s.inputEnabled, isFalse);
      expect(s.canUnblock, isTrue);
    });

    test('blokir dari lawan: kirim mati dan saya tidak bisa membukanya', () {
      const s = ChatBlockState(byPeer: true);
      expect(s.inputEnabled, isFalse);
      expect(s.canUnblock, isFalse);
    });

    test('kesetaraan dipakai untuk memutuskan render ulang', () {
      expect(const ChatBlockState(byMe: true),
          const ChatBlockState(byMe: true));
      expect(const ChatBlockState(byMe: true),
          isNot(const ChatBlockState(byPeer: true)));
    });

    test('keterangan menyebut nama lawan bicara dan tetap menawarkan lapor',
        () {
      expect(chatBlockedByMeNotice('Budi'), contains('Budi'));
      expect(chatBlockedByPeerNotice('Budi'), contains('Budi'));
      expect(chatBlockedByPeerNotice('Budi').toLowerCase(), contains('laporkan'));
    });

    test('konfirmasi blokir menyebut akibatnya lebih dulu', () {
      final body = chatBlockConfirmBody('Budi');
      expect(body, contains('Budi'));
      expect(body, contains('tidak bisa lagi mengirim pesan'));
      expect(body, contains('membuka blokir'));
    });
  });

  // ==========================================================================
  // Alur layar: menu ⋮ → lembar laporan, dan dialog blokir.
  // ==========================================================================

  group('ChatScreen — Laporkan & Blokir', () {
    late List<ChatReportReason> reported;
    late List<String?> details;
    late int blockCalls;
    late int unblockCalls;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
      reported = [];
      details = [];
      blockCalls = 0;
      unblockCalls = 0;
    });

    tearDown(ChatUnreadService.resetUntukUji);

    Booking booking({String technicianId = 'tech-1'}) => Booking(
          id: 'b1',
          code: 'SV-1001',
          serviceName: 'Service AC',
          subtotalPrice: 150000,
          appFee: 5000,
          discountAmount: 0,
          totalPrice: 155000,
          status: BookingStatus.paid,
          bookingDate: '2026-10-18',
          bookingTime: '08:00-10:00',
          address: 'Jl. Mawar 2',
          paymentMethod: 'transfer',
          userId: 'cust-1',
          technicianId: technicianId,
        );

    Future<void> pumpChat(
      WidgetTester tester, {
      ChatBlockState blocked = ChatBlockState.none,
    }) async {
      await tester.binding.setSurfaceSize(const Size(500, 1000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MaterialApp(
        home: ChatScreen(
          booking: booking(),
          myId: 'cust-1',
          peerName: 'Budi',
          // Semua jaringan diganti tiruan: tes tidak boleh menyentuh Supabase.
          loadMessages: (_) async => const <ChatMessage>[],
          subscribeMessages: (_, __) async => () async {},
          loadBlockState: (_) async => blocked,
          sendReport: ({required ChatReportReason reason, String? detail}) async {
            reported.add(reason);
            details.add(detail);
          },
          blockPeer: () async => blockCalls++,
          unblockPeer: () async => unblockCalls++,
        ),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('menu ⋮ menawarkan Laporkan dan Blokir', (tester) async {
      await pumpChat(tester);

      await tester.tap(find.byTooltip('Opsi percakapan'));
      await tester.pumpAndSettle();

      expect(find.text('Laporkan percakapan'), findsOneWidget);
      expect(find.text('Blokir Budi'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('laporan dikirim dengan alasan yang dipilih + catatan',
        (tester) async {
      await pumpChat(tester);

      await tester.tap(find.byTooltip('Opsi percakapan'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Laporkan percakapan'));
      await tester.pumpAndSettle();

      // Tanpa alasan, tombol kirim belum boleh bisa ditekan.
      final kirim = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(kirim.onPressed, isNull);

      await tester.tap(find.text('Penipuan atau minta bayar di luar aplikasi'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byType(TextField).last, 'Minta transfer ke rekening pribadi');
      await tester.tap(find.text('Kirim laporan'));
      await tester.pumpAndSettle();

      expect(reported.single.value, 'penipuan');
      expect(details.single, 'Minta transfer ke rekening pribadi');
      expect(find.text(chatReportSentMessage), findsOneWidget);
    });

    testWidgets('blokir: konfirmasi dulu, lalu chat dinonaktifkan',
        (tester) async {
      await pumpChat(tester);

      await tester.tap(find.byTooltip('Opsi percakapan'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Blokir Budi'));
      await tester.pumpAndSettle();

      // Batal → tidak ada yang diblokir.
      await tester.tap(find.text('Batal'));
      await tester.pumpAndSettle();
      expect(blockCalls, 0);

      await tester.tap(find.byTooltip('Opsi percakapan'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Blokir Budi'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Blokir').last);
      await tester.pumpAndSettle();

      expect(blockCalls, 1);
      expect(find.text(chatBlockedByMeNotice('Budi')), findsOneWidget);
      // Kotak tulis hilang, tetapi lapor tetap tersedia.
      expect(find.byType(TextField), findsNothing);
      expect(find.text('Laporkan'), findsOneWidget);
    });

    testWidgets('setelah diblokir, menu berubah menjadi "Buka blokir"',
        (tester) async {
      await pumpChat(tester);

      await tester.tap(find.byTooltip('Opsi percakapan'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Blokir Budi'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Blokir').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Opsi percakapan'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Buka blokir Budi'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Buka blokir').last);
      await tester.pumpAndSettle();

      expect(unblockCalls, 1);
      expect(find.text(chatBlockedByMeNotice('Budi')), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('diblokir LAWAN bicara: chat mati, jalan lapor tetap ada',
        (tester) async {
      await pumpChat(tester, blocked: const ChatBlockState(byPeer: true));

      expect(find.text(chatBlockedByPeerNotice('Budi')), findsOneWidget);
      expect(find.byType(TextField), findsNothing);

      await tester.tap(find.text('Laporkan'));
      await tester.pumpAndSettle();
      expect(find.text('Laporkan percakapan dengan Budi'), findsOneWidget);
    });
  });
}
