import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import '../api.dart';
import '../config.dart';
import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';

/// Langkah 1 alur lupa kata sandi: minta tautan reset dikirim ke email.
class ResetPasswordScreen extends StatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _email = TextEditingController();
  bool _sent = false;
  bool _loading = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      showSnack(context, 'Masukkan email yang valid.', error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      // Android: minta balik ke app lewat deep link fixify://reset-password
      // supaya kode PKCE ditukar menjadi sesi pemulihan dan form kata sandi
      // baru langsung terbuka. Web: biarkan ikut Site URL (halaman Next.js).
      await Api.sendPasswordReset(
        email,
        redirectTo: kIsWeb ? null : AppConfig.resetPasswordRedirect,
      );
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mengirim. Coba lagi nanti.');
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
        'Buka tautannya di perangkat ini — app akan terbuka otomatis\n'
        'ke layar pengaturan kata sandi baru.',
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

/// Langkah 2 alur lupa kata sandi (mobile): buat kata sandi baru.
///
/// Dibuka OTOMATIS dari main.dart saat deep link `fixify://reset-password`
/// diterima — supabase_flutter (app_links + detectSessionInUri) sudah menukar
/// kode di tautan email menjadi sesi pemulihan dan memancarkan event
/// `passwordRecovery`. Jadi di sini cukup memanggil updateUser.
class SetNewPasswordScreen extends StatefulWidget {
  const SetNewPasswordScreen({super.key, this.sessionReady, this.savePassword});

  /// Seam uji widget: paksa status sesi pemulihan. `null` (produksi) =
  /// periksa `Api.session` sungguhan.
  final bool? sessionReady;

  /// Seam uji widget: ganti penulisan kata sandi. `null` (produksi) =
  /// `Api.updatePassword` lalu `Api.signOut`.
  final Future<void> Function(String password)? savePassword;

  @override
  State<SetNewPasswordScreen> createState() => _SetNewPasswordScreenState();
}

class _SetNewPasswordScreenState extends State<SetNewPasswordScreen> {
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _loading = false;
  bool _obscure = true;
  bool _done = false;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  /// Sesi pemulihan harus ada — kalau tidak, tautan kedaluwarsa/sudah dipakai.
  bool get _hasSession => widget.sessionReady ?? Api.session != null;

  Future<void> _submit() async {
    final pass = _password.text;
    if (pass.length < 6) {
      showSnack(context, 'Kata sandi minimal 6 karakter.', error: true);
      return;
    }
    if (pass != _confirm.text) {
      showSnack(context, 'Ulangi kata sandi tidak sama.', error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      final save = widget.savePassword;
      if (save != null) {
        await save(pass);
      } else {
        await Api.updatePassword(pass);
        // Sesi pemulihan selesai → keluar agar pengguna masuk ulang dengan
        // kata sandi baru (jangan tinggalkan sesi sementara ini aktif).
        await Api.signOut();
      }
      if (mounted) setState(() => _done = true);
    } on AuthException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } catch (e) {
      if (mounted) {
        showSnackError(context, e, 'Gagal menyimpan kata sandi. Coba lagi.');
      }
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
            title: _done ? 'Kata sandi diganti' : 'Kata Sandi Baru',
            subtitle: _done
                ? 'Masuk kembali memakai kata sandi barumu'
                : 'Buat kata sandi baru untuk akunmu',
            showLogo: !_done,
          ),
          AuthCard(
            child: _done
                ? _buildDone()
                : _hasSession
                    ? _buildForm()
                    : _buildExpired(),
          ),
          const TrustRow(),
        ]),
      ),
    );
  }

  Widget _buildForm() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        controller: _password,
        obscureText: _obscure,
        decoration: InputDecoration(
          labelText: 'Kata sandi baru',
          prefixIcon: const Icon(Icons.lock_outline),
          suffixIcon: IconButton(
            icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _confirm,
        obscureText: _obscure,
        onSubmitted: (_) => _submit(),
        decoration: const InputDecoration(
            labelText: 'Ulangi kata sandi baru',
            prefixIcon: Icon(Icons.lock_reset_rounded)),
      ),
      const SizedBox(height: 20),
      GradientButton(
        label: 'Simpan Kata Sandi Baru',
        icon: Icons.save_rounded,
        loading: _loading,
        onPressed: _submit,
      ),
      const SizedBox(height: 14),
      const Text(
        'Minimal 6 karakter. Setelah tersimpan, kamu masuk kembali '
        'dengan kata sandi baru.',
        textAlign: TextAlign.center,
        style: TextStyle(
            fontSize: 11.5, color: AppColors.inkSoft, height: 1.5),
      ),
    ]);
  }

  /// Tautan tidak membawa sesi pemulihan (kedaluwarsa / sudah dipakai) —
  /// tawarkan minta tautan baru daripada form yang pasti gagal.
  Widget _buildExpired() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        width: 84,
        height: 84,
        margin: const EdgeInsets.only(bottom: 18),
        decoration: const BoxDecoration(
            color: AppColors.coralTint, shape: BoxShape.circle),
        child: const Icon(Icons.link_off_rounded,
            size: 42, color: AppColors.coral),
      ),
      const Text('Tautan tidak berlaku',
          textAlign: TextAlign.center,
          style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.navy)),
      const SizedBox(height: 10),
      const Text(
        'Tautan reset ini sudah kedaluwarsa atau pernah dipakai.\n'
        'Minta tautan baru untuk melanjutkan.',
        textAlign: TextAlign.center,
        style: TextStyle(
            fontSize: 13, color: AppColors.inkSoft, height: 1.6),
      ),
      const SizedBox(height: 22),
      GradientButton(
        label: 'Minta Tautan Baru',
        icon: Icons.send_rounded,
        onPressed: () => Navigator.pushNamedAndRemoveUntil(
            context, '/reset-password', (r) => false),
      ),
      const SizedBox(height: 10),
      TextButton(
        onPressed: () => Navigator.pushNamedAndRemoveUntil(
            context, '/login', (r) => false),
        child: const Text('Kembali ke Masuk',
            style: TextStyle(fontWeight: FontWeight.w700)),
      ),
    ]);
  }

  Widget _buildDone() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        width: 84,
        height: 84,
        margin: const EdgeInsets.only(bottom: 18),
        decoration: const BoxDecoration(
            color: AppColors.mintTint, shape: BoxShape.circle),
        child: const Icon(Icons.shield_rounded,
            size: 44, color: AppColors.mint),
      ),
      const Text('Kata sandi berhasil diganti',
          textAlign: TextAlign.center,
          style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.navy)),
      const SizedBox(height: 10),
      const Text(
        'Sekarang kamu bisa masuk dengan kata sandi barumu.',
        textAlign: TextAlign.center,
        style: TextStyle(
            fontSize: 13, color: AppColors.inkSoft, height: 1.6),
      ),
      const SizedBox(height: 22),
      GradientButton(
        label: 'Masuk Sekarang',
        icon: Icons.login_rounded,
        onPressed: () => Navigator.pushNamedAndRemoveUntil(
            context, '/login', (r) => false),
      ),
    ]);
  }
}
