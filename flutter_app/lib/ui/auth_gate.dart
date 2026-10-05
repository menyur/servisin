import 'package:flutter/material.dart';

import '../api.dart';
import 'home_screen.dart';
import 'login_screen.dart';

/// Dipakai sebagai layar pembuka: langsung ke Beranda bila sesi masih
/// hidup, selain itu ke Login.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) => Api.isLoggedIn ? const HomeScreen() : const LoginScreen();
}
