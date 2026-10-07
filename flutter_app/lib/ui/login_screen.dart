import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import '../api.dart';
import '../push_service.dart';
import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';
import 'google_signin_button.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  bool _obscure = true;

  Future<void> _submit() async {
    final email = _email.text.trim();
    final pass = _password.text;
    if (email.isEmpty || pass.isEmpty) {
      showSnack(context, 'Isi email dan kata sandi.', error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      await Api.signIn(email, pass);
      // Ikat token FCM perangkat ini ke user baru (push tugas baru/status).
      await PushService.onLoggedIn();
      if (!mounted) return;
      Navigator.pushNamedAndRemoveUntil(context, '/', (r) => false);
    } on AuthException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } catch (_) {
      if (mounted) showSnack(context, 'Gagal masuk. Periksa koneksi internet.', error: true);
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
          const AuthHero(
            title: 'Selamat datang kembali',
            subtitle: 'Masuk untuk memesan layanan dan\nmemantau pesananmu',
          ),
          AuthCard(
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                  labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _password,
              obscureText: _obscure,
              onSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                labelText: 'Kata sandi',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => Navigator.pushNamed(context, '/reset-password'),
                style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 4)),
                child: const Text('Lupa kata sandi?',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
            const SizedBox(height: 10),
            GradientButton(
              label: 'Masuk',
              icon: Icons.login_rounded,
              loading: _loading,
              onPressed: _submit,
            ),            const SizedBox(height: 20),
            const Row(children: [
              Expanded(child: Divider(color: AppColors.line)),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 12),
                child: Text('atau masuk dengan',
                    style: TextStyle(color: AppColors.inkSoft, fontSize: 12.5)),
              ),
              Expanded(child: Divider(color: AppColors.line)),
            ]),
            const SizedBox(height: 18),
            const GoogleSignInButton(),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: () => Navigator.pushNamed(context, '/register'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: AppColors.line, width: 1.5),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              icon: const Icon(Icons.person_add_alt_1_rounded, size: 19),
              label: const Text('Buat akun baru',
                  style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 8),
            // Pintasan pendaftaran teknisi (paritas /gabung di web).
            TextButton.icon(
              onPressed: () => Navigator.pushNamed(context, '/register-technician'),
              style: TextButton.styleFrom(minimumSize: const Size.fromHeight(44)),
              icon: const Icon(Icons.handyman_rounded, size: 18, color: AppColors.brand),
              label: const Text('Ingin jadi teknisi? Daftar di sini',
                  style: TextStyle(fontWeight: FontWeight.w700)),
            ),
                ]),
          ),
          const TrustRow(),
        ]),
      ),
    );
  }
}
