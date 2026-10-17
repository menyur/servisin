import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../account_deletion.dart';
import '../api.dart';
import '../chat_unread.dart';
import '../config.dart';
import '../models.dart';
import '../push_service.dart';
import '../theme.dart';
import 'common.dart';
import 'auth_widgets.dart';
import 'notification_settings_screen.dart';

class ProfileScreen extends StatefulWidget {
  /// Seam uji: sumber profil (default `Api.myProfile`).
  final Future<Profile?> Function()? loadProfile;

  /// Seam uji: sumber ringkasan penilaian teknisi (default
  /// `Api.myRatingSummary`). Dipanggil HANYA untuk peran teknisi.
  final Future<RatingSummary?> Function()? loadRating;

  /// Seam uji: pembuka tautan (default `url_launcher`). Dipakai tombol
  /// "Buka halaman bantuan" pada kartu status persetujuan.
  final Future<bool> Function(Uri)? openLink;

  const ProfileScreen({
    super.key,
    this.loadProfile,
    this.loadRating,
    this.openLink,
  });

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Profile? _profile;

  /// Ringkasan penilaian teknisi. Null = belum dibaca / gagal dibaca / bukan
  /// teknisi — dalam semua kasus itu lencananya tidak ditampilkan.
  RatingSummary? _rating;
  /// Status permintaan hapus akun (jalur dalam aplikasi, syarat Google Play).
  AccountDeletionState _hapus = AccountDeletionState.kosong;
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

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _address.dispose();
    _serviceArea.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    Profile? p;
    try {
      p = await (widget.loadProfile?.call() ?? Api.myProfile());
    } catch (_) {
      p = null; // gagal baca profil → layar tetap tampil, hanya tanpa data
    }
    // Server memutuskan boleh/tidaknya penghapusan; di sini hanya ditampilkan.
    final hapus = await Api.myAccountDeletion();
    // Penilaian hanya relevan untuk teknisi, dan baru diambil setelah perannya
    // diketahui — pelanggan tidak perlu satu query tambahan. Gagal baca → null,
    // layar menyembunyikan lencananya (lihat Api.myRatingSummary).
    RatingSummary? rating;
    if (p?.role == 'technician') {
      try {
        rating = await (widget.loadRating?.call() ?? Api.myRatingSummary());
      } catch (_) {
        rating = null;
      }
    }
    if (!mounted) return;
    // Titik pengingat di tab Profil memakai data yang sama dengan banner di
    // layar ini — diperbarui di sini supaya langsung hilang setelah lengkap.
    profilPerluDilengkapi.value = dataProfilKurang(p).isNotEmpty;
    setState(() {
      _profile = p;
      _hapus = hapus;
      _rating = rating;
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
      final lama = _profile;
      final baru = lama == null
          ? null
          : Profile(
              id: lama.id,
              name: _name.text.trim(),
              email: lama.email,
              phone: _phone.text.trim(),
              address: _address.text.trim(),
              avatarUrl: lama.avatarUrl,
              role: lama.role,
              serviceArea: lama.role == 'technician'
                  ? _serviceArea.text.trim()
                  : lama.serviceArea,
              skill: lama.skill,
              balance: lama.balance,
              balanceReminderAt: lama.balanceReminderAt,
              // Simpan status kurasi apa adanya. Tanpa ini, menyimpan data diri
              // akan mengembalikan status ke default 'approved' di layar dan
              // kartu "menunggu/ditolak" hilang sampai profil dimuat ulang.
              approvalStatus: lama.approvalStatus,
            );
      await Api.updateMyProfile(
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        address: _address.text.trim(),
        serviceArea: lama?.role == 'technician' ? _serviceArea.text.trim() : null,
      );
      if (!mounted) return;
      // Perbarui tampilan dari data yang baru disimpan (tanpa permintaan ulang
      // yang bisa gagal dan mengosongkan layar): banner pengingat dan titik di
      // tab Profil ikut hilang begitu datanya lengkap.
      if (baru != null) {
        setState(() => _profile = baru);
        profilPerluDilengkapi.value = dataProfilKurang(baru).isNotEmpty;
      }
      showSnack(context, 'Profil tersimpan.');
    } catch (_) {
      if (mounted) showSnack(context, 'Gagal menyimpan profil.', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Ajukan penghapusan akun dari dalam aplikasi.
  ///
  /// Ada dua cabang yang sengaja dipisah supaya tidak ada tombol pasti-gagal
  /// (pola yang sama dengan tombol "Batalkan" di detail pesanan): server sudah
  /// menilai kelayakan lewat `hapus_akun_blokir`, dan bila belum layak pengguna
  /// membaca alasannya, bukan pesan kesalahan umum.
  Future<void> _hapusAkun() async {
    if (!_hapus.bolehAjukan) {
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Text(_hapus.menungguOperator ? 'Permintaan sedang diproses' : 'Belum bisa dihapus'),
          content: Text(
            _hapus.menungguOperator
                ? 'Permintaan hapus akunmu sudah masuk antrean kami (${hapusAkunStatusLabel(_hapus.status)}). '
                    'Kamu bisa membatalkannya selama belum dijalankan.'
                : _hapus.alasanBlokir,
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Mengerti')),
          ],
        ),
      );
      return;
    }

    final alasan = await showDialog<String>(
      context: context,
      builder: (_) => const _HapusAkunDialog(),
    );
    if (alasan == null || !mounted) return; // dibatalkan

    try {
      final hasil = await Api.requestAccountDeletion(alasan);
      if (!mounted) return;
      if (!hasil.ok) {
        showSnack(context, hasil.error ?? 'Permintaan tidak bisa diajukan.', error: true);
        return;
      }
      setState(() => _hapus = hasil.state);
      showSnack(context, 'Permintaan hapus akun terkirim. Kami proses paling lambat 7 hari.');
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mengajukan penghapusan akun.');
    }
  }

  /// Batalkan permintaan hapus akun yang belum dijalankan operator.
  Future<void> _batalkanHapus() async {
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Batalkan permintaan hapus akun?'),
        content: const Text('Akunmu tetap aktif dan tidak akan dihapus.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Tidak jadi')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Batalkan')),
        ],
      ),
    );
    if (ya != true || !mounted) return;

    final hasil = await Api.cancelAccountDeletion();
    if (!mounted) return;
    if (!hasil.ok) {
      showSnack(context, hasil.error ?? 'Gagal membatalkan permintaan.', error: true);
      return;
    }
    final terbaru = await Api.myAccountDeletion();
    if (!mounted) return;
    setState(() => _hapus = terbaru);
    showSnack(context, 'Permintaan hapus akun dibatalkan.');
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
      // Badge chat ikut hilang; snapshot tetap tersimpan untuk login berikutnya.
      await ChatUnreadService.clear();
      await Api.signOut();
      if (!mounted) return;
      Navigator.pushNamedAndRemoveUntil(context, '/login', (r) => false);
    }
  }

  /// Buka halaman kontak resmi di browser. Dipakai kartu status persetujuan:
  /// teknisi bisa langsung menghubungi admin tanpa mencari alamat email.
  Future<void> _bukaBantuan() async {
    final uri = Uri.parse(AppConfig.tentangUrl);
    try {
      final dibuka = await (widget.openLink?.call(uri) ??
          launchUrl(uri, mode: LaunchMode.externalApplication));
      if (!dibuka && mounted) {
        showSnack(context, 'Halaman bantuan tidak bisa dibuka.', error: true);
      }
    } catch (_) {
      if (mounted) {
        showSnack(context, 'Halaman bantuan tidak bisa dibuka.', error: true);
      }
    }
  }

  /// Pengaturan notifikasi per peristiwa — sebelumnya hanya bisa diubah dari
  /// panel web, sehingga teknisi di HP tidak punya cara menyalakan pengingat
  /// pekerjaan/saldo saat ada yang tidak sengaja dimatikan.
  void _bukaNotifikasi() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => NotificationSettingsScreen(
        isTechnician: _profile?.role == 'technician',
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final initial = (_profile?.name.isNotEmpty ?? false) ? _profile!.name[0].toUpperCase() : '?';
    // Lencana rating hanya untuk teknisi dan hanya bila datanya terbaca.
    final tampilRating = _profile?.role == 'technician' && _rating != null;
    final kurangProfil = dataProfilKurang(_profile);
    // Status kurasi hanya untuk teknisi. 'approved' tidak perlu kartu — yang
    // perlu tindakan adalah akun yang masih menunggu atau sudah ditolak.
    final statusKurasi = _profile?.role == 'technician'
        ? _profile!.approvalStatus
        : 'approved';
    final tampilStatusKurasi =
        statusKurasi == 'pending' || statusKurasi == 'rejected';

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: EdgeInsets.zero,
              children: [
                // ===== Header gradien (3 warna + lingkaran hiasan) + avatar =====
                // Latar & hiasan sama dengan tab lain (ScreenHeader) supaya
                // header Profil satu keluarga dengan Pesanan/Pekerjaan/Laporan.
                HeaderGradientBackground(
                  // 20 (desain) + inset bilah status. Sejak Android 15/16
                  // memaksa edge-to-edge, inset atas > 0 dan tanpa tambahan ini
                  // avatar/tombol header tertimpa jam & baterai. Di perangkat
                  // non-edge-to-edge inset = 0 → tampilan tak berubah.
                  padding: EdgeInsets.fromLTRB(
                      20, 20 + MediaQuery.paddingOf(context).top, 20, 0),
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
                    // Reputasi teknisi tepat di bawah identitasnya: jumlah ulasan
                    // + rata-rata rating. Hanya untuk teknisi, dan hanya bila
                    // datanya benar-benar terbaca (gagal baca → tidak ditampilkan,
                    // bukan "Belum ada rating" yang bisa menyesatkan).
                    if (tampilRating) ...[
                      const SizedBox(height: 10),
                      TechRatingPill(ringkasan: _rating!),
                    ],
                    // Kartu form di bawah mengapung 24 px ke atas. Saat lencana
                    // rating ada, sisakan ruang lebih agar kartu tidak menutupi
                    // lencana (dulu tertutup hampir seluruhnya sehingga rating
                    // tak terlihat sama sekali).
                    SizedBox(height: tampilRating ? 32 : 20),
                  ]),
                ),

                // ===== Kartu form melayang =====
                // Jangan dibungkus Transform.translate lagi: FloatingCard sudah
                // menggeser dirinya -24 px. Dua geseran bertumpuk (-46) membuat
                // kartu menutupi lencana rating di header.
                FloatingCard(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Status kurasi akun teknisi: alasan kenapa belum bisa
                          // mengambil pekerjaan + langkah yang bisa dilakukan
                          // sekarang. Diletakkan paling atas agar terbaca sebelum
                          // formulir data diri.
                          if (tampilStatusKurasi) ...[
                            _StatusPersetujuanTeknisi(
                              ditolak: statusKurasi == 'rejected',
                              kurang: kurangProfil,
                              onBukaBantuan: _bukaBantuan,
                            ),
                            const SizedBox(height: 16),
                          ],
                          // Pengingat tetap (bukan SnackBar sekali lewat) untuk
                          // teknisi yang datanya belum lengkap — teknisi baru
                          // mendarat di sini dan langsung tahu apa yang kurang.
                          // Saat status kurasi tampil, daftar yang kurang sudah
                          // menjadi langkah pertama di kartu status; jangan
                          // mengulanginya dalam dua kartu.
                          if (kurangProfil.isNotEmpty && !tampilStatusKurasi) ...[
                            _PeringatanLengkapiProfil(kurang: kurangProfil),
                            const SizedBox(height: 16),
                          ],
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

                // ===== Info akun + keluar =====
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  child: Column(children: [
                    _MenuTile(
                      icon: Icons.notifications_active_outlined,
                      color: AppColors.brand,
                      title: 'Notifikasi',
                      subtitle: 'Pekerjaan, saldo, laporan & chat',
                      onTap: _bukaNotifikasi,
                    ),
                    const SizedBox(height: 10),
                    const _MenuTile(
                      icon: Icons.verified_user_outlined,
                      color: AppColors.mint,
                      title: 'Akun terverifikasi',
                      subtitle: 'Login email & Google aktif',
                    ),
                    const SizedBox(height: 10),
                    // Jalur hapus akun (syarat Google Play). Selalu terlihat —
                    // hanya tindakannya yang menyesuaikan keadaan: ajukan,
                    // batalkan, atau jelaskan apa yang masih menahan.
                    _MenuTile(
                      icon: _hapus.menungguOperator
                          ? Icons.undo_rounded
                          : Icons.delete_forever_outlined,
                      color: AppColors.coral,
                      title: _hapus.menungguOperator ? 'Batalkan hapus akun' : 'Hapus akun',
                      subtitle: _hapus.menungguOperator
                          ? hapusAkunStatusLabel(_hapus.status)
                          : (_hapus.blokir != null
                              ? hapusAkunBlokirPesan(_hapus.blokir)
                              : 'Ajukan penghapusan akun & data pribadimu'),
                      onTap: _hapus.menungguOperator ? _batalkanHapus : _hapusAkun,
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

/// Kartu status persetujuan akun teknisi (pending / ditolak) beserta langkah
/// perbaikan yang bisa dilakukan dari layar Profil.
///
/// Status 'approved' tidak pernah memakai kartu ini. Alasan penolakan tidak
/// disimpan server, jadi langkah di sini bersifat umum: lengkapi data, simpan,
/// lalu minta admin meninjau ulang lewat email resmi.
class _StatusPersetujuanTeknisi extends StatelessWidget {
  final bool ditolak;
  final List<String> kurang;
  final VoidCallback onBukaBantuan;

  const _StatusPersetujuanTeknisi({
    required this.ditolak,
    required this.kurang,
    required this.onBukaBantuan,
  });

  @override
  Widget build(BuildContext context) {
    final warna = ditolak ? AppColors.coral : AppColors.amber;
    final latar = ditolak ? AppColors.coralTint : AppColors.amberTint;
    final langkah = <String>[
      if (kurang.isNotEmpty)
        'Lengkapi ${kurang.join(', ')} pada formulir di bawah.'
      else if (ditolak)
        'Pastikan nama, nomor HP, alamat, dan area layanan sudah benar.'
      else
        'Data profilmu sudah lengkap. Tidak ada yang perlu diubah.',
      if (ditolak) ...[
        'Tekan Simpan Perubahan setelah memperbaiki data.',
        'Buka halaman bantuan, lalu kirim email ke admin dengan subjek '
            '"Peninjauan ulang pendaftaran teknisi". Sertakan nama, email akun, '
            'dan keahlian yang perlu diubah.',
      ] else ...[
        'Tunggu admin memeriksa pendaftaranmu — keputusannya dikirim sebagai '
            'notifikasi ke HP ini.',
        'Bila lebih dari 1×24 jam, buka halaman bantuan dan hubungi admin '
            'lewat alamat yang tercantum.',
      ],
    ];

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: latar,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: warna.withValues(alpha: 0.5)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: warna.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: Icon(
              ditolak ? Icons.cancel_outlined : Icons.hourglass_top_rounded,
              size: 20,
              color: warna,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  ditolak
                      ? 'Pendaftaran teknisi ditolak'
                      : 'Menunggu persetujuan admin',
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: warna,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  ditolak
                      ? 'Akunmu belum bisa mengambil pekerjaan. Perbaiki data di '
                          'bawah, lalu minta admin meninjau ulang.'
                      : 'Kamu sudah bisa masuk dan mengisi profil, tetapi belum '
                          'bisa mengambil pekerjaan sampai admin menyetujui '
                          'pendaftaran.',
                  style: const TextStyle(
                    fontSize: 12,
                    height: 1.45,
                    color: AppColors.ink,
                  ),
                ),
              ],
            ),
          ),
        ]),
        const SizedBox(height: 12),
        const Text(
          'Langkah perbaikan',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            color: AppColors.navy,
          ),
        ),
        const SizedBox(height: 7),
        for (var i = 0; i < langkah.length; i++) ...[
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 18,
                height: 18,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: warna.withValues(alpha: 0.16),
                  shape: BoxShape.circle,
                ),
                child: Text(
                  '${i + 1}',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    color: warna,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  langkah[i],
                  style: const TextStyle(
                    fontSize: 12,
                    height: 1.45,
                    color: AppColors.ink,
                  ),
                ),
              ),
            ]),
          ),
        ],
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          // Bukan OutlinedButton.icon: label di dalamnya tidak dibatasi lebar
          // sehingga pada layar 320 px tombol meluber ke kanan. Flexible di
          // sini membiarkan label membungkus, bukan terpotong.
          child: OutlinedButton(
            onPressed: onBukaBantuan,
            style: OutlinedButton.styleFrom(
              foregroundColor: warna,
              side: BorderSide(color: warna.withValues(alpha: 0.55)),
              minimumSize: const Size.fromHeight(40),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.max,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.open_in_new_rounded, size: 16),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    'Buka halaman bantuan',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: warna,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ]),
    );
  }
}

/// Pengingat melengkapi data profil teknisi, di dalam kartu form.
///
/// Sengaja diletakkan di dalam kartu (bukan header) supaya terbaca jelas dan
/// tidak pernah tertutup kartu yang mengapung. Isinya menyebut field yang
/// kosong agar teknisi tidak menebak-nebak apa yang harus diisi.
class _PeringatanLengkapiProfil extends StatelessWidget {
  final List<String> kurang;

  const _PeringatanLengkapiProfil({required this.kurang});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.amberTint,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.amber.withValues(alpha: 0.45)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.info_outline_rounded, size: 20, color: AppColors.amber),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Lengkapi data profil',
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.amber)),
              const SizedBox(height: 3),
              Text(
                'Masih kosong: ${kurang.join(', ')}. Profil lengkap membantumu '
                'menerima pekerjaan yang sesuai.',
                style: const TextStyle(
                    fontSize: 12, height: 1.45, color: AppColors.ink),
              ),
            ],
          ),
        ),
      ]),
    );
  }
}

/// Lencana ringkasan penilaian teknisi di header Profil: bintang + rata-rata +
/// jumlah ulasan, mis. "4,8 · 12 ulasan" (atau "Belum ada rating").
///
/// Dibuat publik supaya bisa ditemukan & diperiksa tes widget; gayanya mengikuti
/// chip putih transparan di header gradien agar menyatu dengan avatar/nama.
/// Tanpa penilaian tetap ditampilkan (dengan bintang redup) — teknisi baru perlu
/// tahu keadaan sebenarnya, bukan lencana yang menghilang tanpa penjelasan.
class TechRatingPill extends StatelessWidget {
  final RatingSummary ringkasan;

  const TechRatingPill({super.key, required this.ringkasan});

  @override
  Widget build(BuildContext context) {
    final ada = ringkasan.adaPenilaian;
    return Semantics(
      label: ratingSummarySemantics(ringkasan),
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: ada ? 0.22 : 0.14),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: Colors.white.withValues(alpha: 0.45)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.star_rounded,
              size: 17, color: ada ? AppColors.amber : Colors.white.withValues(alpha: 0.6)),
          const SizedBox(width: 6),
          Text(
            ratingSummaryLabel(ringkasan),
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: Colors.white.withValues(alpha: ada ? 1 : 0.85),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Dialog konfirmasi hapus akun: daftar akibat + alasan opsional + ketik HAPUS.
///
/// Penghapusan tidak bisa dibatalkan, jadi sengaja butuh dua sadar: membaca
/// akibatnya, lalu mengetik kata konfirmasi. Tombolnya tetap satu ketukan dari
/// halaman Profil (`_MenuTile` di atas), sesuai syarat Google Play bahwa
/// jalurnya harus mudah ditemukan.
class _HapusAkunDialog extends StatefulWidget {
  const _HapusAkunDialog();

  @override
  State<_HapusAkunDialog> createState() => _HapusAkunDialogState();
}

class _HapusAkunDialogState extends State<_HapusAkunDialog> {
  final _ketik = TextEditingController();
  final _alasan = TextEditingController();
  bool _sah = false;

  @override
  void dispose() {
    _ketik.dispose();
    _alasan.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Hapus akun Fixify?'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Permintaan ini diproses paling lambat 7 hari. Yang dihapus: akun & akses masuk, '
                'nama, nomor HP, foto profil, alamat, foto KTP, percakapan, lampiran, dan laporan.',
                style: TextStyle(fontSize: 13, height: 1.5),
              ),
              const SizedBox(height: 8),
              const Text(
                'Yang tetap tersimpan tanpa identitasmu: riwayat pesanan (catatan audit) serta saldo, '
                'komisi, dan penilaian (pembukuan).',
                style: TextStyle(fontSize: 13, height: 1.5, color: AppColors.inkSoft),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _alasan,
                maxLength: 300,
                minLines: 1,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Alasan (opsional)',
                  counterText: '',
                ),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: _ketik,
                textCapitalization: TextCapitalization.characters,
                onChanged: (v) => setState(() => _sah = konfirmasiKetikSah(v)),
                decoration: const InputDecoration(
                  labelText: 'Ketik HAPUS untuk mengonfirmasi',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
          FilledButton(
            onPressed: _sah ? () => Navigator.pop(context, rapikanAlasan(_alasan.text)) : null,
            style: FilledButton.styleFrom(backgroundColor: AppColors.coral),
            child: const Text('Ajukan hapus akun'),
          ),
        ],
      );
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

  // Material (bukan Container berwarna) supaya ListTile bisa melukis latar &
  // ink splash-nya sendiri — Container/DecoratedBox berwarna akan menutupinya
  // dan memicu assertion "ListTile background color or ink splashes may be
  // invisible." di mode debug.
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        clipBehavior: Clip.antiAlias,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
          side: BorderSide(color: AppColors.line),
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
