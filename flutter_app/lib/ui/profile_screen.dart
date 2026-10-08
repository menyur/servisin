import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../push_service.dart';
import '../theme.dart';
import 'common.dart';
import 'auth_widgets.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Profile? _profile;
  bool _loading = true;
  bool _saving = false;
  bool _uploadingAvatar = false;

  late final _name = TextEditingController();
  late final _phone = TextEditingController();
  late final _address = TextEditingController();
  late final _serviceArea = TextEditingController(); // teknisi: daerah kerja

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await Api.myProfile().catchError((_) => null);
    if (!mounted) return;
    setState(() {
      _profile = p;
      _loading = false;
    });
    if (p != null) {
      _name.text = p.name;
      _phone.text = p.phone ?? '';
      _address.text = p.address ?? '';
      _serviceArea.text = p.serviceArea ?? '';
    }
  }

  /// Ganti foto profil: pilih sumber (galeri/kamera) → kompres 512px →
  /// upload ke profile-media → simpan URL ke profil → muat ulang tampilan.
  Future<void> _changeAvatar() async {
    final source = await chooseImageSource(context, title: 'Ganti Foto Profil');
    if (source == null || !mounted) return;
    setState(() => _uploadingAvatar = true);
    try {
      final bytes = await Api.pickAndCompressImage(source: source, maxSide: 512, quality: 80);
      if (bytes == null || !mounted) return; // pengguna batal memilih
      await Api.uploadAvatar(bytes);
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      showSnack(context, 'Foto profil diperbarui.');
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal memperbarui foto.');
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await Api.updateMyProfile(
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        address: _address.text.trim(),
        serviceArea: _profile?.role == 'technician' ? _serviceArea.text.trim() : null,
      );
      if (!mounted) return;
      showSnack(context, 'Profil tersimpan.');
    } catch (_) {
      if (mounted) showSnack(context, 'Gagal menyimpan profil.', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _logout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Keluar?'),
        content: const Text('Kamu perlu masuk lagi untuk memesan layanan.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.coral),
            child: const Text('Keluar'),
          ),
        ],
      ),
    );
    if (ok == true) {
      // Lepas ikatan token FCM dulu agar push berhenti ke perangkat ini.
      await PushService.onLoggedOut();
      await Api.signOut();
      if (!mounted) return;
      Navigator.pushNamedAndRemoveUntil(context, '/login', (r) => false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final initial = (_profile?.name.isNotEmpty ?? false) ? _profile!.name[0].toUpperCase() : '?';

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: EdgeInsets.zero,
              children: [
                // ===== Header gradien dengan avatar besar =====
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.brandDeep, AppColors.brand],
                    ),
                    borderRadius: BorderRadius.vertical(bottom: Radius.circular(30)),
                  ),
                  child: Column(children: [
                    // Avatar: bisa diketuk untuk ganti foto (galeri/kamera).
                    GestureDetector(
                      onTap: _uploadingAvatar ? null : _changeAvatar,
                      child: Stack(children: [
                        Container(
                          width: 92,
                          height: 92,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                            border: Border.all(
                                color: Colors.white.withValues(alpha: 0.7), width: 3),
                            boxShadow: [
                              BoxShadow(
                                  color: AppColors.navy.withValues(alpha: 0.2),
                                  blurRadius: 16,
                                  offset: const Offset(0, 6)),
                            ],
                          ),
                          child: ClipOval(
                            child: _profile?.avatarUrl != null
                                ? Image.network(
                                    _profile!.avatarUrl!,
                                    width: 92,
                                    height: 92,
                                    fit: BoxFit.cover,
                                    // Gagal memuat (mis. URL lama terhapus) →
                                    // kembali ke inisial, bukan layar rusak.
                                    errorBuilder: (_, __, ___) => Center(
                                      child: Text(initial,
                                          style: const TextStyle(
                                              fontSize: 36,
                                              fontWeight: FontWeight.w900,
                                              color: AppColors.brand)),
                                    ),
                                  )
                                : Center(
                                    child: Text(initial,
                                        style: const TextStyle(
                                            fontSize: 36,
                                            fontWeight: FontWeight.w900,
                                            color: AppColors.brand)),
                                  ),
                          ),
                        ),
                        // Chip kamera = tombol ganti foto (pola sama dengan web).
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: Container(
                            width: 28,
                            height: 28,
                            decoration: const BoxDecoration(
                                color: AppColors.brand, shape: BoxShape.circle),
                            child: _uploadingAvatar
                                ? const Padding(
                                    padding: EdgeInsets.all(7),
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white))
                                : const Icon(Icons.photo_camera_rounded,
                                    color: Colors.white, size: 15),
                          ),
                        ),
                        // Badge terverifikasi pindah ke kiri-atas.
                        Positioned(
                          left: 0,
                          top: 0,
                          child: Container(
                            width: 28,
                            height: 28,
                            decoration: const BoxDecoration(
                                color: AppColors.mint, shape: BoxShape.circle),
                            child: const Icon(Icons.verified_rounded,
                                color: Colors.white, size: 17),
                          ),
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _profile?.name.isNotEmpty ?? false ? _profile!.name : 'Pengguna Fixify',
                      style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: Colors.white),
                    ),
                    const SizedBox(height: 3),
                    Text(_profile?.email ?? '',
                        style: TextStyle(
                            fontSize: 12.5, color: Colors.white.withValues(alpha: 0.85))),
                    const SizedBox(height: 20),
                  ]),
                ),

                // ===== Kartu form melayang =====
                Transform.translate(
                  offset: const Offset(0, -22),
                  child: FloatingCard(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(children: [
                            const Icon(Icons.edit_rounded, size: 18, color: AppColors.brand),
                            const SizedBox(width: 8),
                            const Text('Ubah Data Diri',
                                style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                    color: AppColors.navy)),
                            const Spacer(),
                            if (_saving)
                              const SizedBox(
                                  height: 16,
                                  width: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2)),
                          ]),
                          const SizedBox(height: 14),
                          TextField(
                            controller: _name,
                            decoration: const InputDecoration(
                                labelText: 'Nama lengkap',
                                prefixIcon: Icon(Icons.badge_outlined)),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _phone,
                            keyboardType: TextInputType.phone,
                            decoration: const InputDecoration(
                                labelText: 'Nomor HP',
                                prefixIcon: Icon(Icons.phone_iphone_rounded)),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _address,
                            minLines: 2,
                            maxLines: 3,
                            decoration: const InputDecoration(
                                labelText: 'Alamat (dipakai untuk booking)',
                                prefixIcon: Icon(Icons.location_on_outlined)),
                          ),
                          // Teknisi: area kerja — dipakai memfilter notifikasi
                          // "Pekerjaan baru tersedia" sesuai alamat pesanan.
                          if (_profile?.role == 'technician') ...[
                            // Keahlian utama — READ-ONLY: ditetapkan admin saat
                            // kurasi pendaftaran; tidak ada kontrol ubah di sini
                            // (updateMyProfile juga tidak pernah menulis skill).
                            if (_profile?.skill?.isNotEmpty ?? false) ...[
                              const SizedBox(height: 12),
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: AppColors.brandTint,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                      color: AppColors.brand.withValues(alpha: 0.25)),
                                ),
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  const Icon(Icons.handyman_rounded,
                                      size: 20, color: AppColors.brand),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Text('Keahlian',
                                              style: TextStyle(
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w800,
                                                  color: AppColors.brandDeep)),
                                          const SizedBox(height: 2),
                                          Text(skillLabel(_profile!.skill),
                                              style: const TextStyle(
                                                  fontSize: 14.5,
                                                  fontWeight: FontWeight.w700,
                                                  color: AppColors.navy)),
                                          const SizedBox(height: 2),
                                          const Text('Ditetapkan admin — tidak dapat diubah',
                                              style: TextStyle(
                                                  fontSize: 11, color: AppColors.inkSoft)),
                                        ]),
                                  ),
                                  const Padding(
                                    padding: EdgeInsets.only(top: 2),
                                    child: Icon(Icons.lock_rounded,
                                        size: 16, color: AppColors.inkSoft),
                                  ),
                                ]),
                              ),
                            ],
                            const SizedBox(height: 12),
                            TextField(
                              controller: _serviceArea,
                              decoration: const InputDecoration(
                                  labelText: 'Area layanan (mis. Bandung)',
                                  helperText: 'Notifikasi pekerjaan baru hanya untuk area ini. Kosongkan untuk semua area.',
                                  prefixIcon: Icon(Icons.map_outlined)),
                            ),
                          ],
                          const SizedBox(height: 18),
                          GradientButton(
                            label: 'Simpan Perubahan',
                            icon: Icons.save_rounded,
                            loading: _saving,
                            onPressed: _save,
                          ),
                        ]),
                  ),
                ),

                // ===== Info akun + keluar =====
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  child: Column(children: [
                    const _MenuTile(
                      icon: Icons.verified_user_outlined,
                      color: AppColors.mint,
                      title: 'Akun terverifikasi',
                      subtitle: 'Login email & Google aktif',
                    ),
                    const SizedBox(height: 10),
                    _MenuTile(
                      icon: Icons.logout_rounded,
                      color: AppColors.coral,
                      title: 'Keluar dari akun',
                      subtitle: 'Sesi di perangkat ini akan dihapus',
                      onTap: _logout,
                    ),
                  ]),
                ),
              ],
            ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _MenuTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.line),
        ),
        child: ListTile(
          onTap: onTap,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, color: color, size: 21),
          ),
          title: Text(title,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.navy)),
          subtitle: Text(subtitle,
              style: const TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
          trailing: onTap != null
              ? const Icon(Icons.chevron_right_rounded, color: AppColors.inkSoft)
              : null,
        ),
      );
}
