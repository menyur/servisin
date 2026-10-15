import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../api.dart';
import '../config.dart';
import '../register_http.dart';
import '../signup_handoff.dart';
import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';
import 'google_signin_button.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, this.daftar});

  /// Seam uji widget: ganti pengiriman pendaftaran. `null` (produksi) =
  /// [Api.daftarAkun] ke server web (POST /api/auth/register).
  final KirimPendaftaran? daftar;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  bool _obscure = true;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _address.dispose();
    _password.dispose();
    super.dispose();
  }

  /// 0-4: panjang>=6, huruf kecil, huruf besar, angka.
  int get _strength {
    final v = _password.text;
    var s = 0;
    if (v.length >= 6) s++;
    if (v.contains(RegExp(r'[a-z]'))) s++;
    if (v.contains(RegExp(r'[A-Z]'))) s++;
    if (v.contains(RegExp(r'[0-9]'))) s++;
    return s;
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      // Pendaftaran dikirim ke server web (POST /api/auth/register) yang membuat
      // akunnya lewat Admin API lalu MENGIRIM email verifikasinya lewat Resend —
      // bukan `db.auth.signUp`, yang selalu meminta mailer bawaan Supabase
      // mengirim email (hanya untuk anggota tim project, 2 pesan/jam) sehingga
      // email verifikasi pelanggan biasa tidak pernah berangkat. Lihat
      // src/lib/signup-verification.js.
      final kirim = widget.daftar ?? Api.daftarAkun;
      final hasil = await kirim(
        email: _email.text.trim(),
        password: _password.text,
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        address: _address.text.trim(),
        // Android: tombol verifikasi di email balik ke app lewat deep link
        // fixify://confirm — sesi langsung aktif, pengguna mendarat di beranda.
        redirectTo: kIsWeb ? null : AppConfig.signupConfirmRedirect,
      );
      if (!mounted) return;
      if (!hasil.ok) {
        showSnack(context, hasil.pesan ?? 'Gagal membuat akun. Coba lagi nanti.',
            error: true);
        return;
      }
      // Akun SELALU menunggu verifikasi email: dibuat lewat Admin API dalam
      // keadaan belum terkonfirmasi. Di Android tautan emailnya membuka app
      // kembali (bukan browser) — catat email yang menunggu supaya app bisa
      // menampilkan layar Selamat Datang setelah terverifikasi.
      if (!kIsWeb) await SignupHandoff.remember(_email.text.trim());
      if (!mounted) return;
      showSnack(context,
          'Akun dibuat! Buka tautan verifikasi di email — kamu akan kembali ke aplikasi.');
      Navigator.pushReplacementNamed(context, '/login');
    } catch (_) {
      if (mounted) showSnack(context, 'Gagal mendaftar. Periksa koneksi internet.', error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SingleChildScrollView(
        child: Column(children: [
          AuthHero(
            title: 'Buat akun baru',
            subtitle: 'Satu akun untuk semua kebutuhan\nservis rumahmu',
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
                          labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
                      validator: (v) =>
                          (v == null || !v.contains('@')) ? 'Email tidak valid' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _phone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                          labelText: 'Nomor HP (opsional)',
                          prefixIcon: Icon(Icons.phone_iphone_rounded)),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _address,
                      minLines: 2,
                      maxLines: 3,
                      decoration: const InputDecoration(
                          labelText: 'Alamat',
                          hintText: 'Nama jalan, nomor rumah, kelurahan, kota',
                          prefixIcon: Icon(Icons.location_on_outlined)),
                      validator: (v) => (v == null || v.trim().isEmpty)
                          ? 'Alamat wajib diisi untuk booking'
                          : null,
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
                          icon: Icon(
                              _obscure ? Icons.visibility_off : Icons.visibility),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: (v) =>
                          (v == null || v.length < 6) ? 'Minimal 6 karakter' : null,
                    ),
                    // Indikator kekuatan sandi (real-time)
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
                      label: 'Daftar Sekarang',
                      icon: Icons.person_add_alt_rounded,
                      loading: _loading,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: 14),
                    const Row(children: [
                      Expanded(child: Divider(color: AppColors.line)),
                      Padding(
                        padding: EdgeInsets.symmetric(horizontal: 12),
                        child: Text('atau daftar dengan',
                            style: TextStyle(
                                color: AppColors.inkSoft, fontSize: 12.5)),
                      ),
                      Expanded(child: Divider(color: AppColors.line)),
                    ]),
                    const SizedBox(height: 14),
                    // Daftar via Google: akun dibuat otomatis saat OAuth
                    // (profil role=customer diisi trigger handle_new_user),
                    // sama seperti tombol di layar Login.
                    const GoogleSignInButton(),
                    const SizedBox(height: 16),
                    // Syarat ringkas
                    const Text.rich(
                      TextSpan(
                        style: TextStyle(
                            fontSize: 11.5,
                            color: AppColors.inkSoft,
                            height: 1.5),
                        children: [
                          TextSpan(text: 'Dengan mendaftar, kamu menyetujui '),
                          TextSpan(
                              text: 'syarat layanan',
                              style: TextStyle(
                                  color: AppColors.brand,
                                  fontWeight: FontWeight.w700)),
                          TextSpan(text: ' dan '),
                          TextSpan(
                              text: 'kebijakan privasi',
                              style: TextStyle(
                                  color: AppColors.brand,
                                  fontWeight: FontWeight.w700)),
                          TextSpan(text: ' Fixify.'),
                        ],
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    // Pintasan pendaftaran teknisi (paritas /gabung di web).
                    TextButton.icon(
                      onPressed: () =>
                          Navigator.pushNamed(context, '/register-technician'),
                      style: TextButton.styleFrom(
                          minimumSize: const Size.fromHeight(44)),
                      icon: const Icon(Icons.handyman_rounded,
                          size: 18, color: AppColors.brand),
                      label: const Text('Ingin jadi teknisi? Daftar di sini',
                          style: TextStyle(fontWeight: FontWeight.w700)),
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
