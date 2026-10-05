import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';

class ResetPasswordScreen extends StatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _email = TextEditingController();
  bool _sent = false;
  bool _loading = false;

  Future<void> _submit() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      showSnack(context, 'Masukkan email yang valid.', error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      await Api.sendPasswordReset(email);
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) showSnack(context, 'Gagal mengirim. Coba lagi nanti.', error: true);
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
            title: 'Lupa kata sandi?',
            subtitle: 'Tenang, kami bantu atur ulang.\nCukup masukkan email akunmu',
            onBack: () => Navigator.pop(context),
            showLogo: _sent, // saat sukses, logo diganti ikon centang besar
          ),
          AuthCard(
            child: _sent
                ? _buildSuccess()
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        onSubmitted: (_) => _submit(),
                        decoration: const InputDecoration(
                            labelText: 'Email',
                            prefixIcon: Icon(Icons.mail_outline)),
                      ),
                      const SizedBox(height: 20),
                      GradientButton(
                        label: 'Kirim Tautan Reset',
                        icon: Icons.send_rounded,
                        loading: _loading,
                        onPressed: _submit,
                      ),
                      const SizedBox(height: 14),
                      const Text(
                        'Tautan berlaku 1 jam. Pastikan email yang kamu '
                        'masukkan sama dengan yang dipakai saat daftar.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 11.5,
                            color: AppColors.inkSoft,
                            height: 1.5),
                      ),
                    ],
                  ),
          ),
          const TrustRow(),
        ]),
      ),
    );
  }

  /// Tampilan setelah tautan terkirim: ikon sukses + instruksi +
  /// tombol kembali ke login dan kirim ulang.
  Widget _buildSuccess() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        width: 84,
        height: 84,
        margin: const EdgeInsets.only(bottom: 18),
        decoration: const BoxDecoration(
            color: AppColors.mintTint, shape: BoxShape.circle),
        child: const Icon(Icons.mark_email_read_rounded,
            size: 44, color: AppColors.mint),
      ),
      const Text('Tautan terkirim!',
          textAlign: TextAlign.center,
          style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.navy)),
      const SizedBox(height: 10),
      Text(
        'Kami mengirim tautan reset ke\n${_email.text.trim()}.\n'
        'Buka tautannya di perangkat ini untuk mengatur kata sandi baru.',
        textAlign: TextAlign.center,
        style: const TextStyle(
            fontSize: 13, color: AppColors.inkSoft, height: 1.6),
      ),
      const SizedBox(height: 22),
      GradientButton(
        label: 'Kembali ke Masuk',
        icon: Icons.arrow_back_rounded,
        onPressed: () => Navigator.pushNamedAndRemoveUntil(
            context, '/login', (r) => false),
      ),
      const SizedBox(height: 10),
      TextButton(
        onPressed: _loading
            ? null
            : () => setState(() => _sent = false),
        child: const Text('Email tidak sampai? Coba email lain',
            style: TextStyle(fontWeight: FontWeight.w700)),
      ),
    ]);
  }
}
