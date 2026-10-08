import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import '../api.dart';
import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';

/// Halaman pendaftaran TEKNISI — paritas dengan /gabung di web:
///   nama, email, HP, alamat domisili, keahlian utama, foto KTP, kata sandi.
/// Foto KTP diunggah dulu ke bucket PRIVAT `ktp-documents/pendaftaran/`
/// (anon diizinkan khusus folder itu), path-nya dikirim sebagai `ktp_url`
/// di metadata signup. Akun baru lahir dengan approval_status 'pending'
/// (trigger DB) — teknisi bisa login tapi belum muncul di lowongan sampai
/// admin menyetujui lewat tab "Pendaftar Teknisi".
class TechnicianRegisterScreen extends StatefulWidget {
  const TechnicianRegisterScreen({super.key});

  @override
  State<TechnicianRegisterScreen> createState() =>
      _TechnicianRegisterScreenState();
}

/// Keahlian utama — nilai & label sama dengan dropdown /gabung di web,
/// supaya admin melihat istilah yang konsisten di kedua platform.
const _skills = <String, String>{
  'ac': 'Service AC',
  'tukang': 'Tukang rumah (listrik, ledeng, cat, dll.)',
  'kendaraan': 'Service kendaraan',
  'kebersihan': 'Kebersihan & laundry',
};

class _TechnicianRegisterScreenState extends State<TechnicianRegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _password = TextEditingController();
  String? _skill; // null = belum memilih
  Uint8List? _ktpBytes; // pratinjau lokal foto terpilih
  String? _ktpPath; // path di bucket ktp-documents
  bool _uploadingKtp = false;
  bool _loading = false;
  bool _obscure = true;

  /// 0-4: panjang>=6, huruf kecil, huruf besar, angka — sama dengan RegisterScreen.
  int get _strength {
    final v = _password.text;
    var s = 0;
    if (v.length >= 6) s++;
    if (v.contains(RegExp(r'[a-z]'))) s++;
    if (v.contains(RegExp(r'[A-Z]'))) s++;
    if (v.contains(RegExp(r'[0-9]'))) s++;
    return s;
  }

  /// Pilih foto KTP (galeri/kamera) → kompres 1200px/kualitas 90 (teks KTP
  /// tetap terbaca admin, pola sama dengan web) → upload ke folder anon.
  Future<void> _pickKtp() async {
    final source = await chooseImageSource(context, title: 'Unggah Foto KTP');
    if (source == null || !mounted) return;
    setState(() => _uploadingKtp = true);
    try {
      final bytes =
          await Api.pickAndCompressImage(source: source, maxSide: 1200, quality: 90);
      if (bytes == null) return; // pengguna batal memilih
      final path = await Api.uploadKtpPendaftaran(bytes);
      if (!mounted) return;
      setState(() {
        _ktpBytes = bytes;
        _ktpPath = path;
      });
    } catch (e) {
      if (mounted) {
        showSnackError(context, e, 'Gagal mengunggah KTP — periksa koneksi lalu coba lagi.');
      }
    } finally {
      if (mounted) setState(() => _uploadingKtp = false);
    }
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    // Validasi kurasi teknisi — paritas dengan server action web.
    if (_skill == null) {
      showSnack(context, 'Pilih keahlian utamamu dulu.', error: true);
      return;
    }
    if (_ktpPath == null) {
      showSnack(context, 'Unggah foto KTP dulu untuk verifikasi identitas.',
          error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await Api.signUpTechnician(
        email: _email.text.trim(),
        password: _password.text,
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        address: _address.text.trim(),
        skill: _skill!,
        ktpPath: _ktpPath!,
      );
      if (!mounted) return;
      if (res.session == null) {
        // Proyek menonaktifkan "Confirm email", tapi kalau aktif:
        showSnack(context,
            'Pendaftaran terkirim! Verifikasi email dulu, lalu masuk untuk melengkapi profil.');
        Navigator.pushReplacementNamed(context, '/login');
      } else {
        // Langsung login: tampilkan status pending, karena tab Pekerjaan
        // baru terisi setelah admin menyetujui pendaftaran.
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            icon: const Icon(Icons.hourglass_top_rounded,
                color: AppColors.amber, size: 40),
            title: const Text('Pendaftaran terkirim!'),
            content: const Text(
              'Selamat datang, calon teknisi Fixify!\n\n'
              'Akunmu sedang MENUNGGU PERSETUJUAN admin (1x24 jam kerja). '
              'Kamu sudah bisa masuk dan melengkapi profil — daftar pekerjaan '
              'akan terbuka otomatis setelah akunmu disetujui.',
            ),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Mengerti'),
              ),
            ],
          ),
        );
        if (!mounted) return;
        Navigator.pushNamedAndRemoveUntil(context, '/', (r) => false);
      }
    } on AuthException catch (e) {
      if (mounted) showSnack(context, friendlyAuthError(e.message), error: true);
    } catch (_) {
      if (mounted) {
        showSnack(context, 'Gagal mendaftar. Periksa koneksi internet.', error: true);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Pesan error signup yang ramah — paritas dengan server action web.
  String friendlyAuthError(String msg) {
    final m = msg.toLowerCase();
    if (m.contains('rate limit')) {
      return 'Terlalu banyak percobaan pendaftaran dalam waktu singkat — coba lagi sekitar 1 jam ke depan.';
    }
    if (m.contains('already registered') || m.contains('already exists')) {
      return 'Email ini sudah terdaftar. Silakan Masuk, atau gunakan email lain.';
    }
    if (m.contains('invalid email')) return 'Format email tidak valid — periksa lagi penulisannya.';
    if (m.contains('least') || m.contains('short')) return 'Kata sandi terlalu pendek — minimal 6 karakter.';
    return msg;
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _address.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SingleChildScrollView(
        child: Column(children: [
          AuthHero(
            title: 'Daftar Jadi Teknisi',
            subtitle: 'Terima pesanan, atur jadwal sendiri,\ndan dapatkan penghasilan',
            onBack: () => Navigator.pop(context),
          ),
          AuthCard(
            child: Form(
              key: _form,
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextFormField(
                      controller: _name,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(
                          labelText: 'Nama lengkap',
                          prefixIcon: Icon(Icons.badge_outlined)),
                      validator: (v) =>
                          (v == null || v.trim().isEmpty) ? 'Nama wajib diisi' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(
                          labelText: 'Email',
                          prefixIcon: Icon(Icons.mail_outline)),
                      validator: (v) =>
                          (v == null || !v.contains('@')) ? 'Email tidak valid' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _phone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                          labelText: 'Nomor HP',
                          hintText: '0812xxxxxxxx',
                          prefixIcon: Icon(Icons.phone_iphone_rounded)),
                      validator: (v) => (v == null || v.trim().length < 8)
                          ? 'Nomor HP wajib diisi (untuk koordinasi pekerjaan)'
                          : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _address,
                      minLines: 2,
                      maxLines: 3,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(
                          labelText: 'Alamat domisili',
                          hintText: 'Nama jalan, nomor rumah, kelurahan, kota',
                          prefixIcon: Icon(Icons.location_on_outlined)),
                      validator: (v) => (v == null || v.trim().isEmpty)
                          ? 'Alamat domisili wajib diisi untuk verifikasi'
                          : null,
                    ),
                    const SizedBox(height: 14),
                    // Keahlian utama — dropdown dengan nilai sama seperti web.
                    DropdownButtonFormField<String>(
                      initialValue: _skill,
                      decoration: const InputDecoration(
                          labelText: 'Keahlian utama',
                          prefixIcon: Icon(Icons.handyman_rounded)),
                      items: _skills.entries
                          .map((e) => DropdownMenuItem(
                              value: e.key,
                              child: Text(e.value,
                                  style: const TextStyle(fontSize: 13.5))))
                          .toList(),
                      onChanged: (v) => setState(() => _skill = v),
                      validator: (v) =>
                          v == null ? 'Pilih keahlian utamamu' : null,
                    ),
                    const SizedBox(height: 16),
                    // ===== Unggah KTP =====
                    const Text('Foto KTP (verifikasi identitas)',
                        style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w800,
                            color: AppColors.navy)),
                    const SizedBox(height: 8),
                    GestureDetector(
                      onTap: _uploadingKtp ? null : _pickKtp,
                      child: Container(
                        height: 150,
                        decoration: BoxDecoration(
                          color: AppColors.paper,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                              color: _ktpPath == null
                                  ? AppColors.line
                                  : AppColors.mint,
                              width: 1.5),
                        ),
                        child: _uploadingKtp
                            ? const Center(
                                child: SizedBox(
                                    width: 26,
                                    height: 26,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2.4)))
                            : _ktpBytes != null
                                ? ClipRRect(
                                    borderRadius: BorderRadius.circular(12.5),
                                    child: Stack(fit: StackFit.expand, children: [
                                      Image.memory(_ktpBytes!, fit: BoxFit.cover),
                                      // Lapis tipis agar badge tetap terbaca.
                                      Container(
                                          color: Colors.black.withValues(alpha: 0.15)),
                                      Positioned(
                                        right: 8,
                                        top: 8,
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 9, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: AppColors.mint,
                                            borderRadius:
                                                BorderRadius.circular(999),
                                          ),
                                          child: const Row(mainAxisSize: MainAxisSize.min, children: [
                                            Icon(Icons.check_rounded,
                                                size: 13, color: Colors.white),
                                            SizedBox(width: 3),
                                            Text('Terunggah',
                                                style: TextStyle(
                                                    fontSize: 11,
                                                    fontWeight: FontWeight.w800,
                                                    color: Colors.white)),
                                          ]),
                                        ),
                                      ),
                                    ]),
                                  )
                                : const Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Icon(Icons.badge_rounded,
                                          size: 34, color: AppColors.inkSoft),
                                      SizedBox(height: 6),
                                      Text('Ketuk untuk unggah foto KTP',
                                          style: TextStyle(
                                              fontSize: 12.5,
                                              fontWeight: FontWeight.w700)),
                                      SizedBox(height: 2),
                                      Text('JPG/PNG — tulisan KTP terbaca jelas',
                                          style: TextStyle(
                                              fontSize: 11,
                                              color: AppColors.inkSoft)),
                                    ],
                                  ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        labelText: 'Kata sandi (min. 6 karakter)',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_obscure
                              ? Icons.visibility_off
                              : Icons.visibility),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: (v) =>
                          (v == null || v.length < 6) ? 'Minimal 6 karakter' : null,
                    ),
                    // Indikator kekuatan sandi (sama seperti RegisterScreen).
                    if (_password.text.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Row(children: List.generate(4, (i) {
                        final on = i < _strength;
                        final color = _strength <= 1
                            ? AppColors.coral
                            : _strength == 2
                                ? AppColors.amber
                                : AppColors.mint;
                        return Expanded(
                          child: Container(
                            height: 4,
                            margin: EdgeInsets.only(right: i == 3 ? 0 : 5),
                            decoration: BoxDecoration(
                              color: on ? color : AppColors.line,
                              borderRadius: BorderRadius.circular(999),
                            ),
                          ),
                        );
                      })),
                      const SizedBox(height: 6),
                      Text(
                        switch (_strength) {
                          1 => 'Lemah - tambahkan huruf besar & angka',
                          2 => 'Sedang',
                          3 => 'Kuat',
                          _ => 'Sangat kuat',
                        },
                        style: const TextStyle(
                            fontSize: 11.5, color: AppColors.inkSoft),
                      ),
                    ],
                    const SizedBox(height: 22),
                    GradientButton(
                      label: 'Kirim Pendaftaran',
                      icon: Icons.handyman_rounded,
                      loading: _loading,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'Pendaftaranmu akan ditinjau admin (maks. 1x24 jam kerja). '
                      'Kamu bisa masuk setelah ini, tapi daftar pekerjaan terbuka '
                      'setelah akunmu disetujui.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 11.5,
                          color: AppColors.inkSoft,
                          height: 1.5),
                    ),
                  ]),
            ),
          ),
          const TrustRow(),
        ]),
      ),
    );
  }
}
