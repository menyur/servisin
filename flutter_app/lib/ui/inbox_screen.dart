import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../inbox.dart';
import '../theme.dart';
import 'balance_screen.dart';
import 'common.dart';
import 'order_detail_screen.dart';

/// Layar Kotak Masuk Notifikasi (dibuka dari ikon lonceng di header tab
/// Pekerjaan): menggabungkan kabar saldo, status pesanan, dan balasan laporan
/// dalam satu daftar berurutan waktu.
///
/// Saat dibuka, semua kabar ditandai sudah dibaca — termasuk penyimpanan sumber
/// kabar saldo & laporan — sehingga lonceng, banner saldo, badge Laporan, dan
/// badge Pesanan tidak lagi mengklaim ada yang belum dibaca. Penanda "Baru"
/// pada daftar TETAP tampil selama layar ini terbuka agar pengguna tahu mana
/// yang baru; tombol "Tandai semua sudah dibaca" di atas daftar menghapus
/// penanda itu sekaligus, tanpa perlu membuka satu per satu pesanannya.
class InboxScreen extends StatefulWidget {
  const InboxScreen({
    super.key,
    this.loadInbox,
    this.markSeen,
    this.technician = true,
  });

  /// Peran pembaca: menentukan sumber pesanan (tugas teknisi vs pesanan
  /// pelanggan), teks kabarnya, dan tab Laporan yang dibuka saat diketuk.
  final bool technician;

  /// Seam uji: sumber data kotak masuk. Default [loadInbox] (modul inbox).
  final Future<InboxData> Function()? loadInbox;

  /// Seam uji: tandai sudah dibaca. Default [markInboxRead] + turunkan badge.
  final Future<void> Function(InboxData data)? markSeen;

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  InboxData? _data;
  String? _error;
  bool _loading = true;

  /// Filter jenis kabar; null = semua.
  InboxKind? _filter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await (widget.loadInbox ??
          () => loadInbox(technician: widget.technician))();
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
      await _markSeen(data);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyNetworkError(e) ??
            'Gagal memuat kotak masuk. Tarik ke bawah untuk mencoba lagi.';
        _loading = false;
      });
    }
  }

  /// Tandai semua kabar sudah dibaca (hanya bila ada yang baru).
  Future<void> _markSeen(InboxData data) async {
    if (!data.hasUnread) return;
    try {
      final mark = widget.markSeen;
      if (mark != null) {
        await mark(data);
        return;
      }
      await markInboxRead(data);
      _nolkanSemuaBadge();
    } catch (_) {
      // Gagal menandai = kabar muncul lagi lain kali; layar tetap terpakai.
    }
  }

  /// Turunkan semua angka notifikasi yang sumbernya sudah dibaca di layar ini.
  ///
  /// Kotak masuk memuat SEMUA kabar pesanan milik pengguna, jadi membacanya di
  /// sini sama dengan membuka daftar Pesanan — badge tab Pesanan ikut nol dan
  /// pengguna tidak perlu membuka tiap pesanan untuk menghilangkannya.
  void _nolkanSemuaBadge() {
    unseenInboxUpdates.value = 0;
    unseenBookingUpdates.value = 0;
    unseenBalanceNotices.value = 0;
    unseenReportUpdates.value = 0;
  }

  /// Tombol "Tandai semua sudah dibaca": hapus penanda "Baru" dari seluruh
  /// kartu SEKETIKA, simpan status baca ke semua sumber, lalu nolkan badge.
  /// Tanpa memuat ulang daftar, sehingga pengguna tidak perlu membuka setiap
  /// pesanan hanya untuk menghilangkan penandanya.
  Future<void> _tandaiSemuaDibaca() async {
    final data = _data;
    if (data == null || !data.hasUnread) return;
    setState(() => _data = data.allRead());
    await _markSeen(data);
    if (mounted) showSnack(context, 'Semua kabar ditandai sudah dibaca.');
  }

  Future<void> _openItem(InboxItem item) async {
    if (item.kind == InboxKind.saldo) {
      await Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const BalanceScreen()),
      );
      return;
    }
    if (item.kind == InboxKind.pesanan || item.kind == InboxKind.refund) {
      final id = item.bookingId;
      if (id == null || id.isEmpty) return;
      try {
        final booking = await Api.fetchBookingById(id);
        if (!mounted || booking == null) return;
        await Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => OrderDetailScreen(booking: booking)),
        );
      } catch (e) {
        if (mounted) {
          showSnackError(context, e, 'Gagal membuka pesanan.');
        }
      }
      return;
    }
    // Laporan: kembali ke shell lalu buka tab Laporan sesuai peran.
    mainTabIndex.value = reportsTabIndex(widget.technician);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        backgroundColor: AppColors.brandDeep,
        foregroundColor: Colors.white,
        centerTitle: true,
        title: const Text('Kotak Masuk'),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(bottom: Radius.circular(22)),
        ),
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_loading) {
      return ListView(children: const [ScreenStateView(loading: true)]);
    }
    final data = _data;
    if (_error != null || data == null) {
      return ListView(children: [
        ScreenStateView(loading: false, error: _error, onRetry: _load),
      ]);
    }

    final items = data.ofKind(_filter);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
        children: [
          if (data.hasUnread) ...[
            _MarkAllReadBar(onTap: _tandaiSemuaDibaca),
            const SizedBox(height: 10),
          ],
          _FilterRow(
            data: data,
            selected: _filter,
            onSelect: (k) => setState(() => _filter = k),
          ),
          const SizedBox(height: 12),
          if (items.isEmpty)
            const ScreenStateView(
              loading: false,
              empty: true,
              emptyMessage:
                  'Belum ada notifikasi di sini.\nKabar pesanan, pengembalian dana, balasan laporan, dan keputusan saldo akan muncul di kotak masuk ini.',
            )
          else
            for (final item in items)
              _InboxTile(item: item, onTap: () => _openItem(item)),
        ],
      ),
    );
  }
}

/// Baris aksi "Tandai semua sudah dibaca" di atas daftar.
///
/// Hanya dirender selagi ada kabar bertanda "Baru" — begitu ditekan, seluruh
/// penanda hilang dan baris ini ikut lenyap (tidak ada aksi yang tersisa).
class _MarkAllReadBar extends StatelessWidget {
  final VoidCallback onTap;

  const _MarkAllReadBar({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.line),
          ),
          child: const Row(children: [
            Icon(Icons.done_all_rounded, size: 18, color: AppColors.brand),
            SizedBox(width: 9),
            Expanded(
              child: Text(
                'Tandai semua sudah dibaca',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.navy,
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Baris filter jenis kabar: Semua / Saldo / Pesanan / Laporan.
class _FilterRow extends StatelessWidget {
  final InboxData data;
  final InboxKind? selected;
  final ValueChanged<InboxKind?> onSelect;

  const _FilterRow({
    required this.data,
    required this.selected,
    required this.onSelect,
  });

  int _count(InboxKind? kind) => data.ofKind(kind).length;

  @override
  Widget build(BuildContext context) {
    // Hanya jenis yang benar-benar ada isinya: pelanggan tidak perlu melihat
    // tab "Saldo 0" karena saldo adalah urusan teknisi.
    final ada = {for (final item in data.items) item.kind};
    final pilihan = <InboxKind?>[null, ...InboxKind.values.where(ada.contains)];
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final k in pilihan)
        _FilterPill(
          label: '${k == null ? 'Semua' : inboxKindLabel(k)} ${_count(k)}',
          selected: selected == k,
          onTap: () => onSelect(k),
        ),
    ]);
  }
}

class _FilterPill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? AppColors.brand : Colors.white,
          borderRadius: BorderRadius.circular(999),
          border:
              Border.all(color: selected ? AppColors.brand : AppColors.line),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : AppColors.navy,
          ),
        ),
      ),
    );
  }
}

/// Satu kartu kabar di kotak masuk.
class _InboxTile extends StatelessWidget {
  final InboxItem item;
  final VoidCallback onTap;

  const _InboxTile({required this.item, required this.onTap});

  (Color, Color) get _colors => switch (item.kind) {
        InboxKind.saldo => (AppColors.amber, AppColors.amberTint),
        InboxKind.pesanan => (AppColors.brand, AppColors.brandTint),
        InboxKind.refund => (AppColors.coral, AppColors.coralTint),
        InboxKind.laporan => (AppColors.mint, AppColors.mintTint),
      };

  IconData get _icon => switch (item.kind) {
        InboxKind.saldo => Icons.account_balance_wallet_rounded,
        InboxKind.pesanan => Icons.assignment_rounded,
        InboxKind.refund => Icons.currency_exchange_rounded,
        InboxKind.laporan => Icons.forum_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = _colors;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border:
            Border.all(color: item.unread ? AppColors.amber : AppColors.line),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
              child: Icon(_icon, size: 16, color: fg),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text(item.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w800,
                                color: AppColors.navy)),
                      ),
                      if (item.unread) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.amberTint,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Text('Baru',
                              style: TextStyle(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.amber)),
                        ),
                      ],
                    ]),
                    const SizedBox(height: 3),
                    Text(item.body,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11.5,
                            color: AppColors.inkSoft,
                            height: 1.35)),
                    const SizedBox(height: 4),
                    Text(formatDateTimeId(item.at),
                        style: const TextStyle(
                            fontSize: 10.5, color: AppColors.inkSoft)),
                  ]),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right_rounded,
                size: 18, color: AppColors.inkSoft),
          ]),
        ),
      ),
    );
  }
}

/// Lonceng kotak masuk untuk header tab Pekerjaan: angka kabar yang belum
/// dibaca (dipotong `9+`), hilang saat semuanya sudah dibaca.
class InboxBell extends StatelessWidget {
  final int unread;
  final VoidCallback onTap;

  const InboxBell({super.key, required this.unread, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Badge(
      isLabelVisible: unread > 0,
      label: Text(unread > 9 ? '9+' : '$unread'),
      backgroundColor: AppColors.amber,
      child: IconButton(
        onPressed: onTap,
        tooltip: 'Kotak masuk notifikasi',
        icon: const Icon(Icons.notifications_none_rounded, color: Colors.white),
      ),
    );
  }
}
