// Di web: salurkan detail error ke localStorage agar bisa dibaca dari
// luar (alat uji preview). File ini hanya dikompilasi saat dart:html
// tersedia (dipilih otomatis oleh web_error_probe.dart).
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:html' as html;

void reportWebError(int count, String label, String msg) {
  html.document.title = (label.contains('FE') ? 'ERR-CAPTURED' : 'X');
  html.window.localStorage['fbuild'] = 'fix2-minsize';
  html.window.localStorage['ferr$count'] = msg.length > 4000 ? msg.substring(0, 4000) : msg;
}
