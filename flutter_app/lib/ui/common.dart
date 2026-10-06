import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import 'home_screen.dart';
import 'jobs_screen.dart';
import 'orders_screen.dart';
import 'reports_screen.dart';
import 'vouchers_screen.dart';
import 'profile_screen.dart';

/// Warna aksen status pesanan (dipakai kartu Pesanan & Laporan).
Color statusAccent(BookingStatus s) => switch (s) {
      BookingStatus.completed => AppColors.mint,
      BookingStatus.cancelled => AppColors.coral,
      BookingStatus.pending => AppColors.amber,
      _ => AppColors.brand,
    };

/// Header gradien untuk halaman tab (pengganti AppBar): judul besar +
/// subjudul + aksi kanan-atas opsional. Sudut bawah membulat.
class ScreenHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  final List<Widget>? actions;
  final Widget? leading;
  final Widget? bottom;

  const ScreenHeader({
    super.key,
    required this.title,
    this.subtitle = '',
    this.actions,
    this.leading,
    this.bottom,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(8, 12, 8, bottom != null ? 18 : 24),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.brandDeep, AppColors.brand],
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(30)),
      ),
      child: Column(children: [
        Row(children: [
          if (leading != null) leading!,
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(left: leading != null ? 8 : 16),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            color: Colors.white)),
                    if (subtitle.isNotEmpty)
                      Text(subtitle,
                          style: TextStyle(
                              fontSize: 12.5,
                              color: Colors.white.withValues(alpha: 0.85))),
                  ]),
            ),
          ),
          if (actions != null) ...actions!,
        ]),
        if (bottom != null) bottom!,
      ]),
    );
  }
}

/// Kartu konten putih yang menimpa header gradien (offset -24).
class FloatingCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;

  const FloatingCard({super.key, required this.child, this.padding = const EdgeInsets.all(14)});

  @override
  Widget build(BuildContext context) {
    return Transform.translate(
      offset: const Offset(0, -24),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16),
        padding: padding,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.line),
          boxShadow: [
            BoxShadow(
              color: AppColors.navy.withValues(alpha: 0.07),
              blurRadius: 20,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: child,
      ),
    );
  }
}

/// Badge status pesanan dengan warna semantik (mint=selesai, amber=diproses, coral=ditolak).
class StatusBadge extends StatelessWidget {
  final BookingStatus status;
  const StatusBadge(this.status, {super.key});

  Color get _bg => switch (status) {
        BookingStatus.completed => AppColors.mintTint,
        BookingStatus.cancelled => AppColors.coralTint,
        BookingStatus.pending => AppColors.amberTint,
        _ => AppColors.brandTint,
      };

  Color get _fg => switch (status) {
        BookingStatus.completed => AppColors.mint,
        BookingStatus.cancelled => AppColors.coral,
        BookingStatus.pending => AppColors.amber,
        _ => AppColors.brandDeep,
      };

  @override
  Widget build(BuildContext context) =>
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: _bg, borderRadius: BorderRadius.circular(999)),
        child: Text(status.label,
            style: TextStyle(color: _fg, fontSize: 11, fontWeight: FontWeight.w700)),
      );
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(message),
    backgroundColor: error ? AppColors.coral : null,
  ));
}

/// Pesan error ramah untuk exception jaringan — menggantikan dump teknis
/// seperti "ClientException with SocketException: Failed host lookup:
/// 'xxx.supabase.co' (OS Error: No address associated with hostname, errno = 7)"
/// yang muncul saat HP tidak punya internet / DNS gagal.
/// Return null bila [e] bukan error jaringan (pakai pesan aslinya).
String? friendlyNetworkError(Object e) {
  final m = e.toString().toLowerCase();
  if (m.contains('socketexception') ||
      m.contains('failed host lookup') ||
      m.contains('clientexception') ||
      m.contains('no address associated') ||
      m.contains('errno = 7') ||
      m.contains('connection refused') ||
      m.contains('network is unreachable') ||
      m.contains('connection reset') ||
      m.contains('timed out') ||
      m.contains('broken pipe')) {
    return 'Tidak ada koneksi internet.\nPeriksa WiFi/data lalu coba lagi.';
  }
  return null;
}

/// showSnack dengan terjemahan error jaringan: bila [error] adalah exception
/// jaringan, tampilkan pesan ramah (durasi lebih panjang karena dua baris).
void showSnackError(BuildContext context, Object error, String fallback) {
  final msg = friendlyNetworkError(error) ?? fallback;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(msg),
    backgroundColor: AppColors.coral,
    duration: const Duration(seconds: 5),
  ));
}

/// Alur teknisi melepas tugas: dialog alasan (min 5 karakter) →
/// RPC release_job → pesanan kembali ke daftar Tersedia.
/// Return true bila berhasil dilepas.
Future<bool> releaseJobFlow(BuildContext context, String bookingId) async {
  final ctrl = TextEditingController();
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Lepas tugas ini?'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text(
            'Pesanan akan kembali ke daftar Tersedia dan bisa diambil teknisi lain.',
            style: TextStyle(fontSize: 13, height: 1.45)),
        const SizedBox(height: 12),
        TextField(
          controller: ctrl,
          minLines: 2,
          maxLines: 4,
          maxLength: 500,
          decoration: const InputDecoration(
            labelText: 'Alasan melepas (wajib)',
            hintText: 'mis. jadwal bentrok, di luar area saya…',
          ),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.coral),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Lepas Tugas'),
        ),
      ],
    ),
  );
  if (confirmed != true) return false;

  final reason = ctrl.text.trim();
  if (reason.length < 5) {
    if (context.mounted) showSnack(context, 'Tulis alasan melepas tugas (minimal 5 karakter).', error: true);
    return false;
  }

  try {
    final r = await Api.releaseJob(bookingId, reason);
    if (context.mounted) {
      if (r.ok) {
        showSnack(context, 'Tugas dilepas — pesanan kembali ke daftar Tersedia.');
      } else {
        showSnack(context, r.error ?? 'Gagal melepas tugas.', error: true);
      }
    }
    return r.ok;
  } catch (e) {
    if (context.mounted) showSnackError(context, e, 'Gagal melepas tugas.');
    return false;
  }
}

/// Tampilan saat memuat / kosong / error agar semua layar konsisten.
class ScreenStateView extends StatelessWidget {
  final bool loading;
  final String? error;
  final bool empty;
  final String emptyMessage;
  final VoidCallback? onRetry;

  const ScreenStateView({
    super.key,
    required this.loading,
    this.error,
    this.empty = false,
    this.emptyMessage = 'Belum ada data',
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(
        child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()),
      );
    }
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_rounded, size: 40, color: AppColors.inkSoft),
            const SizedBox(height: 12),
            Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.inkSoft)),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Coba lagi'),
              ),
            ],
          ]),
        ),
      );
    }
    if (empty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.inbox_rounded, size: 44, color: AppColors.brandLight),
            const SizedBox(height: 12),
            Text(emptyMessage,
                textAlign: TextAlign.center, style: const TextStyle(color: AppColors.inkSoft)),
          ]),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

/// Animasi kemunculan berjenjang (staggered) untuk item daftar:
/// fade + slide-up singkat, jeda mengikuti index (dibatasi maks 480ms
/// agar item jauh di bawah tidak menunggu lama). Dipakai di daftar
/// layanan (beranda) dan daftar pesanan.
class StaggerIn extends StatefulWidget {
  final int index;
  final Widget child;
  const StaggerIn({super.key, required this.index, required this.child});

  @override
  State<StaggerIn> createState() => _StaggerInState();
}

class _StaggerInState extends State<StaggerIn> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 320));
    Future.delayed(Duration(milliseconds: (widget.index * 45).clamp(0, 480)), () {
      if (mounted) {
        setState(() => _started = true);
        _ctrl.forward();
      }
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Item tetap memakan tempat (opacity 0) agar ukuran list tidak lompat.
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (context, child) => Opacity(
        opacity: _started ? Curves.easeOut.transform(_ctrl.value) : 0.0,
        child: Transform.translate(
          offset: Offset(
              0, _started ? 14 * (1 - Curves.easeOutCubic.transform(_ctrl.value)) : 14.0),
          child: child,
        ),
      ),
      child: widget.child,
    );
  }
}

/// Notifier tab aktif — dipakai layar dalam shell (mis. avatar Beranda →
/// tab Profil) untuk pindah tab tanpa pushNamed.
final ValueNotifier<int> mainTabIndex = ValueNotifier<int>(0);

/// Tick realtime perubahan status pesanan. MainShell berlangganan Supabase
/// Realtime (Api.subscribeBookingUpdates) sekali untuk seluruh aplikasi,
/// lalu menyiarkan event ke sini. Layar yang menampilkan pesanan (Pesanan,
/// Pekerjaan, Detail) mendengarkan stream ini untuk auto-refresh.
final StreamController<BookingUpdate> bookingUpdatesTick =
    StreamController<BookingUpdate>.broadcast();

/// Posisi tab "Pesanan" pada bar navigasi — sama untuk pelanggan dan teknisi.
const int kOrdersTabIndex = 1;

/// Jumlah event realtime pesanan yang belum "dilihat": naik tiap event
/// bermakna (perubahan status / penugasan teknisi) datang saat user tidak
/// berada di tab Pesanan, dan reset ke 0 saat tab Pesanan dibuka.
/// Dipakai MainNav untuk badge kecil di ikon tab Pesanan.
final ValueNotifier<int> unseenBookingUpdates = ValueNotifier<int>(0);

/// Kode pesanan yang notifikasi realtime-nya ditahan sementara (event
/// pantulan aksi sendiri — layar pelaku sudah menampilkan snack dari hasil
/// RPC). MainShell memeriksa set ini sebelum menampilkan snack.
final Set<String> suppressedBookingNotify = <String>{};

/// Tahan notifikasi realtime untuk [code] selama beberapa detik.
void suppressBookingNotify(String code) {
  if (code.isEmpty) return;
  suppressedBookingNotify.add(code);
  Timer(const Duration(seconds: 3), () => suppressedBookingNotify.remove(code));
}

/// Shell tab utama: kelima layar tinggal di dalam satu scaffold dengan
/// bottom nav bersama. Pergantian tab dianimasikan fade + slide arah
/// (kanan untuk maju, kiri untuk mundur) lewat AnimatedSwitcher.
/// Juga memegang langganan realtime status pesanan: event UPDATE pada
/// tabel bookings (milik user sebagai pelanggan atau teknisi) memunculkan
/// SnackBar notifikasi dan menyiarkan tick ke layar terkait.
class MainShell extends StatefulWidget {
  final int initialIndex;
  const MainShell({super.key, this.initialIndex = 0});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  late int _index = widget.initialIndex;
  late int _prevIndex = widget.initialIndex;
  bool _isTechnician = false;

  // Realtime status pesanan (satu channel untuk seluruh aplikasi).
  ChatUnsubscribe? _realtimeCleanup;
  String? _realtimeUid;

  /// Tab sesuai peran: teknisi mendapat tab **Pekerjaan**
  /// (ambil pekerjaan) di posisi tengah, menggantikan Voucher.
  List<Widget> get _screens => _isTechnician
        ? <Widget>[
            const HomeScreen(),
            const OrdersScreen(),
            const JobsScreen(),
            const ReportsScreen(),
            const ProfileScreen(),
          ]
        : <Widget>[
            const HomeScreen(),
            const OrdersScreen(),
            const ReportsScreen(),
            const VouchersScreen(),
            const ProfileScreen(),
          ];

  void _select(int i) {
    if (i == _index) return;
    setState(() {
      _prevIndex = _index;
      _index = i;
    });
    // Membuka tab Pesanan = semua event realtime dinyatakan sudah dilihat.
    if (i == kOrdersTabIndex) unseenBookingUpdates.value = 0;
    mainTabIndex.value = i;
  }

  @override
  void initState() {
    super.initState();
    // Sinkron saat layar lain meminta pindah tab (mainTabIndex.value = X).
    mainTabIndex.addListener(_onExternalTabRequest);
    if (widget.initialIndex == kOrdersTabIndex) unseenBookingUpdates.value = 0;
    _detectRole();
    _initBookingRealtime();
  }

  Future<void> _detectRole() async {
    try {
      final p = await Api.myProfile();
      if (!mounted || p == null) return;
      if (p.role == 'technician' && !_isTechnician) {
        setState(() => _isTechnician = true);
      }
    } catch (_) {
      // gagal muat profil → tetap tab pelanggan
    }
  }

  /// Pasang langganan realtime bila user sudah login, atau bongkar bila
  /// tidak (mis. shell dibuka tanpa sesi). Dipanggil dari initState.
  void _initBookingRealtime() {
    final uid = Api.session?.user.id;
    if (uid != null && _realtimeUid == null) {
      _realtimeUid = uid;
      _realtimeCleanup = Api.subscribeBookingUpdates(uid, _onBookingUpdate);
    } else if (uid == null && _realtimeUid != null) {
      _teardownRealtime();
    }
  }

  void _teardownRealtime() {
    _realtimeUid = null;
    _realtimeCleanup?.call();
    _realtimeCleanup = null;
  }

  /// Event UPDATE bookings dari Supabase Realtime: tampilkan notifikasi
  /// ringan dan siarkan tick agar layar terkait memuat ulang datanya.
  void _onBookingUpdate(BookingUpdate u) {
    bookingUpdatesTick.add(u);

    // Diamkan notif untuk event hasil aksi sendiri (mis. teknisi menandai
    // selesai) — snack-nya sudah tampil dari hasil RPC di layar pelaku.
    if (suppressedBookingNotify.contains(u.code)) return;

    String pesan;
    if (u.statusChanged) {
      pesan = 'Pesanan #${u.code}: ${u.statusValue.label}';
    } else if (u.technicianAssigned) {
      pesan = 'Teknisi sudah ditugaskan untuk pesanan #${u.code}.';
    } else {
      // Perubahan lain (mis. bukti bayar diunggah) — cukup refresh, tanpa snack.
      return;
    }

    // User sedang di tab Pesanan: daftar auto-refresh sehingga perubahan
    // langsung terlihat — cukup snack, badge tetap 0.
    if (_index == kOrdersTabIndex) {
      showSnack(context, pesan);
      return;
    }

    unseenBookingUpdates.value++;
    showSnack(context, pesan);
  }

  @override
  void dispose() {
    _teardownRealtime();
    mainTabIndex.removeListener(_onExternalTabRequest);
    super.dispose();
  }

  void _onExternalTabRequest() {
    if (mainTabIndex.value == _index) return;
    _select(mainTabIndex.value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 280),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        transitionBuilder: (child, animation) {
          // Arah slide: tab di kanan masuk dari kanan, di kiri dari kiri.
          final dir = _index > _prevIndex ? 1.0 : -1.0;
          return FadeTransition(
            opacity: animation,
            child: SlideTransition(
              position: Tween<Offset>(
                begin: Offset(dir * 0.06, 0),
                end: Offset.zero,
              ).animate(animation),
              child: child,
            ),
          );
        },
        // Key berubah tiap ganti tab -> memicu animasi.
        child: KeyedSubtree(
          key: ValueKey(_index),
          child: _screens[_index],
        ),
      ),
      bottomNavigationBar: MainNav(
        currentIndex: _index,
        onTabSelected: _select,
        isTechnician: _isTechnician,
      ),
    );
  }
}

/// Navigasi bawah bersama: Beranda / Pesanan / Laporan / Voucher / Profil.
/// Dipakai kelima tab agar aktif-state konsisten.
///
/// Desain: bar melayang rounded (floating dock) — putih, bayangan lembut,
/// dengan **pill gradien beranimasi** di belakang item aktif + label yang
/// menebal. Transisi posisi pill memakai AnimatedAlign.
class MainNav extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int>? onTabSelected;
  final bool isTechnician;
  const MainNav({super.key, required this.currentIndex, this.onTabSelected, this.isTechnician = false});

  static const _customerItems = [
    (Icons.home_outlined, Icons.home_rounded, 'Beranda'),
    (Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Pesanan'),
    (Icons.local_activity_outlined, Icons.local_activity_rounded, 'Voucher'),
    (Icons.feedback_outlined, Icons.feedback_rounded, 'Laporan'),
    (Icons.person_outline, Icons.person_rounded, 'Profil'),
  ];

  /// Teknisi: tab voucher diganti **Pekerjaan** (ambil pekerjaan).
  static const _technicianItems = [
    (Icons.home_outlined, Icons.home_rounded, 'Beranda'),
    (Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Pesanan'),
    (Icons.handyman_outlined, Icons.handyman_rounded, 'Pekerjaan'),
    (Icons.feedback_outlined, Icons.feedback_rounded, 'Laporan'),
    (Icons.person_outline, Icons.person_rounded, 'Profil'),
  ];

  List<(IconData, IconData, String)> get _items =>
      isTechnician ? _technicianItems : _customerItems;

  void _go(BuildContext context, int i) {
    if (onTabSelected != null) {
      onTabSelected!(i);
      return;
    }
    const routes = ['/', '/orders', '/reports', '/vouchers', '/profile'];
    if (i == currentIndex) return;
    Navigator.pushNamed(context, routes[i]);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(14, 4, 14, 10),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: AppColors.line, width: 1),
          boxShadow: [
            BoxShadow(
              color: AppColors.navy.withValues(alpha: 0.10),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          children: List.generate(_items.length, (i) {
            final active = i == currentIndex;
            final item = _items[i];
            Widget icon = Icon(
              active ? item.$2 : item.$1,
              size: 22,
              color: active ? Colors.white : AppColors.inkSoft,
            );
            // Ikon tab "Pesanan" dibungkus Stack agar badge jumlah event
            // realtime yang belum dilihat dapat menempel di pojoknya.
            if (i == kOrdersTabIndex) {
              icon = Stack(
                clipBehavior: Clip.none,
                children: [
                  icon,
                  Positioned(
                    top: -5,
                    right: -8,
                    child: ValueListenableBuilder<int>(
                      valueListenable: unseenBookingUpdates,
                      builder: (context, n, _) =>
                          n <= 0 ? const SizedBox.shrink() : _UnseenBadge(count: n),
                    ),
                  ),
                ],
              );
            }
            return Expanded(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => _go(context, i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 260),
                  curve: Curves.easeOutCubic,
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    gradient: active
                        ? const LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [AppColors.brandDeep, AppColors.brand],
                          )
                        : null,
                    borderRadius: BorderRadius.circular(18),
                    boxShadow: active
                        ? [
                            BoxShadow(
                              color: AppColors.brand.withValues(alpha: 0.35),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ]
                        : null,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      icon,
                      const SizedBox(height: 3),
                      AnimatedDefaultTextStyle(
                        duration: const Duration(milliseconds: 200),
                        style: TextStyle(
                          fontSize: active ? 10.5 : 10,
                          fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                          color: active ? Colors.white : AppColors.inkSoft,
                        ),
                        child: Text(item.$3, maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

/// Badge angka kecil (merah) di pojok ikon tab Pesanan pada MainNav —
/// menampilkan jumlah event realtime pesanan yang belum dilihat (9+ bila
/// lebih dari sembilan). Border putih agar kontras di atas ikon aktif.
class _UnseenBadge extends StatelessWidget {
  final int count;
  const _UnseenBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$count pembaruan pesanan belum dibaca',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 3),
        constraints: const BoxConstraints(minWidth: 13, minHeight: 13),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.coral,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: Colors.white, width: 1),
        ),
        child: Text(
          count > 9 ? '9+' : '$count',
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 8,
            fontWeight: FontWeight.w800,
            height: 1,
          ),
        ),
      ),
    );
  }
}

/// Kartu baris ringkas dipakai banyak layar.
/// Chip foto teknisi bulat kecil (kartu pesanan, detail, penugasan).
/// Menampilkan foto bila teknisi sudah upload avatar, selain itu
/// fallback ke inisial nama — gambar rusak pun kembali ke inisial.
class TechAvatarChip extends StatelessWidget {
  final String? url;
  final String name;
  final double size;
  const TechAvatarChip({super.key, required this.name, this.url, this.size = 26});

  @override
  Widget build(BuildContext context) {
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
    final inner = url != null
        ? Image.network(
            url!,
            width: size,
            height: size,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => Center(
              child: Text(initial,
                  style: TextStyle(
                      fontSize: size * 0.45,
                      fontWeight: FontWeight.w900,
                      color: AppColors.brand)),
            ),
          )
        : Center(
            child: Text(initial,
                style: TextStyle(
                    fontSize: size * 0.45,
                    fontWeight: FontWeight.w900,
                    color: AppColors.brand)),
          );
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppColors.brandTint,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.line, width: 1.5),
      ),
      child: ClipOval(child: inner),
    );
  }
}

class InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const InfoRow(this.label, this.value, {super.key});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
              width: 120,
              child: Text(label, style: const TextStyle(color: AppColors.inkSoft, fontSize: 13))),
          Expanded(
              child: Text(value,
                  style: const TextStyle(
                      color: AppColors.ink, fontSize: 13, fontWeight: FontWeight.w600))),
        ]),
      );
}
