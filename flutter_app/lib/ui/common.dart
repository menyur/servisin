import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../balance_notice.dart';
import '../chat_unread.dart';
import '../inbox.dart';
import '../job_filter.dart';
import '../job_queue.dart';
import '../models.dart';
import '../report_seen.dart';
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
    return HeaderGradientBackground(
      // Gradien tetap mengisi edge-to-edge DI BELAKANG bilah status, tetapi
      // KONTEN turun melewati inset atas. Wajib sejak Android 15/16 memaksa
      // edge-to-edge: tanpa ini judul menabrak jam/baterai. `bottom: false`
      // karena bagian bawah header bukan tepi layar (di bawahnya masih ada
      // daftar). Di perangkat non-edge-to-edge inset atas = 0 → tak berubah.
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: EdgeInsets.fromLTRB(8, 12, 8, bottom != null ? 18 : 24),
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
        ),
      ),
    );
  }
}

/// Latar header tab: gradien 3 warna brand (brandDeep → brand → brandLight)
/// dengan lingkaran dekoratif halus di sudutnya.
///
/// Dipakai [ScreenHeader] (Beranda, Pesanan, Pekerjaan, Laporan, Voucher) dan
/// header layar Profil (avatar besar) supaya seluruh tab terlihat satu
/// keluarga. Lingkaran hiasan dibungkus [IgnorePointer] supaya tidak pernah
/// menelan ketukan pill/tombol yang ada di atasnya.
class HeaderGradientBackground extends StatelessWidget {
  final Widget child;

  /// Padding opsional untuk konten header (header Profil memakainya untuk
  /// menambahkan inset bilah status pada avatar).
  final EdgeInsetsGeometry? padding;

  const HeaderGradientBackground(
      {super.key, required this.child, this.padding});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      // Sudut bawah membulat → hiasan tidak boleh tumpah keluar header.
      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(30)),
      child: Container(
        width: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.brandDeep,
              AppColors.brand,
              AppColors.brandLight,
            ],
            // Warna terang (brandLight) hanya di ujung kanan-bawah supaya teks
            // putih tetap kontras di area judul.
            stops: [0.0, 0.58, 1.0],
          ),
        ),
        child: Stack(children: [
          const Positioned(top: -48, right: -36, child: _DecoCircle(size: 172)),
          const Positioned(
              bottom: -58,
              left: -30,
              child: _DecoCircle(size: 130, opacity: 0.08)),
          const Positioned(top: 30, right: 86, child: _DecoRing(size: 48)),
          if (padding != null)
            Padding(padding: padding!, child: child)
          else
            child,
        ]),
      ),
    );
  }
}

/// Lingkaran putih transparan (hiasan header) — tidak menangkap ketukan.
class _DecoCircle extends StatelessWidget {
  final double size;
  final double opacity;

  const _DecoCircle({required this.size, this.opacity = 0.10});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Colors.white.withValues(alpha: opacity),
        ),
      ),
    );
  }
}

/// Cincin tipis (hiasan header) — garis putih transparan tanpa isi.
class _DecoRing extends StatelessWidget {
  final double size;

  const _DecoRing({required this.size});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border:
              Border.all(color: Colors.white.withValues(alpha: 0.22), width: 2),
        ),
      ),
    );
  }
}

/// Kartu konten putih yang menimpa header gradien (offset -24).
class FloatingCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;

  const FloatingCard(
      {super.key,
      required this.child,
      this.padding = const EdgeInsets.all(14)});

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

  /// Pesanan sudah punya teknisi. `paid` + teknisi ada BUKAN "menunggu
  /// penugasan" — lihat [BookingStatusX.labelFor].
  final bool hasTechnician;

  const StatusBadge(this.status, {super.key, this.hasTechnician = false});

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
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration:
            BoxDecoration(color: _bg, borderRadius: BorderRadius.circular(999)),
        child: Text(status.labelFor(hasTechnician: hasTechnician),
            style: TextStyle(
                color: _fg, fontSize: 11, fontWeight: FontWeight.w700)),
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

/// Tanya sumber gambar (galeri / ambil kamera) lewat bottom sheet; layar
/// bawah bisa ditutup tanpa memilih → return null (pemanggil berhenti).
/// Dipakai lampiran booking, bukti bayar, laporan, foto profil, dan KTP.
Future<ImageSource?> chooseImageSource(BuildContext context,
    {String title = 'Pilih Gambar'}) async {
  return showModalBottomSheet<ImageSource>(
    context: context,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child:
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        ),
        ListTile(
          leading:
              const Icon(Icons.photo_library_rounded, color: AppColors.brand),
          title: const Text('Pilih dari Galeri'),
          onTap: () => Navigator.pop(ctx, ImageSource.gallery),
        ),
        ListTile(
          leading:
              const Icon(Icons.photo_camera_rounded, color: AppColors.brand),
          title: const Text('Ambil Foto dengan Kamera'),
          onTap: () => Navigator.pop(ctx, ImageSource.camera),
        ),
        const SizedBox(height: 8),
      ]),
    ),
  );
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

/// Buka Google Maps untuk sebuah tujuan — titik exact bila koordinat tersedia,
/// jika tidak alamat lengkapnya (Maps mencari sendiri alamat itu).
///
/// Satu ketukan langsung membuka aplikasi Google Maps (mode navigasi mobil),
/// tanpa dialog/sheet perantara. Kegagalan membuka Maps TIDAK diam-diam:
/// pengguna diberi tahu lewat SnackBar supaya tombol rute tidak terasa mati.
///
/// Return true bila Maps benar-benar dibuka.
Future<bool> openRouteToDestination(
  BuildContext context, {
  double? lat,
  double? lng,
  String? address,
}) async {
  final url = Api.routeUrl(lat: lat, lng: lng, address: address);
  if (url == null) {
    if (context.mounted) {
      showSnack(context, 'Tujuan belum tersedia — alamat pesanan kosong.',
          error: true);
    }
    return false;
  }
  try {
    final ok = await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && context.mounted) {
      showSnack(context, 'Gagal membuka Google Maps. Coba lagi.', error: true);
    }
    return ok;
  } catch (e) {
    if (context.mounted) {
      showSnackError(context, e, 'Gagal membuka Google Maps.');
    }
    return false;
  }
}

/// Alur teknisi melepas tugas: dialog alasan (min 5 karakter) →
/// RPC release_job → pesanan kembali ke daftar Tersedia.
/// Return true bila berhasil dilepas.
///
/// Controller alasan dimiliki oleh [_ReleaseJobDialog] (StatefulWidget), BUKAN
/// variabel lokal di sini: `showDialog` selesai saat route di-pop, sedangkan
/// widget dialog masih hidup selama animasi keluar. Men-dispose controller di
/// sini membuat `TextField` yang masih ter-mount memakai controller mati →
/// assertion `A TextEditingController was used after being disposed` lalu
/// `_dependents.isEmpty` (layar merah).
Future<bool> releaseJobFlow(BuildContext context, String bookingId) async {
  final reason = await showDialog<String>(
    context: context,
    builder: (_) => const _ReleaseJobDialog(),
  );
  if (reason == null || reason.length < 5) return false;

  try {
    final r = await Api.releaseJob(bookingId, reason);
    if (context.mounted) {
      if (r.ok) {
        showSnack(
            context, 'Tugas dilepas — pesanan kembali ke daftar Tersedia.');
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

/// Dialog alasan pelepasan tugas.
///
/// StatefulWidget supaya `TextEditingController` hidup selama route dialog
/// (termasuk animasi keluar) dan dibuang di `dispose()` miliknya sendiri —
/// lihat catatan di [releaseJobFlow]. Validasinya inline: alasan terlalu
/// pendek tidak menutup dialog, pengguna bisa langsung memperbaiki.
/// Mengembalikan alasan yang sudah di-trim, atau null bila dibatalkan.
class _ReleaseJobDialog extends StatefulWidget {
  const _ReleaseJobDialog();

  @override
  State<_ReleaseJobDialog> createState() => _ReleaseJobDialogState();
}

class _ReleaseJobDialogState extends State<_ReleaseJobDialog> {
  final _ctrl = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _submit() {
    final reason = _ctrl.text.trim();
    if (reason.length < 5) {
      setState(
          () => _error = 'Tulis alasan melepas tugas (minimal 5 karakter).');
      return;
    }
    Navigator.pop(context, reason);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Lepas tugas ini?'),
      // Scrollable: papan ketik di layar pendek tidak boleh memicu overflow.
      content: SingleChildScrollView(
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                  'Pesanan akan kembali ke daftar Tersedia dan bisa diambil teknisi lain.',
                  style: TextStyle(fontSize: 13, height: 1.45)),
              const SizedBox(height: 12),
              TextField(
                controller: _ctrl,
                minLines: 2,
                maxLines: 4,
                maxLength: 500,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  labelText: 'Alasan melepas (wajib)',
                  hintText: 'mis. jadwal bentrok, di luar area saya…',
                  errorText: _error,
                ),
              ),
            ]),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Batal')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.coral),
          onPressed: _submit,
          child: const Text('Lepas Tugas'),
        ),
      ],
    );
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
        child: Padding(
            padding: EdgeInsets.all(40), child: CircularProgressIndicator()),
      );
    }
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_rounded,
                size: 40, color: AppColors.inkSoft),
            const SizedBox(height: 12),
            Text(error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.inkSoft)),
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
            const Icon(Icons.inbox_rounded,
                size: 44, color: AppColors.brandLight),
            const SizedBox(height: 12),
            Text(emptyMessage,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.inkSoft)),
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

class _StaggerInState extends State<StaggerIn>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 320));
    Future.delayed(Duration(milliseconds: (widget.index * 45).clamp(0, 480)),
        () {
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
              0,
              _started
                  ? 14 * (1 - Curves.easeOutCubic.transform(_ctrl.value))
                  : 14.0),
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

/// GlobalKey navigator — dipakai PushService (FCM) menampilkan SnackBar
/// notifikasi foreground dari luar widget tree biasa.
final navigatorKey = GlobalKey<NavigatorState>();

/// GlobalKey ScaffoldMessenger — dipakai main.dart memberi tahu (lewat
/// SnackBar) saat pengguna yang SUDAH masuk membuka tautan reset yang gagal,
/// tanpa menyeretnya keluar dari layar yang sedang dibuka.
final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

/// Nama rute bernama yang sedang tampil (verbose terakhir dari [obsRoutes]).
/// Dipakai handler deep link di main.dart agar tidak melakukan navigasi ganda
/// saat pengguna sudah berada di beranda.
final ValueNotifier<String> currentRouteName = ValueNotifier<String>('/splash');

/// Observer rute untuk [currentRouteName] — dipasang di MaterialApp
/// (navigatorObservers). Rute tanpa nama (mis. hasil onGenerateRoute)
/// dibiarkan: nama terakhir yang dikenal tetap dipertahankan.
class AuthRouteObserver extends NavigatorObserver {
  static void _remember(Route<dynamic>? route) {
    final name = route?.settings.name;
    if (name != null && name.isNotEmpty) currentRouteName.value = name;
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      _remember(route);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) =>
      _remember(newRoute);

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      _remember(previousRoute);
}

/// Penanda bahwa deep link reset kata sandi (`fixify://reset-password`) sudah
/// ditangani — entah berhasil (layar "Kata Sandi Baru") atau gagal (layar
/// "Tautan tidak berlaku").
///
/// Dipakai splash: navigasi splash yang datang BELAKANGAN akan menimpa layar
/// yang baru dibuka deep link, karena `pushReplacementNamed` mengganti rute
/// teratas. Terbukti di emulator (13 Okt 2026): tautan dibuka saat app start,
/// sesi pemulihan terbentuk, layar "Kata Sandi Baru" terbuka — lalu splash
/// (yang rutenya dihitung SEBELUM sesi itu ada) menggantinya dengan beranda.
/// Pengguna yang mengikuti tautan reset mendarat di beranda tanpa penjelasan.
final ValueNotifier<bool> pemulihanKataSandiAktif = ValueNotifier<bool>(false);

/// Boleh splash berpindah ke rute awalnya?
///
/// Tidak bila deep link reset sudah membawa pengguna ke layarnya sendiri, dan
/// tidak saat splash ditahan sengaja (`?splash=hold`). Murni — diuji langsung.
bool bolehSplashNavigasi({
  required bool pemulihanAktif,
  required bool hold,
}) =>
    !pemulihanAktif && !hold;

/// Apakah sesi baru dari deep link (verifikasi email `fixify://confirm`)
/// perlu memindahkan pengguna ke beranda/layar Selamat Datang?
///
/// Tidak bila sudah di beranda, tidak saat sedang di layar "Kata Sandi Baru"
/// (navigasinya diatur alur pemulihan sandi), dan tidak saat sudah berada di
/// layar Selamat Datang.
bool shouldGoHomeAfterSignIn(String currentRoute) =>
    currentRoute != '/' &&
    currentRoute != '/welcome' &&
    currentRoute != '/set-password';

/// Tick realtime perubahan status pesanan. MainShell berlangganan Supabase
/// Realtime (Api.subscribeBookingUpdates) sekali untuk seluruh aplikasi,
/// lalu menyiarkan event ke sini. Layar yang menampilkan pesanan (Pesanan,
/// Pekerjaan, Detail) mendengarkan stream ini untuk auto-refresh.
final StreamController<BookingUpdate> bookingUpdatesTick =
    StreamController<BookingUpdate>.broadcast();

/// Pesanan yang SUDAH diperbarui di dalam aplikasi (mis. pelanggan menyetujui
/// biaya tambahan di layar detail).
///
/// Berbeda dari [bookingUpdatesTick] yang hanya membawa kabar "ada perubahan"
/// (penerima lalu memuat ulang dari server), stream ini membawa OBJEK pesanan
/// terbarunya. Daftar Pesanan bisa mengganti satu baris di tempat, jadi total
/// baru terlihat seketika — tanpa menunggu tick realtime, tanpa kedipan
/// indikator muat.
final StreamController<Booking> bookingPatches =
    StreamController<Booking>.broadcast();

/// Posisi tab "Pesanan" pada bar navigasi — sama untuk pelanggan dan teknisi.
const int kOrdersTabIndex = 1;

/// Posisi tab "Voucher" — HANYA pelanggan (di indeks yang sama teknisi punya
/// tab Laporan). Jangan dipakai langsung untuk teknisi; gunakan
/// [tabIndexForNotificationTarget] yang sudah menangani peran.
const int kVouchersTabIndex = 3;

/// Posisi tab "Pekerjaan" pada bar navigasi — hanya ada untuk teknisi.
const int kJobsTabIndex = 2;

/// Posisi tab "Profil" pada bar navigasi — sama untuk kedua peran. Dipakai
/// pengalihan awal teknisi baru (lihat MainShell._detectRole) dan layar login.
const int kProfileTabIndex = 4;

/// Posisi tab "Laporan" pada bar navigasi — **berbeda per peran**: pelanggan
/// 2 (Beranda · Pesanan · Laporan · Voucher · Profil), teknisi 3 (Beranda ·
/// Pesanan · Pekerjaan · Laporan · Profil). Dipakai MainNav memasang badge
/// dan MainShell saat notifikasi laporan meminta tab ini.
int reportsTabIndex(bool isTechnician) => isTechnician ? 3 : 2;

/// Selang penyegaran angka badge tab Pekerjaan (jumlah pekerjaan tersedia).
/// Daftar pekerjaan baru tidak bisa diandalkan lewat realtime — barisnya milik
/// pelanggan lain dan hanya terbaca lewat RPC security definer — jadi angka
/// segment ini dihitung ulang berkala selagi app aktif (plus saat app kembali
/// ke depan layar dan saat tab Pekerjaan ditinggalkan).
const Duration kJobCountRefreshInterval = Duration(seconds: 60);

/// Permintaan membuka tab **Laporan** dari luar widget tree (mis. pengguna
/// mengetuk notifikasi status laporan). Indeks tab Laporan BERBEDA per peran
/// — 2 untuk pelanggan, 3 untuk teknisi — jadi shell yang menerjemahkannya.
/// Nilai dinaikkan (counter) supaya tetap memicu listener meski nilainya sama.
final ValueNotifier<int> openReportsRequest = ValueNotifier<int>(0);

/// Satu ketukan notifikasi: tujuan tab, pesanan terkait (bila ada), + waktunya.
class NotificationTap {
  final String target;

  /// Diisi notifikasi yang menunjuk satu pesanan (chat, no-show, biaya
  /// tambahan). Shell memakai ini untuk membuka detail pesanan, bukan sekadar
  /// mendarat di daftar Pesanan.
  final String? bookingId;

  /// `true` hanya untuk notifikasi chat: detail pesanan lalu percakapan
  /// langsung dibuka di atasnya. No-show & biaya tambahan cukup detail —
  /// pengguna harus melihat tombol "Saya di sini" / persetujuan, bukan chat.
  final bool openChat;
  final DateTime at;

  NotificationTap(
    this.target, {
    this.bookingId,
    this.openChat = false,
    DateTime? at,
  }) : at = at ?? DateTime.now();
}

/// Batas umur titipan notifikasi. Saat diketuk, Android bisa MEMBANGUN ULANG
/// activity/task (terbukti di emulator: MainShell baru lahir ±0,4 detik setelah
/// handler tap jalan). Karena itu nilai ini tidak langsung dibuang setelah
/// shell lama memakainya: shell baru dalam jendela ini juga menerapkannya.
const Duration kNotificationTapWindow = Duration(seconds: 20);

/// Ketukan notifikasi terakhir yang belum diterapkan oleh shell tertentu.
///
/// Kenapa bukan langsung `mainTabIndex`: notifikasi bisa diketuk saat app
/// TERMINASI — nilai ditulis sebelum MainShell ada, listener belum terpasang,
/// dan tujuannya hilang. Shell membaca [NotificationTap] setelah perannya
/// diketahui; tiap shell mencatat objek yang sudah ia pakai, jadi shell baru
/// (cold start / activity dibangun ulang) tetap mendapat tujuan yang sama.
final ValueNotifier<NotificationTap?> pendingNotificationTap =
    ValueNotifier<NotificationTap?>(null);

/// Masih adakah ketukan notifikasi yang layak diterapkan?
bool adaNotifikasiPending([DateTime? sekarang]) {
  final tap = pendingNotificationTap.value;
  if (tap == null) return false;
  final now = sekarang ?? DateTime.now();
  return now.difference(tap.at) < kNotificationTapWindow;
}

/// Tutup layar yang menutupi shell (detail pesanan, chat, dialog) sebelum
/// berpindah tab dari notifikasi. Tanpa ini, tab berubah di belakang layar
/// detail yang tetap terlihat — pengguna mengira notifikasinya tidak bekerja.
///
/// Dipisah dari [MainShell] agar bisa diuji dengan Navigator nyata.
void tutupLayarDiAtasShell(NavigatorState? navigator) {
  if (navigator == null || !navigator.canPop()) return;
  navigator.popUntil((route) => route.isFirst);
}

/// Indeks tab untuk tujuan notifikasi. Murni supaya bisa diuji tanpa widget:
/// tab Laporan berbeda per peran (pelanggan 2, teknisi 3); 'jobs' hanya ada
/// untuk teknisi — pelanggan yang menerimanya kembali ke Pesanan.
int tabIndexForNotificationTarget(String? target, bool isTechnician) {
  switch (target) {
    case 'reports':
      return reportsTabIndex(isTechnician);
    case 'jobs':
      return isTechnician ? kJobsTabIndex : kOrdersTabIndex;
    case 'profile':
      return kProfileTabIndex;
    case 'vouchers':
      // Teknisi tidak punya tab Voucher; notifikasi voucher untuk mereka
      // (mis. hadiah manual admin) diarahkan ke Pesanan, bukan ke Laporan
      // yang kebetulan menempati indeks 3.
      return isTechnician ? kOrdersTabIndex : kVouchersTabIndex;
    case 'orders':
    default:
      return kOrdersTabIndex;
  }
}

/// Jumlah event realtime pesanan yang belum "dilihat": naik tiap event
/// bermakna (perubahan status / penugasan teknisi) datang saat user tidak
/// berada di tab Pesanan, dan reset ke 0 saat tab Pesanan dibuka.
/// Dipakai MainNav untuk badge kecil di ikon tab Pesanan.
final ValueNotifier<int> unseenBookingUpdates = ValueNotifier<int>(0);

/// Jumlah laporan milik pengguna yang sudah ditanggapi admin tetapi statusnya
/// belum pernah dilihat (badge kecil di ikon tab Laporan, kedua peran).
/// Naik dari event realtime laporan & dihitung ulang dari server saat app
/// dibuka/kembali aktif; kembali 0 begitu daftar Laporan dilihat.
/// Aturan hitungnya: `countUnseenReports` di lib/report_seen.dart.
final ValueNotifier<int> unseenReportUpdates = ValueNotifier<int>(0);

/// Jumlah keputusan setor/tarik (disetujui/ditolak) yang belum dibaca teknisi.
///
/// Notifikasi DALAM APLIKASI: ditampilkan sebagai penanda di strip saldo tab
/// Pekerjaan dan banner "Kabar saldo" di layar Saldo, tanpa bergantung pada
/// push/izin notifikasi Android. Dihitung ulang dari server saat peran terbaca
/// dan setiap app kembali ke depan layar (aturan: `unseenBalanceDecisions`).
final ValueNotifier<int> unseenBalanceNotices = ValueNotifier<int>(0);

/// Jumlah kabar Kotak Masuk yang belum dibaca (saldo + pesanan + laporan).
///
/// Satu sumber untuk lonceng di Beranda (pelanggan & teknisi) dan Pekerjaan:
/// dihitung shell saat peran terbaca, setiap app kembali ke depan, dan tiap
/// event realtime pesanan/laporan; turun ke 0 saat kotak masuk dibuka.
final ValueNotifier<int> unseenInboxUpdates = ValueNotifier<int>(0);

/// Jarak bawah aman terhadap bilah navigasi sistem (gestur / 3 tombol).
///
/// Sejak Android 15/16 memaksa edge-to-edge (targetSdk 36), badan `Scaffold`
/// digambar sampai tepi bawah layar dan tinggi bilah navigasi hanya tersedia
/// sebagai `MediaQuery.viewPadding.bottom` — tidak dipotong otomatis. Daftar
/// gulir berpadding tetap (mis. 16/28/32 px) lalu menaruh tombol terakhirnya di
/// DALAM area bilah itu, sehingga ketukan pengguna jatuh ke tombol sistem.
///
/// Pakai pada daftar/scroll yang ujungnya berisi tombol aksi:
/// ```dart
/// padding: EdgeInsets.fromLTRB(16, 16, 16, jarakBawahSistem(context, 16)),
/// ```
/// Di perangkat yang belum edge-to-edge nilainya 0, jadi tampilan lama tidak
/// berubah.
double jarakBawahSistem(BuildContext context, [double jarak = 0]) =>
    MediaQuery.viewPaddingOf(context).bottom + jarak;

/// Jumlah pekerjaan tersedia SAAT INI untuk teknisi (badge di ikon tab
/// Pekerjaan). Berbeda dengan dua badge di atas yang menghitung *kejadian
/// belum dilihat*, angka ini adalah total yang sedang menunggu diambil —
/// itulah yang berguna saat memutuskan mengambil pekerjaan. Karena itu ia
/// disembunyikan selagi teknisi berada di tab Pekerjaan (bukan di-reset).
/// Isinya selalu berasal dari [filterAvailableJobs] yang sama dengan daftar
/// kartu di layar Pekerjaan.
final ValueNotifier<int> availableJobCount = ValueNotifier<int>(0);

/// Profil teknisi masih ada data yang perlu dilengkapi (lihat
/// [dataProfilKurang]). Menyalakan **titik** di ikon tab Profil — bukan angka,
/// karena ini pengingat tindakan, bukan hitungan notifikasi. Diperbarui
/// MainShell saat peran terbaca dan ProfileScreen setelah profil dimuat /
/// disimpan, sehingga titik hilang segera setelah datanya lengkap.
final ValueNotifier<bool> profilPerluDilengkapi = ValueNotifier<bool>(false);

/// Tick event realtime laporan (admin menanggapi). Layar Laporan mendengarkan
/// stream ini untuk memuat ulang daftarnya; MainShell menyiarkannya sekaligus
/// menghitung ulang [unseenReportUpdates].
final StreamController<ReportUpdate> reportUpdatesTick =
    StreamController<ReportUpdate>.broadcast();

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

/// Reaksi SATU event tanggapan admin atas laporan pengguna.
///
/// Satu tempat untuk seluruh alur, dipanggil `MainShell` pada setiap event
/// realtime — dan dipanggil langsung oleh `test/report_update_snack_test.dart`
/// sehingga notifikasinya bisa dibuktikan DETERMINISTIK (tanpa websocket dan
/// tanpa menunggu snack sesaat yang cuma tampil ±4 detik di perangkat).
///
/// Urutannya sengaja tetap seperti ini:
///   1. siarkan tick — layar Laporan memuat ulang daftarnya;
///   2. beri tahu pengguna lewat SnackBar, HANYA bila statusnya benar-benar
///      berubah ([reportUpdateSnack] mengembalikan null bila tidak berubah);
///   3. hitung ulang angka badge dari server.
void handleReportUpdate(
  BuildContext context,
  ReportUpdate u, {
  required void Function() refreshBadge,
}) {
  reportUpdatesTick.add(u);
  final pesan = reportUpdateSnack(u);
  // context.mounted: event bisa tiba tepat setelah layar dilepas (app ditutup
  // di tengah event) — jangan menempel SnackBar ke context yang sudah mati.
  if (pesan != null && context.mounted) showSnack(context, pesan);
  refreshBadge();
}

/// Shell tab utama: kelima layar tinggal di dalam satu scaffold dengan
/// bottom nav bersama. Pergantian tab dianimasikan fade + slide arah
/// (kanan untuk maju, kiri untuk mundur) lewat AnimatedSwitcher.
/// Juga memegang langganan realtime status pesanan: event UPDATE pada
/// tabel bookings (milik user sebagai pelanggan atau teknisi) memunculkan
/// SnackBar notifikasi dan menyiarkan tick ke layar terkait.
class MainShell extends StatefulWidget {
  final int initialIndex;

  /// Seam uji: apakah sesi masih ada (default `Api.isLoggedIn`).
  ///
  /// Dipakai tes untuk membuktikan shell TANPA sesi langsung dikembalikan ke
  /// layar masuk — tanpa perlu memasang Supabase di lingkungan tes.
  final bool Function()? sesiAda;

  const MainShell({super.key, this.initialIndex = 0, this.sesiAda});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> with WidgetsBindingObserver {
  late int _index = widget.initialIndex;
  late int _prevIndex = widget.initialIndex;
  bool _isTechnician = false;

  /// Sekali per shell: teknisi yang profilnya belum lengkap sudah dibawa ke tab
  /// Profil dan sudah diingatkan — jangan mengulanginya saat tab berganti.
  bool _sudahKeProfil = false;
  bool _sudahIngatLengkapi = false;

  /// Peran sudah dibaca? Tujuan notifikasi menunggu sampai ini benar karena
  /// indeks tab Laporan bergantung pada peran.
  bool _peranTerbaca = false;

  /// Sesi ada, tetapi baris `profiles`-nya TIDAK ada.
  ///
  /// Ini bukan "profil lengkap" dan bukan pula "gagal memuat": tanpa baris
  /// profil, peran terbaca kosong, sapaan Beranda jatuh ke "Kawan", dan
  /// permintaan hapus akun ditolak DB ('profil_tidak_ada'). Jadi shell
  /// menampilkan layar penjelasan, bukan aplikasi yang tampak normal.
  /// (docs/security.md §8.3)
  bool _sesiTanpaProfil = false;

  /// TIDAK ADA sesi sama sekali (bukan sekadar profilnya hilang).
  ///
  /// Shell tidak boleh dirender dalam keadaan ini. Rute '/' bisa dibuka tanpa
  /// sesi — riwayat browser setelah keluar, tombol back dari layar masuk, atau
  /// sesi yang kedaluwarsa saat app di background — dan menu yang tampil akan
  /// menyapa "Kawan", menampilkan tab kosong, serta mengirim permintaan yang
  /// pasti ditolak server. Karena itu pengguna dikembalikan ke layar masuk dan
  /// tumpukan rute dibersihkan (lihat [_sesiBerakhir]).
  bool _tanpaSesi = false;

  /// Pengalihan ke '/login' hanya dijadwalkan sekali.
  bool _sudahArahkanLogin = false;

  /// Apakah sesi ada — lewat seam uji bila diberikan.
  bool get _adaSesi => widget.sesiAda?.call() ?? Api.isLoggedIn;

  /// Ketukan notifikasi yang sudah diterapkan shell INI. Mencegah listener
  /// yang sama menerapkannya berulang, tanpa menghalangi shell baru.
  NotificationTap? _notificationTapTerpakai;

  // Realtime status pesanan (satu channel untuk seluruh aplikasi).
  ChatUnsubscribe? _realtimeCleanup;
  String? _realtimeUid;

  // Realtime tanggapan admin atas laporan pengguna (badge tab Laporan).
  ChatUnsubscribe? _reportCleanup;
  String? _reportUid;

  // Realtime SEMUA chat masuk (badge tombol chat + badge ikon aplikasi).
  ChatUnsubscribe? _chatCleanup;
  String? _chatUid;

  /// Profil pengguna yang login — dipakai filter area/keahlian untuk angka
  /// badge tab Pekerjaan (dan hasil `_detectRole` sudah memuatnya).
  Profile? _myProfile;

  /// Timer penyegaran angka pekerjaan tersedia (teknisi saja).
  Timer? _jobCountTimer;

  /// Sedang menghitung angka pekerjaan? — cegah permintaan bertumpuk saat
  /// timer & event realtime tiba bersamaan.
  bool _refreshingJobCount = false;

  /// Kabar saldo yang sudah diumumkan lewat SnackBar pada sesi ini (kunci
  /// `id:status`), supaya resume berulang tidak mengulang pesan yang sama.
  final Set<String> _announcedBalanceNotices = <String>{};

  /// Cegah beberapa permintaan hitung kabar kotak masuk bertumpuk.
  bool _refreshingInbox = false;

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
    final sebelumnya = _index;
    setState(() {
      _prevIndex = _index;
      _index = i;
    });
    // Membuka tab Pesanan = semua event realtime dinyatakan sudah dilihat.
    if (i == kOrdersTabIndex) unseenBookingUpdates.value = 0;
    // Meninggalkan tab Pekerjaan: angka pekerjaan tersedia dihitung ulang
    // (mengambil/menyelesaikan pekerjaan mengubahnya tanpa event realtime).
    if (_isTechnician && sebelumnya == kJobsTabIndex && i != kJobsTabIndex) {
      unawaited(_refreshJobCount());
    }
    mainTabIndex.value = i;
  }

  @override
  void initState() {
    super.initState();
    // Tanpa sesi tidak ada yang boleh dipasang: realtime, timer, dan hitungan
    // badge semuanya butuh user id. Langsung kembalikan ke layar masuk.
    if (!_adaSesi) {
      _sesiBerakhir();
      return;
    }
    // Angka badge disegarkan saat app kembali ke depan layar: notifikasi yang
    // tiba selagi app tidak aktif tidak melewati websocket.
    WidgetsBinding.instance.addObserver(this);
    // Sinkron saat layar lain meminta pindah tab (mainTabIndex.value = X).
    mainTabIndex.addListener(_onExternalTabRequest);
    // Badge chat dari snapshot lokal — tampil segera, lalu dihitung ulang dari
    // server setelah peran terbaca (_detectRole).
    unawaited(ChatUnreadService.loadCached());
    // Notifikasi laporan meminta tab Laporan (indeks tergantung peran).
    openReportsRequest.addListener(_onOpenReportsRequest);
    // Notifikasi yang diketuk (termasuk saat app cold start) menitipkan tujuan.
    pendingNotificationTap.addListener(_onPendingNotification);
    if (widget.initialIndex == kOrdersTabIndex) unseenBookingUpdates.value = 0;
    _detectRole();
    // Antrean luring dari sesi sebelumnya (app ditutup saat sinyal buruk).
    unawaited(JobQueue.kirimSemua());
    _initBookingRealtime();
    _initReportRealtime();
    _initChatRealtime();
  }

  /// Pasang pendengar chat global. RLS Supabase hanya meneruskan pesan dari
  /// pesanan milik pelanggan ini / tugas teknisi ini, jadi satu channel cukup
  /// tanpa perlu tahu ID pesanan lebih dulu.
  void _initChatRealtime() {
    final uid = Api.session?.user.id;
    if (uid == null || uid.isEmpty) return;
    if (_chatUid == uid) return;
    _chatUid = uid;
    _chatCleanup = Api.subscribeIncomingChat(uid, (m) {
      // Pesan yang saya kirim sendiri (mis. dari perangkat lain) bukan unread.
      if (m.senderId == uid) return;
      ChatUnreadService.onIncoming(
        m.bookingId,
        messageId: m.id,
        at: m.createdAt,
      );
    });
  }

  Future<void> _detectRole() async {
    try {
      final p = await Api.myProfile();
      if (!mounted) return;
      if (p == null) {
        // null = baris profilnya memang tidak ada (bukan kegagalan jaringan:
        // yang itu masuk ke catch di bawah). Bila ternyata SESINYA yang tidak
        // ada (mis. kedaluwarsa setelah shell terpasang), menu tidak boleh
        // dibiarkan tampil — peran kosong, sapaan jatuh ke "Kawan".
        if (!_adaSesi) {
          _sesiBerakhir();
          return;
        }
        if (!_sesiTanpaProfil) setState(() => _sesiTanpaProfil = true);
        return;
      }
      _myProfile = p;
      final kurang = dataProfilKurang(p);
      profilPerluDilengkapi.value = kurang.isNotEmpty;
      final jadiTeknisi = p.role == 'technician' && !_isTechnician;
      _peranTerbaca = true;
      // Tampilan awal teknisi yang datanya belum lengkap = Profil. Ini menutup
      // semua jalur masuk (termasuk sesi yang dipulihkan saat app dibuka),
      // sehingga teknisi baru tidak ditinggal di Beranda tanpa tahu apa yang
      // harus diisi. Login & verifikasi email sudah mengarahkannya lebih awal.
      final alihkanKeProfil = p.role == 'technician' &&
          kurang.isNotEmpty &&
          widget.initialIndex == 0 &&
          // Jangan menimpa tujuan yang sudah diminta dari luar (mis. notifikasi
          // push yang membuka tab Pesanan/Pekerjaan saat app baru dibuka).
          mainTabIndex.value == 0 &&
          !adaNotifikasiPending() &&
          !_sudahKeProfil;
      if (jadiTeknisi || alihkanKeProfil) {
        setState(() {
          if (jadiTeknisi) _isTechnician = true;
          if (alihkanKeProfil) {
            _sudahKeProfil = true;
            _prevIndex = _index;
            _index = kProfileTabIndex;
          }
        });
      }
      if (alihkanKeProfil) mainTabIndex.value = kProfileTabIndex;
      if (p.role == 'technician') _startJobCountRefresh();
      // Kabar saldo (setoran/penarikan yang sudah diputuskan admin) — muncul
      // walau push tidak sampai karena izin notifikasi HP mati.
      if (p.role == 'technician') unawaited(_refreshBalanceNotices());
      // Angka lonceng kotak masuk di Beranda — untuk kedua peran.
      unawaited(_refreshInboxBadge());
      if (p.role == 'technician' && kurang.isNotEmpty) {
        _ingatkanLengkapiProfil();
      }
      // Badge chat: muat angka tersimpan lalu hitung ulang dari server. Peran
      // menentukan daftar pesanan yang perlu diperiksa (pelanggan vs teknisi).
      unawaited(ChatUnreadService.init(isTechnician: p.role == 'technician'));
      // Tujuan notifikasi baru bisa diterjemahkan setelah peran diketahui.
      _consumePendingNotification();
    } catch (_) {
      // gagal muat profil → tetap tab pelanggan
    }
  }

  /// Beri tahu SEKALI per shell bahwa profil teknisi masih perlu dilengkapi.
  /// SnackBar ini pelengkap pengingat tetap di layar Profil dan titik di tab
  /// Profil — jadi teknisi tetap punya jejak walau SnackBar-nya sudah lewat.
  void _ingatkanLengkapiProfil() {
    if (_sudahIngatLengkapi) return;
    _sudahIngatLengkapi = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      showSnack(context,
          'Lengkapi data profil teknismu agar siap menerima pekerjaan.');
    });
  }

  /// Mulai pemantauan jumlah pekerjaan tersedia (teknisi): sekali sekarang,
  /// lalu tiap [kJobCountRefreshInterval] selagi shell hidup.
  void _startJobCountRefresh() {
    if (_jobCountTimer != null) return;
    unawaited(_refreshJobCount());
    _jobCountTimer = Timer.periodic(kJobCountRefreshInterval, (_) {
      unawaited(_refreshJobCount());
    });
  }

  /// Hitung pekerjaan tersedia yang RELEVAN bagi teknisi ini — memakai filter
  /// yang sama dengan daftar di layar Pekerjaan, sehingga angka badge tidak
  /// pernah berbeda dari jumlah kartu yang dilihat (lib/job_filter.dart).
  /// Gagal mengambil data → angka terakhir dipertahankan (jangan nolkan
  /// diam-diam; badge yang hilang lebih membingungkan daripada angka basi).
  Future<void> _refreshJobCount() async {
    if (!_isTechnician || _refreshingJobCount) return;
    _refreshingJobCount = true;
    try {
      final jobs = await Api.fetchAvailableJobs();
      var profil = _myProfile;
      if (profil == null) {
        try {
          profil = await Api.myProfile();
          _myProfile = profil;
        } catch (_) {
          // tanpa profil: filter dilewati (fail-open) — angka tetap berarti
        }
      }
      final filtered = filterAvailableJobs(
        jobs: jobs,
        serviceArea: profil?.serviceArea,
        skill: profil?.skill,
      );
      if (!mounted) return;
      availableJobCount.value = filtered.count;
    } catch (_) {
      // jaringan/RPC gagal → biarkan angka terakhir
    } finally {
      _refreshingJobCount = false;
    }
  }

  /// Pasang langganan realtime laporan pengguna + hitung angka badge-nya dari
  /// server. Dipanggil dari initState; tanpa sesi (mis. login belum ada) tidak
  /// ada yang perlu dipasang.
  void _initReportRealtime() {
    final uid = Api.session?.user.id;
    if (uid == null) return;
    if (_reportUid == uid) return;
    _reportUid = uid;
    _reportCleanup =
        Api.subscribeReportUpdates(uid, (u) => _onReportUpdate(uid, u));
    unawaited(_refreshReportBadge(uid));
  }

  /// Hitung ulang angka badge tab Laporan: status laporan sekarang vs snapshot
  /// "sudah dilihat" milik perangkat ini (lib/report_seen.dart).
  Future<void> _refreshReportBadge(String uid) async {
    try {
      final current = await Api.fetchMyReportStatuses();
      final seen = await ReportSeenStore.read(uid);
      if (!mounted) return;
      unseenReportUpdates.value =
          countUnseenReports(seen: seen, current: current);
    } catch (_) {
      // gagal baca server → pertahankan angka terakhir
    }
  }

  /// Event realtime laporan: siarkan tick (layar Laporan memuat ulang), beri
  /// tahu pengguna, lalu hitung ulang angka badge dari server — seluruh alurnya
  /// ada di [handleReportUpdate] supaya bisa diuji deterministik.
  void _onReportUpdate(String uid, ReportUpdate u) {
    handleReportUpdate(context, u, refreshBadge: () {
      unawaited(_refreshReportBadge(uid));
      // Balasan admin juga menambah kabar di kotak masuk.
      unawaited(_refreshInboxBadge());
    });
  }

  /// Kembali dari background/layar mati: websocket tidak menerima apa pun
  /// selagi app tidak aktif, jadi kedua angka dihitung ulang dari server.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    // Sesi bisa hilang selagi app di background (refresh token ditolak /
    // dikeluarkan dari perangkat lain). Jangan lanjut menyegarkan badge.
    if (!_adaSesi) {
      _sesiBerakhir();
      return;
    }
    final uid = Api.session?.user.id;
    if (uid != null) unawaited(_refreshReportBadge(uid));
    // Chat yang masuk saat app di background/mati tidak melewati listener FCM
    // Dart — hitung ulang dari server begitu app kembali ke depan.
    unawaited(ChatUnreadService.refresh());
    if (_isTechnician) unawaited(_refreshJobCount());
    // Keputusan admin atas setor/tarik bisa tiba saat app di background.
    if (_isTechnician) unawaited(_refreshBalanceNotices());
    // Kabar pesanan/laporan yang tiba saat app tidak aktif.
    unawaited(_refreshInboxBadge());
    // Perubahan status pekerjaan yang tersimpan saat sinyal putus: kirim
    // sekarang. Diam bila antrean kosong atau masih offline.
    unawaited(JobQueue.kirimSemua());
  }

  /// Hitung jumlah kabar kotak masuk yang belum dibaca (sumber sama dengan
  /// layar Kotak Masuk: `lib/inbox.dart`). Gagal → angka terakhir dipertahankan.
  Future<void> _refreshInboxBadge() async {
    if (_refreshingInbox) return;
    _refreshingInbox = true;
    try {
      final data = await loadInbox(technician: _isTechnician);
      if (!mounted) return;
      unseenInboxUpdates.value = data.unread;
    } catch (_) {
      // badge basi lebih baik daripada badge hilang
    } finally {
      _refreshingInbox = false;
    }
  }

  /// Perbarui kabar saldo teknisi: angka di strip saldo + SnackBar sekali per
  /// keputusan (per sesi). SnackBar tidak menandai kabar sebagai "dibaca" —
  /// penanda tetap ada sampai teknisi menekan "Mengerti" di layar Saldo.
  Future<void> _refreshBalanceNotices() async {
    if (!_isTechnician) return;
    final notices = await loadUnseenBalanceDecisions();
    if (!mounted) return;
    unseenBalanceNotices.value = notices.length;

    final baru = <BalanceRequest>[];
    for (final n in notices) {
      if (_announcedBalanceNotices.add('${n.id}:${n.status}')) baru.add(n);
    }
    final pesan = balanceNoticeSnack(baru);
    if (pesan != null) showSnack(context, pesan);
  }

  /// Pasang langganan realtime bila user sudah login, atau bongkar bila
  /// tidak (mis. shell dibuka tanpa sesi). Dipanggil dari initState.
  void _initBookingRealtime() {
    final uid = Api.session?.user.id;
    if (uid != null && _realtimeUid == null) {
      _realtimeUid = uid;
      _realtimeCleanup = Api.subscribeBookingUpdates(
        uid,
        _onBookingUpdate,
        // Admin memutuskan refund: tidak ada baris bookings yang berubah, jadi
        // lonceng kotak masuk pelanggan dihitung ulang dari sini.
        onRefundUpdate: () => unawaited(_refreshInboxBadge()),
      );
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
    // Status pesanan berubah = kabar baru di kotak masuk (kedua peran).
    unawaited(_refreshInboxBadge());

    // Diamkan notif untuk event hasil aksi sendiri (mis. teknisi menandai
    // selesai) — snack-nya sudah tampil dari hasil RPC di layar pelaku.
    if (suppressedBookingNotify.contains(u.code)) return;

    String pesan;
    if (u.statusChanged) {
      pesan =
          'Pesanan #${u.code}: ${u.statusValue.labelFor(hasTechnician: u.technicianId != null)}';
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
    _jobCountTimer?.cancel();
    _jobCountTimer = null;
    _reportUid = null;
    _reportCleanup?.call();
    _reportCleanup = null;
    _chatUid = null;
    _chatCleanup?.call();
    _chatCleanup = null;
    WidgetsBinding.instance.removeObserver(this);
    mainTabIndex.removeListener(_onExternalTabRequest);
    openReportsRequest.removeListener(_onOpenReportsRequest);
    pendingNotificationTap.removeListener(_onPendingNotification);
    super.dispose();
  }

  void _onExternalTabRequest() {
    if (mainTabIndex.value == _index) return;
    _select(mainTabIndex.value);
  }

  /// Terapkan tujuan notifikasi yang dititipkan PushService, sekali saja.
  /// Diabaikan selama peran belum terbaca — `_detectRole` akan memanggilnya.
  void _onPendingNotification() {
    if (!mounted) return;
    _consumePendingNotification();
  }

  void _consumePendingNotification() {
    final tap = pendingNotificationTap.value;
    if (tap == null || !_peranTerbaca || !mounted) return;
    if (identical(tap, _notificationTapTerpakai)) return;
    if (!adaNotifikasiPending()) return;
    _notificationTapTerpakai = tap;
    // Tutup layar yang sedang terbuka (detail pesanan, chat, dialog) SEBELUM
    // berpindah tab. Tanpa ini, `_select` hanya mengganti tab di belakang
    // layar detail yang tetap di atas — pengguna mengetuk notifikasi Voucher
    // tetapi masih melihat detail pesanan dan mengira notifikasinya gagal.
    tutupLayarDiAtasShell(navigatorKey.currentState);
    _select(tabIndexForNotificationTarget(tap.target, _isTechnician));
    final bookingId = tap.bookingId;
    if (bookingId != null && bookingId.isNotEmpty) {
      unawaited(_bukaPesananDariNotifikasi(bookingId, openChat: tap.openChat));
    }
  }

  /// Notifikasi yang membawa id pesanan → detail pesanan itu.
  ///
  /// Chat membuka `/order-detail-chat` (detail + percakapan), sedangkan
  /// no-show & biaya tambahan cukup `/order-detail` supaya tombol tindakan
  /// ("Saya di sini" / setujui biaya) langsung terlihat tanpa tertutup chat.
  ///
  /// Kalau pesanan sudah tidak bisa dibaca (dihapus/dipindahkan), pengguna
  /// tetap mendarat di tab Pesanan; jangan biarkan notifikasi membuka layar
  /// kosong atau menggagalkan seluruh alur startup.
  Future<void> _bukaPesananDariNotifikasi(
    String bookingId, {
    bool openChat = false,
  }) async {
    try {
      final booking = await Api.fetchBookingById(bookingId);
      if (!mounted || booking == null) return;
      final navigator = navigatorKey.currentState;
      if (navigator == null) return;
      await navigator.pushNamed(
        openChat ? '/order-detail-chat' : '/order-detail',
        arguments: booking,
      );
    } catch (_) {
      // Best-effort: tab Pesanan sudah terbuka sebagai fallback.
    }
  }

  /// Notifikasi laporan meminta tab Laporan — indeks berbeda per peran.
  void _onOpenReportsRequest() {
    if (!mounted) return;
    _select(reportsTabIndex(_isTechnician));
  }

  /// Keluarkan pengguna dari shell karena sesinya tidak ada (lagi).
  ///
  /// Dua langkah, keduanya penting:
  ///   1. `_tanpaSesi` — build berikutnya TIDAK menggambar menu/tab, sehingga
  ///      tidak ada jeda di mana menu tanpa identitas terlihat atau bisa
  ///      disentuh (menu itulah yang dulu menyapa "Kawan").
  ///   2. `pushNamedAndRemoveUntil('/login')` — membersihkan SELURUH tumpukan.
  ///      Ini inti keluhannya: bila shell hanya ditumpuk di bawah layar masuk,
  ///      tombol back mengembalikan pengguna ke menu walau ia belum (atau tidak
  ///      lagi) punya akses.
  void _sesiBerakhir() {
    if (!mounted) return;
    if (!_tanpaSesi) setState(() => _tanpaSesi = true);
    if (_sudahArahkanLogin) return;
    _sudahArahkanLogin = true;
    // Post-frame: initState tidak boleh menavigasi selagi kerangka pertama
    // belum selesai dipasang (Navigator belum punya halaman untuk diganti).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Navigator.maybeOf(context)
          ?.pushNamedAndRemoveUntil('/login', (r) => false);
    });
  }

  @override
  Widget build(BuildContext context) {
    // Tanpa sesi: jangan pernah menggambar menu. Layar ringkas ini hanya
    // bertahan sekejap sampai [_sesiBerakhir] memindahkan pengguna ke '/login'
    // (dan membersihkan tumpukan rute, sehingga tombol back tidak bisa kembali
    // ke menu).
    if (_tanpaSesi) return const _SesiBerakhirScreen();
    // Sesi tanpa profil = sesi tidak sah. Ditampilkan sebagai layar penjelasan
    // (bukan Beranda yang menyapa "Kawan") supaya pengguna tahu harus apa, dan
    // supaya tidak ada pekerjaan/pesanan yang dibuat atas nama identitas kosong.
    if (_sesiTanpaProfil) return const _SesiTanpaProfilScreen();
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

/// Layar sekejap saat shell menemukan bahwa sesinya sudah tidak ada.
///
/// Bukan halaman tujuan: pengguna langsung dipindahkan ke '/login' oleh
/// `_MainShellState._sesiBerakhir`. Tombol manual disediakan untuk keadaan
/// langka saat navigasi otomatis tidak sempat berjalan (mis. rute '/login'
/// tidak terdaftar karena app dibuka lewat jalur tak terduga).
class _SesiBerakhirScreen extends StatelessWidget {
  const _SesiBerakhirScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
              const SizedBox(height: 16),
              const Text(
                'Sesi tidak ditemukan',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 6),
              const Text(
                'Kamu diarahkan kembali ke halaman masuk. Aplikasi hanya bisa '
                'dipakai setelah masuk.',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: AppColors.inkSoft, fontSize: 12.5, height: 1.45),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: () => Navigator.of(context)
                    .pushNamedAndRemoveUntil('/login', (r) => false),
                child: const Text('Masuk sekarang'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Layar untuk sesi yang TIDAK punya baris `profiles` (lihat
/// `_MainShellState._sesiTanpaProfil`).
///
/// Sengaja TIDAK memuat tab: seluruh layar aplikasi mengasumsikan peran dari
/// profil (teknisi vs pelanggan), jadi menampilkannya hanya menyembunyikan
/// masalah. Tombolnya mengeluarkan pengguna — masuk ulang baru berguna setelah
/// admin memulihkan baris profilnya (trigger handle_new_user / fix-profil-hilang.sql).
class _SesiTanpaProfilScreen extends StatelessWidget {
  const _SesiTanpaProfilScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.person_off_outlined,
                    size: 46, color: AppColors.inkSoft),
                const SizedBox(height: 14),
                const Text(
                  'Akunmu belum punya data profil',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Karena itu peran dan datamu tidak bisa dibaca, sehingga aplikasi '
                  'belum bisa dipakai (termasuk mengajukan hapus akun). Hubungi admin '
                  'lewat halaman Panduan, lalu masuk kembali setelah akunmu diperbaiki.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: AppColors.inkSoft, fontSize: 13, height: 1.5),
                ),
                const SizedBox(height: 18),
                // FilledButton bawaan tema — sengaja bukan GradientButton milik
                // layar auth: itu ada di auth_widgets.dart, dan menariknya ke
                // sini hanya untuk satu tombol menambah ketergantungan antar layar.
                FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.brand,
                    minimumSize: const Size(200, 50),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  icon: const Icon(Icons.logout_rounded, size: 19),
                  label: const Text('Keluar',
                      style: TextStyle(fontWeight: FontWeight.w800)),
                  onPressed: () async {
                    try {
                      await Api.signOut();
                    } catch (_) {
                      // sudah tidak ada sesi / jaringan bermasalah — tetap lanjut
                    }
                    if (!context.mounted) return;
                    Navigator.of(context)
                        .pushNamedAndRemoveUntil('/login', (r) => false);
                  },
                ),
              ],
            ),
          ),
        ),
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
  const MainNav(
      {super.key,
      required this.currentIndex,
      this.onTabSelected,
      this.isTechnician = false});

  // Urutan HARUS sama dengan _screens pelanggan & routes ['/orders',
  // '/reports', '/vouchers']: idx 2 = Laporan, idx 3 = Voucher — sebelumnya
  // label nav tertukar sehingga tap "Voucher" membuka layar Laporan.
  static const _customerItems = [
    (Icons.home_outlined, Icons.home_rounded, 'Beranda'),
    (Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Pesanan'),
    (Icons.feedback_outlined, Icons.feedback_rounded, 'Laporan'),
    (Icons.local_activity_outlined, Icons.local_activity_rounded, 'Voucher'),
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

  /// Sumber angka badge untuk tab ke-[i], atau `null` bila tab itu tanpa badge.
  ///
  /// Aturan yang berlaku:
  ///   * **Pesanan** (kedua peran) — event realtime yang belum dilihat;
  ///   * **Laporan** (kedua peran, indeks beda per peran) — laporan yang sudah
  ///     ditanggapi admin & belum dilihat;
  ///   * **Pekerjaan** (teknisi) — jumlah pekerjaan yang sedang menunggu
  ///     diambil.
  ValueListenable<int>? _badgeSource(int i) {
    if (i == kOrdersTabIndex) return unseenBookingUpdates;
    if (i == reportsTabIndex(isTechnician)) return unseenReportUpdates;
    if (isTechnician && i == kJobsTabIndex) return availableJobCount;
    return null;
  }

  /// Label aksesibilitas badge: sebut satuannya, bukan hanya angkanya —
  /// pembaca layar harus tahu angka itu tentang apa.
  String _badgeSemantics(int i, int n) {
    if (i == kOrdersTabIndex) return '$n pembaruan pesanan belum dibaca';
    if (i == reportsTabIndex(isTechnician)) return '$n laporan belum dibaca';
    return '$n pekerjaan tersedia'; // tab Pekerjaan (teknisi)
  }

  /// Tempelkan badge angka di pojok kanan-atas ikon tab.
  ///
  /// Badge tidak ditampilkan selagi tab itu SEDANG dibuka: Pesanan & Laporan
  /// di-reset saat dibuka (angkanya sudah tidak relevan), sedangkan Pekerjaan
  /// memang menampilkan total yang sedang tampil di layar.
  Widget _denganBadge(Widget icon, int i) {
    final sumber = _badgeSource(i);
    if (sumber == null || i == currentIndex) return icon;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        icon,
        Positioned(
          top: -5,
          right: -8,
          child: ValueListenableBuilder<int>(
            valueListenable: sumber,
            builder: (context, n, _) => n <= 0
                ? const SizedBox.shrink()
                : _UnseenBadge(count: n, semanticsLabel: _badgeSemantics(i, n)),
          ),
        ),
      ],
    );
  }

  /// Titik oranye kecil di ikon tab Profil: pengingat melengkapi data teknisi.
  ///
  /// Berbeda dari [_denganBadge] yang membawa ANGKA, titik ini menandai
  /// tindakan yang belum selesai. Disembunyikan saat tab Profil sedang dibuka
  /// — di sana pengingatnya sudah berbentuk kartu di dalam layar.
  Widget _denganTitik(Widget icon, int i) {
    if (i == currentIndex) return icon;
    return Stack(clipBehavior: Clip.none, children: [
      icon,
      Positioned(
        top: -4,
        right: -6,
        child: ValueListenableBuilder<bool>(
          valueListenable: profilPerluDilengkapi,
          builder: (context, perlu, _) => perlu
              ? Semantics(
                  container: true,
                  label: 'Profil perlu dilengkapi',
                  child: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: AppColors.accent,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                  ),
                )
              : const SizedBox.shrink(),
        ),
      ),
    ]);
  }

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
            // Ikon tab dibungkus Stack bila punya badge angka (jumlah notifikasi
            // belum dibaca / pekerjaan tersedia) supaya lencananya menempel.
            icon = _denganBadge(icon, i);
            // Tab Profil teknisi memakai TITIK (bukan angka) saat datanya belum
            // lengkap — pengingat tindakan, bukan hitungan notifikasi.
            if (isTechnician && i == kProfileTabIndex) {
              icon = _denganTitik(icon, i);
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
                          fontWeight:
                              active ? FontWeight.w800 : FontWeight.w600,
                          color: active ? Colors.white : AppColors.inkSoft,
                        ),
                        child: Text(item.$3,
                            maxLines: 1, overflow: TextOverflow.ellipsis),
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

/// Badge angka kecil (merah) di pojok ikon tab MainNav — menampilkan jumlah
/// notifikasi belum dibaca / pekerjaan tersedia (9+ bila lebih dari sembilan).
/// Border putih agar kontras di atas ikon aktif.
class _UnseenBadge extends StatelessWidget {
  final int count;

  /// Kalimat untuk pembaca layar, mis. '3 laporan belum dibaca'.
  final String semanticsLabel;

  const _UnseenBadge({required this.count, required this.semanticsLabel});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticsLabel,
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
  const TechAvatarChip(
      {super.key, required this.name, this.url, this.size = 26});

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
              child: Text(label,
                  style:
                      const TextStyle(color: AppColors.inkSoft, fontSize: 13))),
          Expanded(
              child: Text(value,
                  style: const TextStyle(
                      color: AppColors.ink,
                      fontSize: 13,
                      fontWeight: FontWeight.w600))),
        ]),
      );
}
