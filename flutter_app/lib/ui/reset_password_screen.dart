import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import '../api.dart';
import '../config.dart';
import '../theme.dart';
import 'auth_widgets.dart';
import 'common.dart';

/// Jeda wajib antar-permintaan tautan reset ke alamat yang sama.
///
/// Selaras dengan jeda per-alamat Supabase untuk permintaan reset (60 detik —
/// `smtp_max_frequency` bawaan juga 60 detik;
/// https://supabase.com/docs/guides/auth/rate-limits): permintaan lebih cepat
/// dari itu ditolak dan hanya menambah hitungan blokir tanpa menambah peluang
/// email sampai. Angka ini juga yang ditampilkan ke pengguna, jadi tepuk-ulang
/// tombol tidak lagi jadi cara mencari tahu (dan menambah blokir di Supabase).
const int kJedaKirimResetDetik = 60;

/// Kalimat yang ditampilkan ketika permintaan reset ditolak karena batas
/// pengiriman email Supabase.
///
/// Terukur di produksi (13 Okt 2026) pada project ini:
///   `POST /auth/v1/recover` → HTTP 429
///   `{"code":429,"error_code":"over_email_send_rate_limit",
///     "msg":"email rate limit exceeded"}`
/// Dokumentasi kode error Supabase menautkan `over_email_send_rate_limit` ke
/// batas per **alamat tujuan**, sedangkan batas **project** (mailer bawaan:
/// 2 pesan/jam, dipakai bersama semua endpoint email Auth —
/// https://supabase.com/docs/guides/auth/auth-smtp) tidak dijelaskan kode mana
/// yang dikembalikan saat kena. Dua sebab itu butuh waktu tunggu berbeda, jadi
/// pesan di bawah sengaja TIDAK menyebut angka jam: ia menuntun (tunggu,
/// coba sekali lagi, periksa spam) alih-alih menjanjikan waktu yang bisa salah.
/// Yang menekan tombol berkali-kali tetap dicegah oleh jeda di layar ini.
/// Perbaikan sebenarnya di sisi server — SMTP kustom + naikkan batas, atau
/// kirim di luar Auth: lihat docs/reset-password-email.md dan
/// `npm run verify:reset-email`.
String pesanBatasKirimEmail() =>
    'Permintaan tautan reset ditolak karena batas pengiriman email di server '
    '(biasanya karena permintaan berulang untuk alamat ini). Tunggu beberapa '
    'menit, lalu coba sekali lagi — dan periksa folder spam untuk email yang '
    'mungkin sudah terkirim.';

/// Apakah kegagalan ini batas pengiriman email (bukan jaringan/kredensial)?
/// Murni — dipakai jalur UI dan diuji langsung tanpa jaringan.
bool gagalKarenaBatasEmail(AuthException e) {
  final kode = (e.code ?? '').toLowerCase();
  final pesan = e.message.toLowerCase();
  return e.statusCode == '429' ||
      kode.contains('rate_limit') ||
      pesan.contains('rate limit');
}

/// Langkah 1 alur lupa kata sandi: minta tautan reset dikirim ke email.
class ResetPasswordScreen extends StatefulWidget {
  const ResetPasswordScreen({super.key, this.sendReset});

  /// Seam uji widget: ganti pengiriman permintaan. `null` (produksi) =
  /// `Api.sendPasswordReset` dengan redirectTo deep link Android.
  final Future<void> Function(String email)? sendReset;

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _email = TextEditingController();
  bool _sent = false;
  bool _loading = false;
  int _jeda = 0;
  Timer? _jedaTimer;

  @override
  void dispose() {
    _jedaTimer?.cancel();
    _email.dispose();
    super.dispose();
  }

  /// Mulai jeda hitung-mundur setelah permintaan diterima Supabase.
  void _mulaiJeda() {
    _jedaTimer?.cancel();
    setState(() => _jeda = kJedaKirimResetDetik);
    _jedaTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() => _jeda -= 1);
      if (_jeda <= 0) t.cancel();
    });
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      showSnack(context, 'Masukkan email yang valid.', error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      final kirim = widget.sendReset;
      if (kirim != null) {
        await kirim(email);
      } else {
        // Android: minta balik ke app lewat deep link fixify://reset-password
        // supaya kode PKCE ditukar menjadi sesi pemulihan dan form kata sandi
        // baru langsung terbuka. Web: biarkan ikut Site URL (halaman Next.js).
        await Api.sendPasswordReset(
          email,
          redirectTo: kIsWeb ? null : AppConfig.resetPasswordRedirect,
        );
      }
      if (mounted) {
        setState(() => _sent = true);
        _mulaiJeda();
      }
    } on AuthException catch (e) {
      if (mounted) {
        // Kegagalan jaringan pun bisa sampai ke sini sebagai AuthException
        // (gotrue membungkusnya) — utamakan terjemahan jaringan bila cocok,
        // lalu pesan server apa adanya. Hanya 429 yang punya kalimat sendiri.
        final pesan = gagalKarenaBatasEmail(e)
            ? pesanBatasKirimEmail()
            : (friendlyNetworkError(e) ?? e.message);
        showSnack(context, pesan, error: true);
      }
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
      // Sengaja tidak berjanji "email sudah terkirim": Supabase selalu
      // menjawab sukses walau alamatnya tidak punya akun (perlindungan
      // enumerasi) — dibuktikan `npm run verify:reset-email`: alamat tak
      // terdaftar → HTTP 200 `{}` tanpa satu email pun dikirim. Kalimat "kalau
      // alamat ini terdaftar" menuntun pengguna memeriksa ejaan alamat dan
      // folder spam alih-alih menunggu email yang tak akan datang.
      Text(
        'Kalau ${_email.text.trim()} terdaftar, tautan reset sudah dikirim ke\n'
        'alamat itu. Buka tautannya di perangkat ini — app akan terbuka\n'
        'otomatis ke layar pengaturan kata sandi baru.\n'
        'Belum masuk juga? Periksa folder spam.',
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
        // Dikunci selama jeda: menekan lebih cepat hanya memicu 429
        // (`over_email_send_rate_limit`) di Supabase tanpa menambah peluang
        // email sampai — lihat [kJedaKirimResetDetik].
        onPressed: (_loading || _jeda > 0)
            ? null
            : () => setState(() => _sent = false),
        child: Text(
          _jeda > 0
              ? 'Coba email lain dalam ${_jeda}s'
              : 'Email tidak sampai? Coba email lain',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
    ]);
  }
}

/// Argumen rute `/set-password` yang berarti "tautan gagal dikenali".
/// Dipakai main.dart saat deep link TIDAK bisa ditukar jadi sesi pemulihan.
const String kArgTautanGagal = 'tautan-gagal';

/// Layar harus menampilkan keadaan "Tautan tidak berlaku"?
///
/// Murni — diuji langsung tanpa Supabase. Ada dua sebab, dan yang pertama
/// dulu pernah luput: tautan yang GAGAL ditukar (kedaluwarsa, sudah dipakai,
/// atau kode PKCE-nya tak ada di perangkat ini) tidak pernah sampai ke layar
/// ini sama sekali, sehingga pengguna hanya melihat layar diam. Sekarang
/// kegagalan itu membawa pengguna ke sini dengan [tautanGagal] = true.
bool tampilkanTautanKedaluwarsa({
  required bool tautanGagal,
  required bool adaSesi,
}) =>
    tautanGagal || !adaSesi;

/// Langkah 2 alur lupa kata sandi (mobile): buat kata sandi baru.
///
/// Dibuka OTOMATIS dari main.dart saat deep link `fixify://reset-password`
/// diterima — supabase_flutter (app_links + detectSessionInUri) sudah menukar
/// kode di tautan email menjadi sesi pemulihan dan memancarkan event
/// `passwordRecovery`. Jadi di sini cukup memanggil updateUser.
class SetNewPasswordScreen extends StatefulWidget {
  const SetNewPasswordScreen({
    super.key,
    this.sessionReady,
    this.savePassword,
    this.tautanGagal = false,
  });

  /// Tautan reset yang diklik GAGAL menjadi sesi pemulihan (kedaluwarsa /
  /// sudah dipakai / kode PKCE-nya hilang). Dipaksa tampil sebagai “Tautan
  /// tidak berlaku” — juga bila pengguna kebetulan masih punya sesi login
  /// biasa, supaya kesalahan tautan tidak menyamar jadi form yang siap diisi.
  final bool tautanGagal;

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
    // Keadaan layar ditentukan sekali di sini supaya judul, subjudul, dan isi
    // kartu tidak mungkin saling bertentangan (dulu judulnya tetap "Kata Sandi
    // Baru" sementara kartunya sudah berkata "Tautan tidak berlaku").
    final kedaluwarsa = tampilkanTautanKedaluwarsa(
      tautanGagal: widget.tautanGagal,
      adaSesi: _hasSession,
    );
    final judul = _done
        ? 'Kata sandi diganti'
        : kedaluwarsa
            ? 'Tautan Kedaluwarsa'
            : 'Kata Sandi Baru';
    final subjudul = _done
        ? 'Masuk kembali memakai kata sandi barumu'
        : kedaluwarsa
            ? 'Minta tautan baru untuk melanjutkan'
            : 'Buat kata sandi baru untuk akunmu';

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SingleChildScrollView(
        child: Column(children: [
          AuthHero(
            title: judul,
            subtitle: subjudul,
            showLogo: !_done,
          ),
          AuthCard(
            child: _done
                ? _buildDone()
                : kedaluwarsa
                    ? _buildExpired()
                    : _buildForm(),
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
