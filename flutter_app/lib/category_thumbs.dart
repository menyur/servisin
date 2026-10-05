import 'package:flutter/material.dart';

/// Pemetaan ikon + palet gradien khas per kategori.
/// Kunci mengikuti nilai kolom `icon` di tabel `categories` (Supabase),
/// sama dengan key kebab-case di src/lib/icons.js sisi web.
class CategoryThumbStyle {
  final IconData icon;
  final List<Color> gradient;
  final Color accent;

  const CategoryThumbStyle({
    required this.icon,
    required this.gradient,
    required this.accent,
  });
}

const _brandStyle = CategoryThumbStyle(
  icon: Icons.build_rounded,
  gradient: [Color(0xFF135F94), Color(0xFF1C86C7)],
  accent: Color(0xFF1C86C7),
);

const Map<String, CategoryThumbStyle> categoryStyles = {
  'snowflake': CategoryThumbStyle(
    icon: Icons.ac_unit_rounded,
    gradient: [Color(0xFF0E7FB8), Color(0xFF6FC3E8)],
    accent: Color(0xFF0E7FB8),
  ),
  'hammer': CategoryThumbStyle(
    icon: Icons.handyman_rounded,
    gradient: [Color(0xFFB45309), Color(0xFFF59E0B)],
    accent: Color(0xFFF59E0B),
  ),
  'car': CategoryThumbStyle(
    icon: Icons.directions_car_rounded,
    gradient: [Color(0xFF15803D), Color(0xFF4ADE80)],
    accent: Color(0xFF15803D),
  ),
  'brush': CategoryThumbStyle(
    icon: Icons.local_laundry_service_rounded,
    gradient: [Color(0xFF6D28D9), Color(0xFFA78BFA)],
    accent: Color(0xFF6D28D9),
  ),
  'zap': CategoryThumbStyle(
    icon: Icons.bolt_rounded,
    gradient: [Color(0xFFB45309), Color(0xFFFB923C)],
    accent: Color(0xFFB45309),
  ),
  'shower-head': CategoryThumbStyle(
    icon: Icons.water_drop_rounded,
    gradient: [Color(0xFF0369A1), Color(0xFF38BDF8)],
    accent: Color(0xFF0369A1),
  ),
  'paint-roller': CategoryThumbStyle(
    icon: Icons.format_paint_rounded,
    gradient: [Color(0xFFBE185D), Color(0xFFF472B6)],
    accent: Color(0xFFBE185D),
  ),
  'building-2': CategoryThumbStyle(
    icon: Icons.apartment_rounded,
    gradient: [Color(0xFF334155), Color(0xFF94A3B8)],
    accent: Color(0xFF334155),
  ),
  'hard-hat': CategoryThumbStyle(
    icon: Icons.engineering_rounded,
    gradient: [Color(0xFFA16207), Color(0xFFFACC15)],
    accent: Color(0xFFA16207),
  ),
  'settings-2': CategoryThumbStyle(
    icon: Icons.settings_rounded,
    gradient: [Color(0xFF155E75), Color(0xFF22D3EE)],
    accent: Color(0xFF155E75),
  ),
  'sparkles': CategoryThumbStyle(
    icon: Icons.auto_awesome_rounded,
    gradient: [Color(0xFF7C3AED), Color(0xFFC4B5FD)],
    accent: Color(0xFF7C3AED),
  ),
  'droplet': CategoryThumbStyle(
    icon: Icons.water_drop_rounded,
    gradient: [Color(0xFF0369A1), Color(0xFF7DD3FC)],
    accent: Color(0xFF0369A1),
  ),
  'package-open': CategoryThumbStyle(
    icon: Icons.inventory_2_rounded,
    gradient: [Color(0xFF9A3412), Color(0xFFFB923C)],
    accent: Color(0xFF9A3412),
  ),
  'disc': CategoryThumbStyle(
    icon: Icons.album_rounded,
    gradient: [Color(0xFF0F766E), Color(0xFF2DD4BF)],
    accent: Color(0xFF0F766E),
  ),
  'life-buoy': CategoryThumbStyle(
    icon: Icons.support_rounded,
    gradient: [Color(0xFFBE123C), Color(0xFFFB7185)],
    accent: Color(0xFFBE123C),
  ),
  'spray-can': CategoryThumbStyle(
    icon: Icons.cleaning_services_rounded,
    gradient: [Color(0xFF0E7490), Color(0xFF67E8F9)],
    accent: Color(0xFF0E7490),
  ),
  'help-circle': CategoryThumbStyle(
    icon: Icons.help_outline_rounded,
    gradient: [Color(0xFF4338CA), Color(0xFF818CF8)],
    accent: Color(0xFF4338CA),
  ),
  'home': CategoryThumbStyle(
    icon: Icons.home_rounded,
    gradient: [Color(0xFF047857), Color(0xFF34D399)],
    accent: Color(0xFF047857),
  ),
  'armchair': CategoryThumbStyle(
    icon: Icons.weekend_rounded,
    gradient: [Color(0xFF9F1239), Color(0xFFFB7185)],
    accent: Color(0xFF9F1239),
  ),
  'shirt': CategoryThumbStyle(
    icon: Icons.checkroom_rounded,
    gradient: [Color(0xFF7E22CE), Color(0xFFD8B4FE)],
    accent: Color(0xFF7E22CE),
  ),
  'wrench': _brandStyle,
};

CategoryThumbStyle styleForIcon(String? key) {
  final s = categoryStyles[key];
  if (s != null) return s;
  // Fallback deterministik: hash nama kategori → palet dari kumpulan ini,
  // jadi kategori baru tanpa style khusus tetap berwarna (bukan abu-abu).
  final pool = [
    categoryStyles['snowflake']!,
    categoryStyles['hammer']!,
    categoryStyles['car']!,
    categoryStyles['brush']!,
    categoryStyles['sparkles']!,
    categoryStyles['settings-2']!,
  ];
  var h = 0;
  for (final c in (key ?? 'wrench').codeUnits) {
    h = (h * 31 + c) & 0x7fffffff;
  }
  return pool[h % pool.length];
}

/// Ikon Material yang mewakili key ikon layanan (kolom services.icon).
/// Dipakai thumbnail kartu yang tidak punya foto.
IconData iconForServiceKey(String? key) => styleForIcon(key).icon;

/// Kotak thumbnail layanan bergradien warna kategori — dipakai kartu
/// layanan (beranda) dan header wizard, jadi tampilan konsisten dua-duanya.
/// [iconKey] dari kolom `icon` layanan; [size] sisi kotak.
class ServiceThumbBox extends StatelessWidget {
  final String? iconKey;
  final double size;
  final double radius;

  const ServiceThumbBox({
    super.key,
    required this.iconKey,
    this.size = 58,
    this.radius = 12,
  });

  @override
  Widget build(BuildContext context) {
    final s = styleForIcon(iconKey);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: s.gradient,
        ),
        boxShadow: [
          BoxShadow(
            color: s.accent.withValues(alpha: 0.3),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Icon(
        s.icon,
        color: Colors.white,
        size: size * 0.5,
      ),
    );
  }
}

/// Thumbnail bulat bergradien dengan ikon putih di tengah — dipakai chip
/// kategori Beranda. [selected] memperbesar + menambah ring & bayangan.
class CategoryThumb extends StatelessWidget {
  final String iconKey;
  final double size;
  final bool selected;

  const CategoryThumb({
    super.key,
    required this.iconKey,
    this.size = 52,
    this.selected = false,
  });

  @override
  Widget build(BuildContext context) {
    final s = styleForIcon(iconKey);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: s.gradient,
        ),
        border: Border.all(
          color: selected ? Colors.white : Colors.transparent,
          width: 2.5,
        ),
        boxShadow: [
          BoxShadow(
            color: s.accent.withValues(alpha: selected ? 0.45 : 0.28),
            blurRadius: selected ? 14 : 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Icon(
        s.icon,
        color: Colors.white,
        size: size * 0.48,
      ),
    );
  }
}
