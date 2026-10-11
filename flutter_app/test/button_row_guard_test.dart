import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// AUDIT OTOMATIS seluruh `lib/` untuk jebakan lebar tak hingga pada tombol.
///
/// Latar: tema global memasang `minimumSize: Size.fromHeight(48)` (lebar
/// `double.infinity`) pada [FilledButton] & [OutlinedButton] supaya tombol
/// selebar wadahnya. Lebar tak hingga itu berbahaya di dua konteks:
///
/// 1. **MATI (crash).** Di anak non-flex sebuah `Row(...)` — atau di
///    `Column`/`Align`/`Wrap` yang berada di dalam `Row` tanpa pembatas lebar —
///    tombol meledak: `BoxConstraints forces an infinite width`, dan seluruh
///    baris/kartu ikut rusak. Terverifikasi di `button_theme_trap_test.dart`.
/// 2. **RUSAK TANPA CRASH (visual).** Di dalam `Wrap` berlebar terbatas, lebar
///    tak hingga itu tidak meledak tapi tombol menyerobot SELEBAR BARIS
///    sehingga tombol di sebelahnya terlempar ke baris berikutnya.
///
/// Pemindai ini menelusuri kode sumber (bukan hasil render) supaya SELURUH
/// aplikasi tersapu terus-menerus, bukan hanya layar yang kebetulan punya
/// widget test. Bukti bahwa pemeriksa ini memang bekerja (mutation test):
/// menghapus `style: AppTheme.compactOutlinedButton` pada tombol "Rute" kartu
/// Tersedia langsung memunculkan temuan di `lib/ui/jobs_screen.dart`.
void main() {
  /// Konstruktor tombol yang mewarisi lebar minimum TAK HINGGA dari tema.
  /// `TextButton` sengaja TIDAK ada di sini: tema ini tidak menimpa
  /// `textButtonTheme`, jadi lebarnya selalu terbatas dan aman di `Row`.
  const dangerous = <String>{
    'FilledButton',
    'OutlinedButton',
    // Wrapper lokal: keduanya menetapkan `minimumSize: Size.fromHeight(...)`.
    'GradientButton',
    'GoogleSignInButton',
  };

  /// Widget yang membatasi lebar anaknya walau berada di dalam `Row` tak
  /// terbatas — cukup untuk menetralkan jebakan (1).
  const widthBounders = <String>{
    'Expanded',
    'Flexible',
    'SizedBox',
    'ConstrainedBox',
    'IntrinsicWidth',
    'ListView',
    'GridView',
    'SingleChildScrollView',
    'CustomScrollView',
    'Scaffold',
    'Dialog',
    'AlertDialog',
    'Drawer',
    'PopupMenuButton',
    'MenuAnchor',
    'Table',
  };

  /// Widget yang memberi anak non-flex kendala lebar TAK TERBATAS → jebakan (1).
  const crashHosts = <String>{'Row', 'OverflowBar', 'ButtonBar', 'AppBar'};

  /// Jebakan (2): penyerobot lebar baris.
  const wrapHost = 'Wrap';

  String base(String callee) => callee.split('.').first;

  /// Apakah pemanggilan ini MEMBUAT tombol (widget), bukan sekadar pabrik
  /// gaya. `FilledButton.styleFrom(...)` hanya menghasilkan [ButtonStyle],
  /// bukan widget — tak pernah menyusun lebar, jadi jangan pernah ditandai.
  bool isButtonCall(String callee) =>
      dangerous.contains(base(callee)) && !callee.endsWith('.styleFrom');

  String stripNonCode(String src) {
    final out = StringBuffer();
    var i = 0;
    final n = src.length;
    while (i < n) {
      final c = src[i];
      if (c == '/' && i + 1 < n && src[i + 1] == '/') {
        while (i < n && src[i] != '\n') {
          out.write(' ');
          i++;
        }
        continue;
      }
      if (c == '/' && i + 1 < n && src[i + 1] == '*') {
        out.write('  ');
        i += 2;
        while (i < n && !(src[i] == '*' && i + 1 < n && src[i + 1] == '/')) {
          out.write(src[i] == '\n' ? '\n' : ' ');
          i++;
        }
        if (i < n) {
          out.write('  ');
          i += 2;
        }
        continue;
      }
      if (c == "'" || c == '"') {
        final triple = i + 2 < n && src[i + 1] == c && src[i + 2] == c;
        final len = triple ? 3 : 1;
        for (var k = 0; k < len; k++) {
          out.write(' ');
        }
        i += len;
        while (i < n) {
          if (!triple && src[i] == '\\') {
            out.write('  ');
            i += 2;
            continue;
          }
          if (triple &&
              src[i] == c &&
              i + 2 < n &&
              src[i + 1] == c &&
              src[i + 2] == c) {
            out.write('   ');
            i += 3;
            break;
          }
          if (!triple && src[i] == c) {
            out.write(' ');
            i++;
            break;
          }
          out.write(src[i] == '\n' ? '\n' : ' ');
          i++;
        }
        continue;
      }
      out.write(c);
      i++;
    }
    return out.toString();
  }

  bool isIdentChar(String c) {
    final u = c.codeUnitAt(0);
    return (u >= 0x30 && u <= 0x39) ||
        (u >= 0x41 && u <= 0x5A) ||
        (u >= 0x61 && u <= 0x7A) ||
        c == '_' ||
        c == r'$';
  }

  /// Nama yang dipanggil tepat sebelum tanda `(` di indeks [open].
  String calleeName(String code, int open) {
    var i = open - 1;
    while (i >= 0 && (code[i] == ' ' || code[i] == '\n' || code[i] == '\r')) {
      i--;
    }
    if (i >= 0 && code[i] == '>') {
      var depth = 0;
      while (i >= 0) {
        if (code[i] == '>') depth++;
        if (code[i] == '<') {
          depth--;
          if (depth == 0) {
            i--;
            break;
          }
        }
        i--;
      }
      while (i >= 0 && (code[i] == ' ' || code[i] == '\n')) {
        i--;
      }
    }
    while (i >= 0 && (isIdentChar(code[i]) || code[i] == '.')) {
      i--;
    }
    return code.substring(i + 1, open).trim();
  }

  test('lib/ bersih dari tombol berlebar tak hingga di konteks berbahaya', () {
    const bounderWithWidth = {'SizedBox', 'ConstrainedBox'};

    /// Argumen sebuah widget apakah benar-benar mengunci lebar.
    bool argsPinWidth(String args) =>
        args.contains('width:') || args.contains('maxWidth');

    final findings = <String>[];
    var examined = 0;
    var files = 0;

    final dartFiles = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .toList()
      ..sort((a, b) => a.path.compareTo(b.path));

    for (final file in dartFiles) {
      files++;
      final code = stripNonCode(file.readAsStringSync());
      final matchClose = List<int>.filled(code.length, -1);
      final parens = <int>[];
      for (var i = 0; i < code.length; i++) {
        if (code[i] == '(') {
          parens.add(i);
        } else if (code[i] == ')' && parens.isNotEmpty) {
          matchClose[parens.removeLast()] = i;
        }
      }

      final frames = <(String name, int open, int close)>[];
      int lineOf(int index) =>
          '\n'.allMatches(code.substring(0, index)).length + 1;

      for (var i = 0; i < code.length; i++) {
        if (code[i] == '(' && matchClose[i] != -1) {
          final name = calleeName(code, i);
          final close = matchClose[i];
          final leaf = base(name);
          if (isButtonCall(name)) {
            examined++;
            final args = code.substring(i, close + 1);
            // Gaya sendiri sudah mengunci lebar → aman di konteks apa pun.
            final selfGuarded = args.contains('AppTheme.compact') ||
                RegExp(r'minimumSize:\s*(const\s+)?Size\(\s*\d').hasMatch(args);

            if (!selfGuarded) {
              // Aturan 1 — kejebakan yang MEMATIKAN layout.
              String? crashHost;
              for (var k = frames.length - 1; k >= 0; k--) {
                final ancestorBase = base(frames[k].$1);
                if (widthBounders.contains(ancestorBase)) {
                  final bounderArgs =
                      code.substring(frames[k].$2, frames[k].$3 + 1);
                  if (bounderWithWidth.contains(ancestorBase) &&
                      !argsPinWidth(bounderArgs)) {
                    continue; // SizedBox tanpa width / ConstrainedBox tanpa maxWidth
                  }
                  break; // dibatasi → aman
                }
                if (crashHosts.contains(ancestorBase)) {
                  crashHost = frames[k].$1;
                  break;
                }
              }
              if (crashHost != null) {
                findings.add('${file.path}:${lineOf(i)} — $leaf di dalam '
                    '$crashHost tanpa pembatas lebar (LAYOUT MATI)');
              } else {
                // Aturan 2 — kejebakan visual: tombol menyerobot lebar baris.
                for (var k = frames.length - 1; k >= 0; k--) {
                  final ancestorBase = base(frames[k].$1);
                  if (ancestorBase == 'IntrinsicWidth' ||
                      ancestorBase == 'Table') {
                    break;
                  }
                  if (bounderWithWidth.contains(ancestorBase)) {
                    final bounderArgs =
                        code.substring(frames[k].$2, frames[k].$3 + 1);
                    if (argsPinWidth(bounderArgs)) break;
                    continue;
                  }
                  if (ancestorBase == wrapHost) {
                    findings.add('${file.path}:${lineOf(i)} — $leaf di dalam '
                        '$wrapHost akan selebar baris (layout rusak halus)');
                    break;
                  }
                }
              }
            }
          }
          frames.add((name, i, close));
        } else if (code[i] == ')' &&
            frames.isNotEmpty &&
            frames.last.$3 == i) {
          frames.removeLast();
        }
      }
    }

    // Penjaga diri: kalau pemindai rusak (mis. berhenti mengenali konstruktor),
    // ia akan "lulus" palsu — pastikan ia benar-benar memeriksa banyak tombol.
    expect(files, greaterThan(20), reason: 'pemindai harus menyapu lib/');
    expect(examined, greaterThan(30),
        reason: 'pemindai harus mengenali puluhan tombol berbahaya');

    expect(
      findings,
      isEmpty,
      reason: 'Tombol tema (lebar minimum tak hingga) di konteks lebar tak '
          'terbatas merusak layout. Pakai AppTheme.compactOutlinedButton, '
          'minimumSize berlebar terbatas, atau bungkus Expanded/Flexible:\n'
          '${findings.join('\n')}',
    );
  });
}
