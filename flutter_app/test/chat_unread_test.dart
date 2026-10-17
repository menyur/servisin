import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/chat_unread.dart';
import 'package:fixify_app/models.dart';

ChatMessage _pesan({
  required String id,
  required String booking,
  required String sender,
  required DateTime at,
}) =>
    ChatMessage(
      id: id,
      bookingId: booking,
      senderId: sender,
      body: 'pesan $id',
      createdAt: at,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    ChatUnreadService.resetUntukUji();
  });

  group('hitungChatBelumDibacaPerPesanan', () {
    final t0 = DateTime(2026, 10, 18, 9);

    test('pesan sendiri tidak pernah dihitung', () {
      final hasil = hitungChatBelumDibacaPerPesanan(
        messages: [
          _pesan(id: '1', booking: 'b1', sender: 'saya', at: t0),
          _pesan(id: '2', booking: 'b1', sender: 'lawan', at: t0),
        ],
        myId: 'saya',
        lastRead: const {},
      );

      expect(hasil, {'b1': 1});
      expect(totalChatBelumDibaca(hasil), 1);
    });

    test('tanpa penanda baca: semua pesan lawan dihitung', () {
      final hasil = hitungChatBelumDibacaPerPesanan(
        messages: [
          _pesan(id: '1', booking: 'b1', sender: 'lawan', at: t0),
          _pesan(
              id: '2',
              booking: 'b1',
              sender: 'lawan',
              at: t0.add(const Duration(minutes: 1))),
          _pesan(id: '3', booking: 'b2', sender: 'lawan', at: t0),
        ],
        myId: 'saya',
        lastRead: const {},
      );

      expect(hasil, {'b1': 2, 'b2': 1});
    });

    test('hanya pesan SETELAH penanda baca yang dihitung', () {
      final hasil = hitungChatBelumDibacaPerPesanan(
        messages: [
          _pesan(id: 'lama', booking: 'b1', sender: 'lawan', at: t0),
          _pesan(
              id: 'tepat',
              booking: 'b1',
              sender: 'lawan',
              at: t0.add(const Duration(minutes: 1))),
          _pesan(
              id: 'baru',
              booking: 'b1',
              sender: 'lawan',
              at: t0.add(const Duration(minutes: 2))),
        ],
        myId: 'saya',
        lastRead: {'b1': t0.add(const Duration(minutes: 1))},
      );

      // Pesan tepat pada waktu baca sudah dianggap terbaca; hanya "baru" yang sisa.
      expect(hasil, {'b1': 1});
    });

    test('penanda baca satu pesanan tidak memengaruhi pesanan lain', () {
      final hasil = hitungChatBelumDibacaPerPesanan(
        messages: [
          _pesan(id: '1', booking: 'b1', sender: 'lawan', at: t0),
          _pesan(id: '2', booking: 'b2', sender: 'lawan', at: t0),
        ],
        myId: 'saya',
        lastRead: {'b1': t0.add(const Duration(minutes: 1))},
      );

      expect(hasil, {'b2': 1});
      expect(totalChatBelumDibaca(hasil), 1);
    });

    test('daftar kosong menghasilkan peta kosong, bukan error', () {
      expect(
        hitungChatBelumDibacaPerPesanan(
          messages: const [],
          myId: 'saya',
          lastRead: const {},
        ),
        isEmpty,
      );
      expect(totalChatBelumDibaca(const {}), 0);
    });
  });

  group('ChatUnreadService', () {
    test('pesan masuk menambah angka pesanan itu dan total', () {
      ChatUnreadService.debugSetSesi('saya');

      ChatUnreadService.onIncoming('b1');
      ChatUnreadService.onIncoming('b1');
      ChatUnreadService.onIncoming('b2');

      expect(ChatUnreadService.countFor('b1'), 2);
      expect(ChatUnreadService.countFor('b2'), 1);
      expect(ChatUnreadService.total.value, 3);
    });

    test('pesan realtime yang sama tidak dihitung dua kali', () {
      ChatUnreadService.debugSetSesi('saya');

      // FCM + realtime bisa sama-sama melaporkan satu pesan yang sama.
      ChatUnreadService.onIncoming('b1', messageId: 'm-1');
      ChatUnreadService.onIncoming('b1', messageId: 'm-1');
      ChatUnreadService.onIncoming('b1', messageId: 'm-2');

      expect(ChatUnreadService.countFor('b1'), 2);
      expect(ChatUnreadService.total.value, 2);
    });

    test('event realtime terlambat untuk pesan yang sudah dibaca diabaikan',
        () {
      final t0 = DateTime(2026, 10, 18, 9);
      ChatUnreadService.debugSetSesi(
        'saya',
        lastRead: {'b1': t0.add(const Duration(minutes: 2))},
      );

      ChatUnreadService.onIncoming(
        'b1',
        messageId: 'm-lama',
        at: t0.add(const Duration(minutes: 1)),
      );
      expect(ChatUnreadService.countFor('b1'), 0);

      ChatUnreadService.onIncoming(
        'b1',
        messageId: 'm-baru',
        at: t0.add(const Duration(minutes: 3)),
      );
      expect(ChatUnreadService.countFor('b1'), 1);
    });

    test('membuka chat menolkan pesanan itu, pesanan lain tetap', () async {
      ChatUnreadService.debugSetSesi(
        'saya',
        counts: const {'b1': 2, 'b2': 1},
      );

      await ChatUnreadService.enterChat('b1');

      expect(ChatUnreadService.countFor('b1'), 0);
      expect(ChatUnreadService.countFor('b2'), 1);
      expect(ChatUnreadService.total.value, 1);
    });

    test('pesan masuk saat layar chat pesanan itu terbuka tidak menambah badge',
        () async {
      ChatUnreadService.debugSetSesi('saya');
      await ChatUnreadService.enterChat('b1');

      ChatUnreadService.onIncoming('b1');
      ChatUnreadService.onIncoming('b2');

      expect(ChatUnreadService.countFor('b1'), 0,
          reason: 'pesan langsung terlihat di layar chat');
      expect(ChatUnreadService.countFor('b2'), 1);
      expect(ChatUnreadService.total.value, 1);
    });

    test('setelah keluar chat, pesan berikutnya dihitung lagi', () async {
      ChatUnreadService.debugSetSesi('saya');
      await ChatUnreadService.enterChat('b1');
      await ChatUnreadService.leaveChat('b1');

      ChatUnreadService.onIncoming('b1');

      expect(ChatUnreadService.countFor('b1'), 1);
    });

    test('clear menghapus badge memori (logout)', () async {
      ChatUnreadService.debugSetSesi('saya', counts: const {'b1': 4});
      await ChatUnreadService.clear();

      expect(ChatUnreadService.total.value, 0);
      expect(ChatUnreadService.countFor('b1'), 0);
    });

    test('perubahan angka diteruskan ke badge ikon aplikasi', () async {
      const kanal = MethodChannel('g123k/flutter_app_badger');
      final panggilan = <MethodCall>[];
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(kanal, (call) async {
        panggilan.add(call);
        if (call.method == 'isAppBadgeSupported') return true;
        return null;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(kanal, null));

      ChatUnreadService.debugSetSesi('saya');
      ChatUnreadService.onIncoming('b1');
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(
        panggilan.any((c) =>
            c.method == 'updateBadgeCount' &&
            (c.arguments as Map)['count'] == 1),
        isTrue,
        reason: 'total belum dibaca harus menjadi angka badge launcher',
      );

      await ChatUnreadService.markRead('b1');
      expect(
        panggilan.any((c) => c.method == 'removeBadge'),
        isTrue,
        reason: 'semua pesan dibaca → badge launcher dibersihkan',
      );
    });
  });

  group('ChatUnreadStore', () {
    test('menyimpan angka + penanda baca dan membacanya kembali', () async {
      final t = DateTime.utc(2026, 10, 18, 10, 30);
      await ChatUnreadStore.write(
        'u-1',
        ChatUnreadSnapshot(
          counts: const {'b1': 2, 'b2': 1},
          lastRead: {'b1': t},
          bootstrapped: true,
        ),
      );

      final snapshot = await ChatUnreadStore.read('u-1');
      expect(snapshot.counts, {'b1': 2, 'b2': 1});
      expect(snapshot.lastRead['b1']!.isAtSameMomentAs(t), isTrue);
      expect(snapshot.bootstrapped, isTrue);
    });

    test('snapshot satu pengguna tidak bocor ke pengguna lain', () async {
      await ChatUnreadStore.write(
        'u-1',
        const ChatUnreadSnapshot(counts: {'b1': 3}, bootstrapped: true),
      );

      expect((await ChatUnreadStore.read('u-2')).counts, isEmpty);
    });

    test('nilai rusak / JSON bukan objek dianggap kosong', () async {
      SharedPreferences.setMockInitialValues({
        ChatUnreadStore.keyFor('rusak'): 'bukan-json',
        ChatUnreadStore.keyFor('daftar'): '[1,2]',
        ChatUnreadStore.keyFor('angka-negatif'):
            '{"counts":{"b1":-2,"b2":3},"lastRead":{"b3":"bukan-tanggal"}}',
      });

      expect((await ChatUnreadStore.read('rusak')).counts, isEmpty);
      expect((await ChatUnreadStore.read('daftar')).counts, isEmpty);
      final negatif = await ChatUnreadStore.read('angka-negatif');
      expect(negatif.counts, {'b2': 3}, reason: 'angka negatif dibuang');
      expect(negatif.lastRead, isEmpty, reason: 'tanggal rusak dibuang');
    });

    test('uid kosong tidak menyentuh preferensi', () async {
      await ChatUnreadStore.write(
          '', const ChatUnreadSnapshot(counts: {'b1': 1}));
      expect((await ChatUnreadStore.read('')).counts, isEmpty);
    });

    test('hapus membersihkan snapshot akun itu saja', () async {
      await ChatUnreadStore.write(
        'u-1',
        const ChatUnreadSnapshot(counts: {'b1': 1}),
      );
      await ChatUnreadStore.write(
        'u-2',
        const ChatUnreadSnapshot(counts: {'b2': 1}),
      );

      await ChatUnreadStore.hapus('u-1');

      expect((await ChatUnreadStore.read('u-1')).counts, isEmpty);
      expect((await ChatUnreadStore.read('u-2')).counts, {'b2': 1});
    });
  });
}
