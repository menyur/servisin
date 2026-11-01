import 'package:flutter/material.dart';

import '../theme.dart';

/// Kartu "alamat belum diisi" di beranda pelanggan.
///
/// Kenapa perlu: alamat hanya terisi lewat FORMULIR PENDAFTARAN email
/// (`register_screen.dart` → `POST /api/auth/register`). Pelanggan yang daftar
/// lewat **Google** tidak pernah melewati formulir itu — Google tidak
/// mengirim alamat — sehingga `profiles.address` tetap kosong sampai ia
/// mengetiknya sendiri di layar Profil. Akibatnya wizard pesanan tidak bisa
/// mengisi alamat otomatis dan panel admin menampilkan "alamat belum diisi".
///
/// Kartu ini menutup celah itu: menetap sampai alamat benar-benar tersimpan,
/// dengan satu tombol yang membuka isian alamat.
///
/// Widget ini sengaja tanpa jaringan/API: pemanggil yang menyiapkan alamat dan
/// menyimpannya lewat [onIsi], sehingga kartunya bisa diuji langsung.
class AddressReminderCard extends StatelessWidget {
  /// Alamat profil saat ini. Kosong/null = kartu tampil.
  final String? address;

  /// Membuka isian alamat (beranda menyediakan dialog + penyimpanannya).
  final VoidCallback onIsi;

  const AddressReminderCard({
    super.key,
    required this.address,
    required this.onIsi,
  });

  /// Apakah pengguna ini perlu diminta melengkapi alamat?
  ///
  /// Dipisah sebagai fungsi murni supaya aturannya bisa diuji tanpa widget.
  static bool perlu(String? address) => (address ?? '').trim().isEmpty;

  @override
  Widget build(BuildContext context) {
    if (!perlu(address)) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
      decoration: BoxDecoration(
        color: AppColors.brandTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.25)),
      ),
      child: Row(children: [
        const Icon(Icons.location_on_rounded, size: 22, color: AppColors.brand),
        const SizedBox(width: 9),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Alamat belum diisi',
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.navy,
                ),
              ),
              SizedBox(height: 2),
              // Menjelaskan manfaatnya, bukan sekadar meminta data.
              Text(
                'Simpan alamatmu sekali agar pesanan berikutnya terisi otomatis.',
                style: TextStyle(
                    fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        // Lebar dipatok: tema global memakai Size.fromHeight (tak hingga) yang
        // mematikan layout di dalam Row — pola sama dengan ReviewReminderCard.
        FilledButton(
          onPressed: onIsi,
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 34),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            visualDensity: VisualDensity.compact,
            textStyle:
                const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
          ),
          child: const Text('Isi alamat'),
        ),
      ]),
    );
  }
}

/// Isian alamat satu kolom: mengembalikan alamat yang diketik (sudah di-trim)
/// atau `null` bila pengguna membatalkan.
///
/// Dipisah dari [AddressReminderCard] supaya bisa diuji tanpa jaringan —
/// penyimpanannya tetap di pemanggil (`Api.updateMyProfile`).
Future<String?> showAddressInputDialog(
  BuildContext context, {
  String? initial,
}) =>
    showDialog<String>(
      context: context,
      builder: (_) => _AddressDialog(initial: initial),
    );

/// Isi dialog dimiliki widget sendiri supaya `TextEditingController` baru
/// dibuang setelah rutenya benar-benar lepas. Membuangnya tepat setelah
/// `showDialog` selesai (saat animasi tutup masih berjalan) memicu
/// "A TextEditingController was used after being disposed" pada rebuild.
class _AddressDialog extends StatefulWidget {
  final String? initial;

  const _AddressDialog({this.initial});

  @override
  State<_AddressDialog> createState() => _AddressDialogState();
}

class _AddressDialogState extends State<_AddressDialog> {
  late final _ctrl = TextEditingController(text: (widget.initial ?? '').trim());
  final _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Alamat untuk pesanan'),
      content: Form(
        key: _form,
        child: TextFormField(
          controller: _ctrl,
          autofocus: true,
          minLines: 2,
          maxLines: 4,
          // Batas 300 karakter sama dengan RPC buku alamat
          // (migrate-customer-address-book.sql) supaya alamat yang tersimpan
          // di sini selalu bisa dipakai fitur itu.
          maxLength: 300,
          decoration: const InputDecoration(
            labelText: 'Alamat lengkap',
            hintText: 'Nama jalan, nomor rumah, kelurahan, kota',
            prefixIcon: Icon(Icons.location_on_outlined),
          ),
          validator: (v) {
            final t = (v ?? '').trim();
            if (t.length < 5) return 'Alamat terlalu pendek (minimal 5 karakter)';
            return null;
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Nanti'),
        ),
        TextButton(
          onPressed: () {
            if (_form.currentState?.validate() != true) return;
            Navigator.pop(context, _ctrl.text.trim());
          },
          child: const Text('Simpan'),
        ),
      ],
    );
  }
}
