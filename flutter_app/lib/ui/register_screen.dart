import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import '../api.dart';
import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

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
      final res = await Api.signUp(
        _email.text.trim(),
        _password.text,
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        address: _address.text.trim(),
      );
      if (!mounted) return;
      if (res.session == null) {
        // Proyek web menonaktifkan "Confirm email", tapi kalau aktif:
        showSnack(context, 'Akun dibuat! Cek email untuk verifikasi lalu masuk.');
        Navigator.pushReplacementNamed(context, '/login');
      } else {
        Navigator.pushNamedAndRemoveUntil(context, '/', (r) => false);
      }
    } on AuthException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
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
                  ]),
            ),
          ),
          const TrustRow(),
        ]),
      ),
    );
  }
}
