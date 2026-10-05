import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../category_thumbs.dart';
import '../models.dart';
import '../theme.dart';
import 'booking_wizard.dart';
import 'common.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Category>? _categories;
  List<Service>? _services;
  List<PromoBanner>? _banners;
  String? _error;
  String _query = '';
  String? _activeCategory;
  Profile? _profile;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _categories = null;
      _services = null;
      _banners = null;
    });
    try {
      final cats = await Api.fetchCategories();
      final svcs = await Api.fetchServices();
      final prof = await Api.myProfile();
      // Banner gagal dimuat tidak boleh menggagalkan beranda — fallback statis.
      final banners = await Api.fetchBanners().catchError((_) => <PromoBanner>[]);
      if (!mounted) return;
      setState(() {
        _categories = cats;
        _services = svcs;
        _profile = prof;
        _banners = banners;
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'Gagal memuat katalog. Periksa koneksi internet.');
    }
  }

  List<Service> get _filtered {
    final all = _services ?? const <Service>[];
    var list = all;
    if (_activeCategory != null) list = list.where((s) => s.categoryId == _activeCategory).toList();
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      list = list
          .where((s) =>
              s.name.toLowerCase().contains(q) ||
              (s.description ?? '').toLowerCase().contains(q))
          .toList();
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final firstName = (_profile?.name.isNotEmpty ?? false)
        ? _profile!.name.split(' ').first
        : 'Kawan';

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: _error != null
          ? SafeArea(
              child: Column(children: [
                ScreenHeader(
                  title: 'Halo, $firstName 👋',
                  subtitle: 'Teknisi terpercaya datang ke lokasimu',
                  actions: [_AvatarButton(onTap: () => mainTabIndex.value = 4)],
                ),
                Expanded(
                  child: ScreenStateView(loading: false, error: _error, onRetry: _load),
                ),
              ]),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  // ===== Header gradien: sapaan + pencarian di dalamnya =====
                  ScreenHeader(
                    title: 'Halo, $firstName 👋',
                    subtitle: 'Butuh bantuan apa hari ini?',
                    actions: [_AvatarButton(onTap: () => mainTabIndex.value = 4)],
                    bottom: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: TextField(
                        onChanged: (v) => setState(() => _query = v),
                        style: const TextStyle(color: AppColors.navy, fontSize: 14),
                        decoration: InputDecoration(
                          hintText: 'Cari layanan, misal: cuci AC, ganti oli...',
                          hintStyle: const TextStyle(color: AppColors.inkSoft, fontSize: 13.5),
                          prefixIcon: const Icon(Icons.search, size: 22),
                          suffixIcon: _query.isEmpty
                              ? null
                              : IconButton(
                                  icon: const Icon(Icons.close, size: 20),
                                  onPressed: () => setState(() => _query = '')),
                          filled: true,
                          fillColor: Colors.white,
                          contentPadding: const EdgeInsets.symmetric(vertical: 6),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                    ),
                  ),

                  // ===== Slide statis bawaan (info kecepatan/kepercayaan) =====
                  Transform.translate(
                    offset: const Offset(0, -18),
                    child: const _StaticCarousel(),
                  ),

                  // ===== Chip kategori (pintu masuk utama layanan) =====
                  if (_categories == null)
                    const ScreenStateView(loading: true, empty: false)
                  else
                    SizedBox(
                      height: 118,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 20, 16, 6),
                        scrollDirection: Axis.horizontal,
                        itemCount: _categories!.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 14),
                        itemBuilder: (context, i) => StaggerIn(
                          index: i,
                          child: _CategoryChip(
                            category: _categories![i],
                            active: _activeCategory == _categories![i].id,
                            onTap: () => setState(() =>
                                _activeCategory = _activeCategory == _categories![i].id ? null : _categories![i].id),
                          ),
                        ),
                      ),
                    ),
                  const SizedBox(height: 4),

                  // ===== Banner unggahan admin (karosel auto-putar) =====
                  _PromoCarousel(banners: _banners),
                  const SizedBox(height: 6),

                  // ===== Informasi singkat =====
                  const _InfoStrip(),
                  const SizedBox(height: 6),

                  // ===== Daftar layanan: hanya saat kategori dipilih / mencari =====
                  if (_services == null)
                    const ScreenStateView(loading: true, empty: false)
                  else if (_activeCategory != null || _query.isNotEmpty)
                    ..._buildServiceSections(),
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  List<Widget> _buildServiceSections() {
    final widgets = <Widget>[];
    final cats = _categories ?? const <Category>[];
    for (final c in cats) {
      if (_activeCategory != null && c.id != _activeCategory) continue;
      final services = _filtered.where((s) => s.categoryId == c.id).toList();
      if (services.isEmpty) continue;
      widgets.add(Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Row(children: [
          // Mini-thumbnail kategori sebagai identitas section.
          CategoryThumb(iconKey: c.icon, size: 30),
          const SizedBox(width: 9),
          Expanded(
            child: Text(c.name,
                style: const TextStyle(
                    fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.navy)),
          ),
        ]),
      ));
      widgets.addAll(services.asMap().entries.map((e) => StaggerIn(
            index: e.key,
            child: _ServiceCard(
              service: e.value,
              onBook: () => Navigator.pushNamed(context, '/booking', arguments: BookingArgs(service: e.value)),
            ),
          )));
    }
    if (widgets.isEmpty) {
      widgets.add(const ScreenStateView(loading: false, empty: true, emptyMessage: 'Tidak ada layanan yang cocok'));
    }
    return widgets;
  }
}

// ====== Komponen kecil beranda ======

class _AvatarButton extends StatelessWidget {
  final VoidCallback onTap;
  const _AvatarButton({required this.onTap});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 12),
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.22),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.6), width: 1.5),
            ),
            child: const Icon(Icons.person_rounded, color: Colors.white, size: 22),
          ),
        ),
      );
}

/// Slide statis bawaan — dipakai saat admin belum mengunggah banner apa pun.
class _StaticSlide {
  final List<Color> gradient;
  final IconData icon;
  final String title;
  final String desc;
  final int tab;
  const _StaticSlide(this.gradient, this.icon, this.title, this.desc, this.tab);
}

const _staticSlides = [
  _StaticSlide(
      [Color(0xFFFF7001), Color(0xFFFFB25E)],
      Icons.local_activity_rounded,
      'Selesaikan pesanan, dapat voucher!',
      'Setiap pesanan selesai = voucher diskon untuk pesanan berikutnya.',
      3),
  _StaticSlide(
      [Color(0xFF135F94), Color(0xFF1C86C7)],
      Icons.bolt_rounded,
      'Teknisi datang di hari yang sama',
      'Pilih jam kedatangan 08:00–17:00, teknisi siap ke lokasimu.',
      -1),
  _StaticSlide(
      [Color(0xFF047857), Color(0xFF34D399)],
      Icons.verified_rounded,
      'Teknisi terverifikasi & dinilai pelanggan',
      'Harga transparan di awal — tanpa biaya tersembunyi.',
      -1),
];

/// Karosel banner unggahan ADMIN — auto-putar tiap 4 detik, tap buka tab tujuan.
/// Tampil hanya bila admin punya banner aktif; disembunyikan bila kosong
/// (posisi di beranda: di bawah chip kategori).
class _PromoCarousel extends StatefulWidget {
  final List<PromoBanner>? banners;
  const _PromoCarousel({this.banners});

  @override
  State<_PromoCarousel> createState() => _PromoCarouselState();
}

class _PromoCarouselState extends State<_PromoCarousel> {
  late final PageController _controller;
  Timer? _timer;
  int _page = 0;

  int get _slideCount => widget.banners?.length ?? 0;

  @override
  void initState() {
    super.initState();
    _controller = PageController(viewportFraction: 0.93);
    _timer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted || !_controller.hasClients || _slideCount == 0) return;
      final next = (_page + 1) % _slideCount;
      _controller.animateToPage(
        next,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final banners = widget.banners ?? const <PromoBanner>[];
    if (banners.isEmpty) return const SizedBox.shrink();
    return Column(children: [
      // Judul section kecil di atas karosel banner admin.
      const Padding(
        padding: EdgeInsets.fromLTRB(16, 10, 16, 6),
        child: Row(children: [
          Icon(Icons.local_offer_rounded, size: 16, color: Color(0xFFFF7001)),
          SizedBox(width: 6),
          Text('Promo untukmu',
              style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.navy)),
        ]),
      ),
      SizedBox(
        height: 124,
        child: PageView.builder(
          controller: _controller,
          itemCount: banners.length,
          onPageChanged: (i) => setState(() => _page = i),
          itemBuilder: (context, i) => _BannerSlide(banner: banners[i]),
        ),
      ),
      const SizedBox(height: 8),
      Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(banners.length, (i) {
          final active = i == _page;
          return AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            margin: const EdgeInsets.symmetric(horizontal: 3),
            width: active ? 18 : 7,
            height: 7,
            decoration: BoxDecoration(
              color: active ? AppColors.brand : AppColors.line,
              borderRadius: BorderRadius.circular(999),
            ),
          );
        }),
      ),
    ]);
  }
}

/// Karosel slide STATIS bawaan (voucher / kecepatan / kepercayaan).
/// Posisi di beranda: di atas chip kategori — selalu ada, selalu berputar,
/// tidak tergantung banner admin.
class _StaticCarousel extends StatefulWidget {
  const _StaticCarousel();

  @override
  State<_StaticCarousel> createState() => _StaticCarouselState();
}

class _StaticCarouselState extends State<_StaticCarousel> {
  late final PageController _controller;
  Timer? _timer;
  int _page = 0;

  @override
  void initState() {
    super.initState();
    _controller = PageController(viewportFraction: 0.93);
    _timer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted || !_controller.hasClients) return;
      final next = (_page + 1) % _staticSlides.length;
      _controller.animateToPage(
        next,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(children: [
        SizedBox(
          height: 108,
          child: PageView.builder(
            controller: _controller,
            itemCount: _staticSlides.length,
            onPageChanged: (i) => setState(() => _page = i),
            itemBuilder: (context, i) =>
                _StaticBannerSlide(s: _staticSlides[i]),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(_staticSlides.length, (i) {
            final active = i == _page;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: active ? 18 : 7,
              height: 7,
              decoration: BoxDecoration(
                color: active ? AppColors.brand : AppColors.line,
                borderRadius: BorderRadius.circular(999),
              ),
            );
          }),
        ),
      ]);
}

/// Slide dari banner unggahan admin — gambar penuh, tap membuka tab tujuan.
class _BannerSlide extends StatelessWidget {
  final PromoBanner banner;
  const _BannerSlide({required this.banner});

  @override
  Widget build(BuildContext context) {
    final url = Api.bannerUrl(banner.imagePath);
    return GestureDetector(
      onTap: () {
        final t = banner.targetTab;
        if (t != null && t >= 0 && t <= 4) mainTabIndex.value = t;
      },
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: AppColors.navy.withValues(alpha: 0.12),
              blurRadius: 16,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: Stack(fit: StackFit.expand, children: [
            Image.network(
              url,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                color: AppColors.brandTint,
                child: const Center(
                    child: Icon(Icons.image_not_supported_rounded,
                        color: AppColors.inkSoft, size: 34)),
              ),
            ),
            // Label nama banner di bawah — bantu aksesibilitas bila gambar tanpa teks.
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.fromLTRB(14, 20, 14, 10),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Color(0x990B3556)],
                  ),
                ),
                child: Text(
                  banner.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 13),
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Slide statis bawaan (gradien + ikon) saat belum ada banner unggahan.
class _StaticBannerSlide extends StatelessWidget {
  final _StaticSlide s;
  const _StaticBannerSlide({required this.s});

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: () {
          if (s.tab >= 0) mainTabIndex.value = s.tab;
        },
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 6),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: s.gradient,
            ),
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: s.gradient[0].withValues(alpha: 0.3),
                blurRadius: 16,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Row(children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(s.icon, color: Colors.white, size: 26),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(s.title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(s.desc,
                      style: const TextStyle(
                          color: Colors.white, fontSize: 11.5, height: 1.3)),
                ],
              ),
            ),
          ]),
        ),
      );
}

/// Strip kartu informasi singkat — cara pesan, laporan, voucher.
class _InfoStrip extends StatelessWidget {
  const _InfoStrip();

  static const List<({IconData icon, Color color, String title, String desc, int tab})> _items = [
    (
      icon: Icons.help_outline_rounded,
      color: Color(0xFF4338CA),
      title: 'Cara pesan',
      desc: 'Pilih layanan → jadwal → bayar',
      tab: -1,
    ),
    (
      icon: Icons.feedback_outlined,
      color: Color(0xFFBE123C),
      title: 'Ada masalah?',
      desc: 'Buat laporan dari tab Laporan',
      tab: 2,
    ),
    (
      icon: Icons.local_activity_outlined,
      color: Color(0xFFB45309),
      title: 'Voucher kamu',
      desc: 'Cek voucher aktif di tab Voucher',
      tab: 3,
    ),
  ];

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 86,
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          scrollDirection: Axis.horizontal,
          itemCount: _items.length,
          separatorBuilder: (_, __) => const SizedBox(width: 10),
          itemBuilder: (context, i) {
            final it = _items[i];
            return GestureDetector(
              onTap: () {
                if (it.tab >= 0) mainTabIndex.value = it.tab;
              },
              child: Container(
                width: 210,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.line),
                ),
                child: Row(children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: it.color.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(it.icon, color: it.color, size: 20),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(it.title,
                            style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 12.5,
                                color: AppColors.navy)),
                        const SizedBox(height: 2),
                        Text(it.desc,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 10.5,
                                color: AppColors.inkSoft,
                                height: 1.25)),
                      ],
                    ),
                  ),
                ]),
              ),
            );
          },
        ),
      );
}

class _CategoryChip extends StatelessWidget {
  final Category category;
  final bool active;
  final VoidCallback onTap;
  const _CategoryChip({required this.category, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final style = styleForIcon(category.icon);
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: 84,
        child: Column(
          children: [
            // Thumbnail bulat bergradien warna khas kategori.
            CategoryThumb(
              iconKey: category.icon,
              size: 58,
              selected: active,
            ),
            const SizedBox(height: 7),
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              style: TextStyle(
                fontSize: 11.5,
                height: 1.15,
                fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                color: active ? style.accent : AppColors.navy,
              ),
              child: Text(
                category.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ServiceCard extends StatelessWidget {
  final Service service;
  final VoidCallback onBook;
  const _ServiceCard({required this.service, required this.onBook});

  @override
  Widget build(BuildContext context) {
    final priceLabel = service.hasOptions
        ? 'mulai dari ${formatRupiah(service.basePrice)}'
        : '${service.priceNote} ${formatRupiah(service.basePrice)}';
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.line),
        boxShadow: [
          BoxShadow(color: AppColors.navy.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Row(children: [
        // Hero: thumbnail "terbang" ke header wizard saat kartu ditap.
        Hero(
          tag: 'service-${service.id}',
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
          child: service.imageUrl != null
              ? Image.network(service.imageUrl!, width: 58, height: 58, fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => ServiceThumbBox(iconKey: service.icon))
              : ServiceThumbBox(iconKey: service.icon),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Hero(
              tag: 'service-name-${service.id}',
              child: Material(
                color: Colors.transparent,
                child: Text(service.name,
                    style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy, fontSize: 14.5)),
              ),
            ),
            if (service.description != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(service.description!,
                    maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
              ),
            const SizedBox(height: 6),
            Row(children: [
              Text(priceLabel,
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.brandDeep)),
              if (service.durationEstimate != null) ...[
                const SizedBox(width: 8),
                Flexible(
                  child: Text('• ${service.durationEstimate}',
                      maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
                ),
              ],
            ]),
          ]),
        ),
        const SizedBox(width: 8),
        // Tombol pesan gradien kecil
        GestureDetector(
          onTap: onBook,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [AppColors.brandDeep, AppColors.brand]),
              borderRadius: BorderRadius.circular(10),
              boxShadow: [BoxShadow(color: AppColors.brand.withValues(alpha: 0.35), blurRadius: 8, offset: const Offset(0, 3))],
            ),
            child: const Text('Pesan',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
          ),
        ),
      ]),
    );
  }
}


