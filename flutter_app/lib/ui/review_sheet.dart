import 'package:flutter/material.dart';

import '../theme.dart';

/// Hasil penilaian dari sheet: rating bintang + komentar (boleh KOSONG).
class ReviewInput {
  final int rating;

  /// Sudah di-trim; string kosong = pelanggan menilai TANPA komentar.
  final String comment;

  const ReviewInput({required this.rating, required this.comment});
}

/// Sheet "Nilai Teknisi" untuk pelanggan: pilih 1–5 bintang (default 5) dan
/// tulis ulasan yang **opsional** — mengirim tanpa komentar tetap sah.
/// Return null bila pelanggan membatalkan (menutup sheet tanpa mengirim).
///
/// Dipisah sebagai fungsi agar bisa diuji langsung: dengan komentar maupun
/// tanpa komentar.
Future<ReviewInput?> showReviewSheet(
  BuildContext context, {
  String? technicianName,
}) {
  return showModalBottomSheet<ReviewInput>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) => _ReviewSheet(technicianName: technicianName),
  );
}

/// Isi sheet. Controller komentar dimiliki oleh State ini agar dibuang saat
/// widget benar-benar dilepas — bukan saat `Navigator.pop` dipanggil, karena
/// `TextField` masih ikut rebuild selama animasi tutup berjalan.
class _ReviewSheet extends StatefulWidget {
  const _ReviewSheet({this.technicianName});

  final String? technicianName;

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  static const _starColor = Color(0xFFC97F16);

  int _rating = 5;
  final _commentCtrl = TextEditingController();

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.pop(
      context,
      ReviewInput(rating: _rating, comment: _commentCtrl.text.trim()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Nilai Teknisi',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 4),
              Text(widget.technicianName ?? '',
                  style: const TextStyle(color: AppColors.inkSoft)),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  5,
                  (i) => IconButton(
                    iconSize: 36,
                    // Ketuk bintang ke-i untuk memberi nilai i+1.
                    onPressed: () => setState(() => _rating = i + 1),
                    icon: Icon(
                      i < _rating
                          ? Icons.star_rounded
                          : Icons.star_outline_rounded,
                      color: _starColor,
                    ),
                  ),
                ),
              ),
              TextField(
                controller: _commentCtrl,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'Ulasan (opsional)'),
              ),
              const SizedBox(height: 14),
              FilledButton(
                onPressed: _submit,
                child: const Text('Kirim penilaian'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
