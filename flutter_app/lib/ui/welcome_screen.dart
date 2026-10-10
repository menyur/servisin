import 'package:flutter/material.dart';

import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';

/// Layar sekali-pakai setelah email pendaftaran diverifikasi lewat deep link
/// `fixify://confirm` (lihat _FixifyAppState di main.dart).
///
/// Tujuannya: jangan mendaratkan pengguna baru di beranda tanpa arah —
/// tawarkan satu langkah pertama yang konkret (pesan layanan pertama atau
/// lengkapi profil), dengan opsi "nanti saja" untuk yang mau menjelajah dulu.
///
/// [role] = 'technician' bila yang memverifikasi adalah pendaftar teknisi.
/// Salinannya berbeda karena teknisi belum bisa mengambil pekerjaan sebelum
/// admin menyetujui akunnya.
class WelcomeScreen extends StatelessWidget {
  final String? role;
  const WelcomeScreen({super.key, this.role});

  bool get _isTechnician => role == 'technician';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SingleChildScrollView(
        child: Column(children: [
          AuthHero(
            title: 'Email terverifikasi!',
            subtitle: _isTechnician
                ? 'Pendaftaran teknisi diterima —\nakunmu menunggu persetujuan admin'
                : 'Selamat datang di Fixify —\nakunmu sudah aktif',
          ),
          AuthCard(
            child: _isTechnician
                ? _buildTechnicianCard(context)
                : _buildCustomerCard(context),
          ),
          const TrustRow(),
        ]),
      ),
    );
  }

  /// Pelanggan: jalan tercepat ke nilai pertama = memesan layanan, dengan
  /// alternatif melengkapi profil (alamat & nomor) supaya teknisi tidak
  /// menanyakan ulang saat datang.
  Widget _buildCustomerCard(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Center(child: _badge(Icons.verified_rounded, AppColors.mint, AppColors.mintTint)),
      _heading(
        'Mulai dari mana?',
        'Pesan layanan pertamamu sekarang, atau lengkapi profil dulu agar '
            'teknisi tahu alamat dan nomor yang bisa dihubungi.',
      ),
      const SizedBox(height: 22),
      GradientButton(
        label: 'Pesan Layanan Pertama',
        icon: Icons.home_repair_service_rounded,
        onPressed: () => _openShell(context, tab: 0),
      ),
      const SizedBox(height: 10),
      _outlined('Lengkapi Profil', Icons.person_outline_rounded,
          () => _openShell(context, tab: 4)),
      const SizedBox(height: 6),
      _skip('Nanti saja, lihat-lihat dulu', () => _openShell(context, tab: 0)),
    ]);
  }

  /// Teknisi: prioritasnya melengkapi profil (calon pekerjaan sudah menunggu
  /// persetujuan admin), dengan jalan pintas melihat daftar Pekerjaan.
  Widget _buildTechnicianCard(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Center(child: _badge(Icons.hourglass_top_rounded, AppColors.amber, AppColors.amberTint)),
      _heading(
        'Lengkapi profil teknismu',
        'Daftar pekerjaan terbuka otomatis setelah admin menyetujui akunmu '
            '(maks. 1x24 jam kerja). Siapkan profil sekarang supaya kamu siap '
            'mengambil pekerjaan begitu disetujui.',
      ),
      const SizedBox(height: 22),
      GradientButton(
        label: 'Lengkapi Profil',
        icon: Icons.person_outline_rounded,
        onPressed: () => _openShell(context, tab: 4),
      ),
      const SizedBox(height: 10),
      _outlined('Lihat Pekerjaan', Icons.handyman_rounded,
          () => _openShell(context, tab: 2)),
      const SizedBox(height: 6),
      _skip('Nanti saja', () => _openShell(context, tab: 0)),
    ]);
  }

  Widget _badge(IconData icon, Color color, Color tint) {
    return Container(
      width: 84,
      height: 84,
      margin: const EdgeInsets.only(bottom: 18),
      decoration: BoxDecoration(color: tint, shape: BoxShape.circle),
      child: Icon(icon, size: 44, color: color),
    );
  }

  Widget _heading(String title, String body) {
    return Column(children: [
      Text(title,
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.navy)),
      const SizedBox(height: 10),
      Text(body,
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 13, color: AppColors.inkSoft, height: 1.6)),
    ]);
  }

  Widget _outlined(String label, IconData icon, VoidCallback onTap) {
    return OutlinedButton.icon(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: AppColors.line, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      icon: Icon(icon, size: 19, color: AppColors.brandDeep),
      label: Text(label,
          style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink)),
    );
  }

  Widget _skip(String label, VoidCallback onTap) {
    return TextButton(
      onPressed: onTap,
      child: Text(label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.w700)),
    );
  }

  /// Masuk shell tab utama dengan tab awal [tab].
  ///
  /// Rute bernama '/' tidak bisa membawa tab (routes table tanpa argumen),
  /// jadi di sini dibuat MaterialPageRoute langsung ke
  /// `MainShell(initialIndex: tab)` — tetap ditandai nama '/' agar pelacak
  /// rute (AuthRouteObserver) mencatat bahwa pengguna sudah di beranda.
  /// [mainTabIndex] ikut diset supaya layar yang membacanya (mis. tombol
  /// avatar di beranda) sinkron dengan tab yang benar-benar tampil.
  void _openShell(BuildContext context, {required int tab}) {
    mainTabIndex.value = tab;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute<void>(
        builder: (_) => MainShell(initialIndex: tab),
        settings: const RouteSettings(name: '/'),
      ),
      (r) => false,
    );
  }
}
