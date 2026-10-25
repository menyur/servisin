import 'package:flutter/material.dart';

import '../api.dart';
import '../push_service.dart';
import '../theme.dart';
import 'common.dart';

/// Satu peristiwa notifikasi yang bisa dinyalakan/dimatikan.
///
/// [key] HARUS sama dengan `PUSH_EVENTS` di `src/lib/push.js`. Server memakai
/// key ini untuk membaca `profiles.notification_prefs`; key yang tidak dikenal
/// diabaikan, jadi salah ketik berarti switch-nya tidak berefek.
class NotifEvent {
  final String key;
  final String label;
  final String desc;

  const NotifEvent(this.key, this.label, this.desc);
}

class NotifGroup {
  final String title;
  final List<NotifEvent> events;

  const NotifGroup(this.title, this.events);
}

/// Daftar peristiwa sesuai peran. Pelanggan tidak perlu switch pekerjaan/saldo
/// teknisi, dan teknisi tidak perlu switch pembayaran pelanggan.
List<NotifGroup> notificationGroupsFor({required bool isTechnician}) {
  if (isTechnician) {
    return const [
      NotifGroup('Akun teknisi', [
        NotifEvent('technician_approved', 'Akun disetujui',
            'Admin menyetujui pendaftaranmu — kamu bisa mulai mengambil pekerjaan.'),
        NotifEvent('technician_rejected', 'Pendaftaran ditolak',
            'Pendaftaran teknisi belum disetujui; periksa data di Profil.'),
      ]),
      NotifGroup('Pekerjaan', [
        NotifEvent('new_job_available', 'Pekerjaan baru tersedia',
            'Ada pesanan di area & keahlianmu yang bisa diambil.'),
        NotifEvent('booking_reminder', 'Pengingat jadwal H-1',
            'Pesan untuk tugas yang harus kamu kerjakan besok.'),
        NotifEvent('technician_assigned', 'Tugas ditugaskan',
            'Admin menugaskan pesanan atau kunjungan garansi kepadamu.'),
        NotifEvent('order_cancelled', 'Pesanan dibatalkan',
            'Tugas yang sudah diberikan dibatalkan; kabar menyebut dampaknya ke saldo.'),
        NotifEvent('order_rescheduled', 'Jadwal berubah',
            'Jadwal tugas yang kamu tangani dipindahkan admin.'),
        NotifEvent('job_released', 'Pesan tugas dilepas',
            'Ringkasan untuk admin saat kamu melepas tugas.'),
      ]),
      NotifGroup('Pesanan & chat', [
        NotifEvent('work_started', 'Pengerjaan dimulai', 'Status pesanan yang kamu tangani berubah.'),
        NotifEvent('order_completed', 'Pekerjaan selesai', 'Pesanan ditandai selesai dan pendapatan dicatat.'),
        NotifEvent('chat_message', 'Pesan chat baru', 'Pelanggan mengirim pesan tentang pesanan.'),
      ]),
      NotifGroup('Laporan', [
        NotifEvent('report_status', 'Status laporan berubah', 'Admin meninjau atau menyelesaikan laporanmu.'),
        NotifEvent('report_replied', 'Balasan admin', 'Admin menulis catatan pada laporanmu.'),
      ]),
      NotifGroup('Saldo', [
        NotifEvent('deposit_approved', 'Setoran disetujui', 'Bukti setor diterima dan saldo bertambah.'),
        NotifEvent('deposit_rejected', 'Setoran ditolak', 'Bukti setor perlu diperbaiki; alasannya ikut dikirim.'),
        NotifEvent('withdrawal_approved', 'Penarikan disetujui', 'Dana penarikan sudah ditransfer admin.'),
        NotifEvent('withdrawal_rejected', 'Penarikan ditolak', 'Penarikan ditolak dan saldo dikembalikan.'),
        NotifEvent('balance_credited', 'Saldo ditambahkan admin', 'Bonus atau koreksi saldo dari admin.'),
        NotifEvent('balance_reminder', 'Pengingat saldo / piutang', 'Saldo aktif kosong atau piutang jatuh tempo.'),
      ]),
      NotifGroup('Garansi', [
        NotifEvent('warranty_update', 'Keputusan klaim garansi', 'Klaim garansi pelanggan disetujui atau ditolak.'),
      ]),
    ];
  }
  return const [
    NotifGroup('Pesanan', [
      NotifEvent('payment_confirmed', 'Pembayaran dikonfirmasi', 'Admin menerima bukti pembayaranmu.'),
      NotifEvent('payment_rejected', 'Bukti pembayaran ditolak', 'Unggah ulang bukti pembayaran yang benar.'),
      NotifEvent('technician_assigned', 'Teknisi ditugaskan', 'Teknisi yang akan datang sudah ditentukan.'),
      NotifEvent('work_started', 'Pengerjaan dimulai', 'Teknisi mulai mengerjakan pesananmu.'),
      NotifEvent('order_completed', 'Pesanan selesai', 'Pekerjaan selesai — waktunya memberi penilaian.'),
      NotifEvent('order_cancelled', 'Pesanan dibatalkan', 'Pesanan dibatalkan teknisi/admin.'),
      NotifEvent('refund_update', 'Pengembalian dana',
          'Uang pesanan yang dibatalkan sedang diproses atau sudah ditransfer kembali.'),
      NotifEvent('booking_reminder', 'Pengingat jadwal H-1',
          'Pesan sehari sebelum teknisi datang ke lokasimu.'),
      NotifEvent('late_start', 'Pesanan terlambat dimulai',
          'Admin sedang mencarikan teknisi pengganti untuk pesananmu.'),
      NotifEvent('customer_no_show', 'Teknisi tidak menemukanmu',
          'Teknisi sudah tiba tetapi belum menemukanmu di lokasi.'),
      NotifEvent('extra_charge', 'Biaya tambahan perlu persetujuan',
          'Teknisi menemukan kerusakan lain; setujui atau tolak biayanya.'),
      NotifEvent('order_rescheduled', 'Jadwal berubah', 'Jadwal pesanan dipindahkan.'),
      NotifEvent('subscription_due', 'Pengingat servis berkala',
          'Langganan servis sudah jatuh tempo — pesan ulang kapan saja.'),
      NotifEvent('technician_near', 'Teknisi hampir tiba', 'Teknisi sudah dekat dengan lokasimu.'),
      NotifEvent('chat_message', 'Pesan chat baru', 'Teknisi mengirim pesan tentang pesanan.'),
    ]),
    NotifGroup('Voucher', [
      NotifEvent('voucher_received', 'Voucher baru',
          'Voucher dari penilaian atau admin langsung masuk ke tab Voucher.'),
    ]),
    NotifGroup('Laporan', [
      NotifEvent('report_status', 'Status laporan berubah', 'Admin meninjau atau menyelesaikan laporanmu.'),
      NotifEvent('report_replied', 'Balasan admin', 'Admin menulis catatan pada laporanmu.'),
    ]),
    NotifGroup('Garansi', [
      NotifEvent('warranty_update', 'Keputusan klaim garansi', 'Klaim garansi disetujui atau ditolak.'),
    ]),
  ];
}

/// Layar pengaturan notifikasi aplikasi.
///
/// Server sudah menyimpan preferensi per peristiwa di
/// `profiles.notification_prefs`; layar ini membuatnya bisa diatur dari HP
/// (sebelumnya hanya panel web yang bisa). Switch disimpan langsung, dan bila
/// gagal dikembalikan ke nilai lama supaya tampilan tidak berbohong.
class NotificationSettingsScreen extends StatefulWidget {
  final bool isTechnician;

  /// Seam uji — default memakai Api/PushService.
  final Future<Map<String, bool>> Function()? loadPrefs;
  final Future<void> Function(Map<String, bool> patch)? savePrefs;
  final Future<bool> Function()? loadPermission;
  final Future<bool> Function()? requestPermission;
  final Future<void> Function()? openSettings;

  const NotificationSettingsScreen({
    super.key,
    this.isTechnician = false,
    this.loadPrefs,
    this.savePrefs,
    this.loadPermission,
    this.requestPermission,
    this.openSettings,
  });

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  Map<String, bool> _prefs = {};
  bool _loading = true;
  bool _menyimpan = false;
  String? _error;
  bool? _izinHp;

  List<NotifGroup> get _groups => notificationGroupsFor(isTechnician: widget.isTechnician);

  List<NotifEvent> get _events => [for (final g in _groups) ...g.events];

  bool _aktif(String key) => _prefs[key] != false; // tidak ada key = aktif

  @override
  void initState() {
    super.initState();
    _muat();
  }

  Future<void> _muat() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final prefsFuture = (widget.loadPrefs ?? Api.fetchNotificationPrefs)();
      final izinFuture = (widget.loadPermission ?? PushService.hasNotificationPermission)();
      final prefs = await prefsFuture;
      final izin = await izinFuture;
      if (!mounted) return;
      setState(() {
        // Salin: loader uji bisa mengembalikan map const/unmodifiable.
        _prefs = Map<String, bool>.from(prefs);
        _izinHp = izin;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Gagal memuat pengaturan notifikasi.';
        _loading = false;
      });
    }
  }

  Future<void> _simpan(Map<String, bool> patch) async {
    final lama = Map<String, bool>.from(_prefs);
    setState(() {
      _prefs.addAll(patch);
      _menyimpan = true;
    });
    try {
      await (widget.savePrefs ?? Api.saveNotificationPrefs)(patch);
    } catch (e) {
      if (!mounted) return;
      setState(() => _prefs = lama);
      showSnackError(context, e, 'Gagal menyimpan pengaturan notifikasi.');
    } finally {
      if (mounted) setState(() => _menyimpan = false);
    }
  }

  Future<void> _ubah(NotifEvent e, bool value) => _simpan({e.key: value});

  Future<void> _ubahSemua(bool value) =>
      _simpan({for (final e in _events) e.key: value});

  Future<void> _mintaIzin() async {
    final izin = await (widget.requestPermission ?? PushService.requestNotificationPermission)();
    if (!mounted) return;
    setState(() => _izinHp = izin);
    if (!izin) {
      showSnack(context, 'Izin belum aktif. Buka setelan Android untuk mengizinkan notifikasi.');
    }
  }

  Future<void> _bukaSetelan() async {
    await (widget.openSettings ?? PushService.openNotificationSettings)();
    // Status izin bisa berubah setelah pengguna kembali dari setelan.
    final izin = await (widget.loadPermission ?? PushService.hasNotificationPermission)();
    if (!mounted) return;
    setState(() => _izinHp = izin);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        backgroundColor: AppColors.paper,
        foregroundColor: AppColors.navy,
        elevation: 0,
        title: const Text(
          'Notifikasi',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                _KartuIzin(izin: _izinHp, onMinta: _mintaIzin, onSetelan: _bukaSetelan),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: AppColors.coral)),
                ],
                const SizedBox(height: 12),
                _KartuUtama(
                  aktif: _events.every((e) => _aktif(e.key)),
                  menyimpan: _menyimpan,
                  onChanged: _ubahSemua,
                ),
                for (final g in _groups) ...[
                  const SizedBox(height: 18),
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 8),
                    child: Text(
                      g.title,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.inkSoft,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ),
                  Material(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    child: Column(
                      children: [
                        for (var i = 0; i < g.events.length; i++) ...[
                          if (i > 0) const Divider(height: 1, indent: 16, endIndent: 16),
                          SwitchListTile.adaptive(
                            key: ValueKey('notif-${g.events[i].key}'),
                            value: _aktif(g.events[i].key),
                            onChanged: _menyimpan
                                ? null
                                : (v) => _ubah(g.events[i], v),
                            title: Text(
                              g.events[i].label,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 14,
                                color: AppColors.navy,
                              ),
                            ),
                            subtitle: Text(
                              g.events[i].desc,
                              style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
                            ),
                            contentPadding:
                                const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                const Text(
                  'Notifikasi tetap dikirim hanya bila izin Android aktif. '
                  'Perubahan di sini langsung berlaku untuk perangkatmu.',
                  style: TextStyle(fontSize: 11.5, color: AppColors.inkSoft, height: 1.4),
                ),
              ],
            ),
    );
  }
}

class _KartuIzin extends StatelessWidget {
  final bool? izin;
  final VoidCallback onMinta;
  final VoidCallback onSetelan;

  const _KartuIzin({required this.izin, required this.onMinta, required this.onSetelan});

  @override
  Widget build(BuildContext context) {
    if (izin == true) {
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.mintTint,
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Row(children: [
          Icon(Icons.notifications_active_rounded, color: AppColors.mint, size: 22),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Notifikasi HP aktif. Kamu akan menerima pemberitahuan walau aplikasi tertutup.',
              style: TextStyle(fontSize: 12.5, color: AppColors.navy, height: 1.35),
            ),
          ),
        ]),
      );
    }
    if (izin == null) {
      return const SizedBox.shrink();
    }
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.amberTint,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.notifications_off_rounded, color: AppColors.amber, size: 22),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Notifikasi HP nonaktif',
              style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy),
            ),
          ),
        ]),
        const SizedBox(height: 6),
        const Text(
          'Pekerjaan baru, persetujuan setor, chat, dan laporan tidak akan terlihat sampai izin dinyalakan.',
          style: TextStyle(fontSize: 12.5, color: AppColors.navy, height: 1.35),
        ),
        const SizedBox(height: 10),
        Row(children: [
          // Expanded: tombol tema memakai minimumSize lebar tak hingga dan
          // akan mematikan layout bila berdiri langsung di dalam Row.
          Expanded(
            child: FilledButton.tonal(
              onPressed: onMinta,
              child: const Text('Izinkan'),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(onPressed: onSetelan, child: const Text('Setelan Android')),
        ]),
      ]),
    );
  }
}

class _KartuUtama extends StatelessWidget {
  final bool aktif;
  final bool menyimpan;
  final ValueChanged<bool> onChanged;

  const _KartuUtama({required this.aktif, required this.menyimpan, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: SwitchListTile.adaptive(
        value: aktif,
        onChanged: menyimpan ? null : onChanged,
        secondary: const Icon(Icons.tune_rounded, color: AppColors.brand),
        title: const Text(
          'Semua notifikasi',
          style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy),
        ),
        subtitle: Text(
          aktif ? 'Semua peristiwa di bawah aktif' : 'Beberapa peristiwa dimatikan',
          style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
        ),
      ),
    );
  }
}
