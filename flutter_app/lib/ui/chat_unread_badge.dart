import 'package:flutter/material.dart';

import '../theme.dart';

/// Lencana angka pesan chat belum dibaca untuk tombol chat.
///
/// Angka dipotong menjadi `9+` seperti badge navigasi lain; pembaca layar tetap
/// mendengar jumlah sebenarnya lewat [semanticsLabel].
class ChatUnreadBadge extends StatelessWidget {
  final int count;
  final String? semanticsLabel;

  const ChatUnreadBadge({super.key, required this.count, this.semanticsLabel});

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return const SizedBox.shrink();
    return Semantics(
      label: semanticsLabel ?? '$count pesan chat belum dibaca',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.coral,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: Colors.white, width: 1.5),
        ),
        child: Text(
          count > 9 ? '9+' : '$count',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10.5,
            height: 1.1,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}
