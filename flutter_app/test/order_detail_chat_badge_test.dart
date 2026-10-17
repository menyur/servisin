import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/chat_unread.dart';
import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/chat_unread_badge.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

Booking _booking({String? technicianId = 'tech-1'}) => Booking(
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

Future<void> _pump(WidgetTester tester, Booking booking) async {
  await tester.binding.setSurfaceSize(const Size(600, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: OrderDetailScreen(
      booking: booking,
      currentUserId: () => 'cust-1',
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  tearDown(ChatUnreadService.resetUntukUji);

  testWidgets('tombol Chat Teknisi menampilkan jumlah pesan belum dibaca',
      (tester) async {
    ChatUnreadService.debugSetSesi('cust-1', counts: const {'b1': 3});
    await _pump(tester, _booking());

    final badge = tester.widget<ChatUnreadBadge>(
      find.byType(ChatUnreadBadge),
    );
    expect(badge.count, 3);
    expect(find.text('Chat Teknisi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tanpa pesan belum dibaca, tombol chat tetap tanpa badge',
      (tester) async {
    ChatUnreadService.debugSetSesi('cust-1');
    await _pump(tester, _booking());

    expect(find.byType(ChatUnreadBadge), findsNothing);
    expect(find.text('Chat Teknisi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pesanan tanpa teknisi tidak punya tombol chat', (tester) async {
    ChatUnreadService.debugSetSesi('cust-1', counts: const {'b1': 3});
    await _pump(tester, _booking(technicianId: null));

    expect(find.text('Chat Teknisi'), findsNothing);
    expect(find.byType(ChatUnreadBadge), findsNothing);
  });
}
