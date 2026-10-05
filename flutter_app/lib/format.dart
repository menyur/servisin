import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

bool _initialized = false;

/// Pastikan data locale id_ID termuat sebelum memakai NumberFormat /
/// DateFormat. Tanpa ini, exception "Locale data has not been initialized"
/// meledak saat pemilih tanggal dipakai (deep link / cold start).
Future<void> ensureLocaleData() async {
  if (_initialized) return;
  await initializeDateFormatting('id_ID', null);
  try {
    Intl.defaultLocale = 'id_ID';
  } catch (_) {}
  _initialized = true;
}

final _rupiah = NumberFormat.currency(locale: 'id_ID', symbol: 'Rp ', decimalDigits: 0);
final _dateId = DateFormat('EEEE, d MMM yyyy', 'id_ID');
final _shortId = DateFormat('d MMM yyyy', 'id_ID');

String formatRupiah(num n) {
  if (!_initialized) {
    // Fallback sinkron (locale belum termuat): format manual sederhana.
    return 'Rp ${n.round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]}.')}';
  }
  return _rupiah.format(n);
}

String formatDateId(String isoDate) {
  final d = DateTime.tryParse(isoDate);
  if (d == null) return isoDate;
  if (!_initialized) return _fallbackDate(d);
  return _dateId.format(d);
}

String formatDateShort(String isoDate) {
  final d = DateTime.tryParse(isoDate);
  if (d == null) return isoDate;
  if (!_initialized) return _fallbackDate(d);
  return _shortId.format(d);
}

String _fallbackDate(DateTime d) =>
    '${d.day} ${_bulan[d.month - 1]} ${d.year}';

const _bulan = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];
