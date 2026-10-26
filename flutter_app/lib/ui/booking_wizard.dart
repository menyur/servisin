import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../api.dart';
import '../category_thumbs.dart';
import '../format.dart';
import '../models.dart';
import '../subscription.dart';
import '../theme.dart';
import 'common.dart';
import 'location_picker.dart';
import 'receipt_screen.dart';

class BookingArgs {
  final Service service;

  /// Hero animation hanya saat dibuka dari kartu layanan (ada pasangan
  /// Hero tag di route asal). Deep link / pembukaan langsung: false,
  /// karena flight hero tanpa route asal memicu assert layout.
  final bool heroEnabled;

  /// Isian awal untuk "Pesan lagi": varian + jumlah, alamat, catatan dari
  /// pesanan lama. Jadwal sengaja tidak diisi — slot lama sudah lewat.
  final ReorderPrefill? ulang;

  BookingArgs({required this.service, this.heroEnabled = true, this.ulang});
}

class BookingWizard extends StatefulWidget {
  final BookingArgs args;

  /// Seam uji: sumber alamat profil. Default `Api.myProfile()` (Supabase).
  /// Dipisahkan supaya pengisian otomatis alamat bisa diuji tanpa jaringan.
  final Future<Profile?> Function()? profileUji;

  /// Seam uji: penyimpan alamat ke profil. Default
  /// `Api.updateMyProfile(address: ...)`.
  final Future<void> Function(String alamat)? simpanAlamatUji;

  const BookingWizard({
    super.key,
    required this.args,
    this.profileUji,
    this.simpanAlamatUji,
  });

  @override
  State<BookingWizard> createState() => _BookingWizardState();
}

class _BookingWizardState extends State<BookingWizard> {
  final _address = TextEditingController();
  final _notes = TextEditingController();
  int _step = 0;
  bool _loading = false;

  ServiceOption? _option;
  String? _date;
  String? _time;
  String _payment = 'transfer';

  /// Jumlah unit untuk layanan per unit TANPA varian (kategori AC).
  int _qty = 1;

  /// Jumlah per varian untuk layanan AC yang punya varian (mis. 1 PK = 1,
  /// 1,5 PK = 2). Varian bernilai 0 tidak dipesan. Satu pesanan boleh memuat
  /// beberapa varian sekaligus; rincian harganya dikirim sebagai p_items.
  final Map<String, int> _qtyVarian = {};

  /// Bidang yang diukur untuk layanan per meter persegi (cat dinding).
  /// Satu baris = satu bidang: panjang × lebar; luasnya dijumlahkan.
  final List<_BidangUkur> _bidang = [_BidangUkur()];

  /// Biaya aplikasi yang sedang berlaku dari setelan admin. Mulai dari angka
  /// bawaan supaya ringkasan tidak pernah menampilkan Rp0 sebelum pembacaan
  /// selesai; setelah itu angka di layar = angka yang ditagihkan server.
  int _appFee = appFee;

  /// Rekening resmi dari app_settings (diisi admin); null = belum diisi.
  Map<String, String>? _transferAccount;

  /// Alamat yang sedang tersimpan di PROFIL, hasil pembacaan terakhir.
  /// `null` = profil belum/tidak terbaca — tawaran "simpan ke profil" tidak
  /// ditampilkan karena kita tidak tahu apakah alamatnya benar-benar berubah
  /// (dan menyimpan butuh sesi yang sah).
  String? _alamatProfil;

  /// Buku alamat berlabel (profiles.saved_addresses). Kosong = akun lama /
  /// migrasi belum jalan → wizard tetap memakai alamat profil seperti dulu.
  List<SavedAddress> _alamatTersimpan = const [];

  /// Sedang menyimpan alamat ke profil? Menahan ketukan ganda.
  bool _menyimpanAlamat = false;

  /// Tampilkan tawaran simpan hanya bila ada alamat yang DIKETIK, berbeda
  /// dari profil, dan belum ada di buku alamat. Alamat yang sama tidak perlu
  /// ditawarkan — menyimpannya tidak mengubah apa pun, hanya menambah gangguan
  /// di tengah pemesanan.
  bool get _bisaSimpanAlamatKeProfil {
    final alamat = _address.text.trim();
    if (_alamatProfil == null || alamat.isEmpty || alamat == _alamatProfil) {
      return false;
    }
    return !_alamatTersimpan.any(
        (a) => a.address.toLowerCase() == alamat.toLowerCase());
  }

  /// Titik lokasi (pin rumah) opsional dipasang pelanggan lewat flutter_map.
  ({double lat, double lng})? _pin;
  bool get _pinChosen => _pin != null;

  /// Buka pemilih titik; hasil non-null disimpan untuk dikirim ke RPC.
  Future<void> _pickPin() async {
    final result = await Navigator.push<LatLng>(
      context,
      MaterialPageRoute(
        builder: (_) => LocationPickerScreen(
          initialLat: _pin?.lat,
          initialLng: _pin?.lng,
          // Penanda "lokasi terakhir" di-scope per akun, agar pengguna lain di
          // perangkat sama tak menimpa titik awal peta.
          userId: Api.session?.user.id,
        ),
      ),
    );
    if (result == null || !mounted) return; // pengguna batal
    setState(() => _pin = (lat: result.latitude, lng: result.longitude));
  }

  @override
  void initState() {
    super.initState();
    if (_pakaiVarian) {
      // Mulai dari varian pertama = 1 unit supaya pelanggan tidak melihat
      // ringkasan Rp0; varian lain 0 sampai ditambah sendiri.
      _qtyVarian[_service.options.first.id] = 1;
    } else if (_service.hasOptions && !_kendaraan) {
      // Kendaraan sengaja TIDAK dipilihkan otomatis: jenisnya (Motor/Mobil)
      // memengaruhi harga, jadi pelanggan harus memilih sendiri.
      _option = _service.options.first;
    }
    // "Pesan lagi": isi ulang pilihan dari pesanan lama supaya pelanggan tidak
    // mengetik/memilih ulang semuanya — hanya jadwal baru yang dipilih.
    final ulang = widget.args.ulang;
    if (ulang != null) {
      _address.text = ulang.address;
      if ((ulang.notes ?? '').isNotEmpty) _notes.text = ulang.notes!;
      for (final o in _service.options) {
        if (o.id == ulang.optionId) _option = o;
      }
      if (_pakaiVarian && ulang.qtyVarian.isNotEmpty) {
        _qtyVarian
          ..clear()
          ..addAll(ulang.qtyVarian);
      }
      if (!_pakaiVarian && !_service.hasOptions && ulang.quantity > 1) {
        _qty = ulang.quantity.clamp(1, maxServiceQuantity);
      }
    }
    Api.transferAccount().then((a) {
      if (mounted) setState(() => _transferAccount = a);
    });
    // Gagal membaca → tetap tarif bawaan (bukan 0).
    Api.fetchAppFee().then((fee) {
      if (mounted) setState(() => _appFee = fee);
    });
    _isiAlamatDariProfil();
  }

  /// Isi kolom alamat dari PROFIL pengguna.
  ///
  /// Alasan: alamat rumah jarang berubah, sedangkan sebelumnya pelanggan harus
  /// mengetik ulang setiap kali memesan — dan salah ketik alamat berarti
  /// teknisi salah rumah. Hanya kolom yang MASIH KOSONG yang diisi: profil
  /// dibaca secara asinkron, jadi bisa tiba setelah pengguna mulai mengetik
  /// (jaringan lambat); ketikan pengguna tidak boleh tertimpa.
  ///
  /// Gagal membaca profil (offline / belum diisi) bukan alasan menghalangi
  /// pemesanan — kolom tetap kosong dan bisa diisi manual seperti biasa.
  Future<void> _isiAlamatDariProfil() async {
    try {
      final profil = await (widget.profileUji ?? Api.myProfile)();
      if (!mounted) return;
      // Profil null = tidak ada sesi / gagal baca: jangan tawarkan simpan.
      if (profil == null) return;
      final profilAlamat = (profil.address ?? '').trim();
      // profiles.address adalah sumber utama, tetapi bila kosong sementara buku
      // alamat sudah punya alamat utama, pakai alamat itu — jangan biarkan
      // kolom kosong padahal pelanggan sudah menyimpan alamatnya.
      SavedAddress? utama;
      for (final a in profil.savedAddresses) {
        if (a.isPrimary) {
          utama = a;
          break;
        }
      }
      final alamat =
          profilAlamat.isNotEmpty ? profilAlamat : (utama?.address ?? '');
      setState(() {
        _alamatProfil = alamat;
        _alamatTersimpan = profil.savedAddresses;
      });
      if (alamat.isEmpty) return;
      if (_address.text.trim().isNotEmpty) return;
      _address.value = TextEditingValue(
        text: alamat,
        selection: TextSelection.collapsed(offset: alamat.length),
      );
      final titik = utama;
      if (profilAlamat.isEmpty &&
          titik != null &&
          titik.lat != null &&
          titik.lng != null) {
        setState(() => _pin = (lat: titik.lat!, lng: titik.lng!));
      }
    } catch (_) {
      // diam: pemesanan tetap bisa dilanjutkan dengan alamat manual
    }
  }

  /// Simpan alamat yang sedang diketik ke profil pengguna.
  ///
  /// Hanya berjalan setelah pengguna MENGETUK "Simpan" — alamat pesanan bisa
  /// berbeda dari alamat rumah (memesan untuk kantor/orang tua), jadi menimpa
  /// profil tanpa izin bukan pilihan. Kegagalan TIDAK menghalangi pemesanan:
  /// alamat di kolom tetap dipakai untuk pesanan ini, hanya profilnya yang
  /// belum berubah — dan pengguna diberi tahu apa adanya.
  Future<void> _simpanAlamatKeProfil() async {
    final alamat = _address.text.trim();
    if (alamat.isEmpty || _menyimpanAlamat) return;

    // Label hanya ditanyakan saat memakai jalur sungguhan. Seam uji lama
    // (`simpanAlamatUji`) tetap satu argumen supaya pengujian yang ada tidak
    // berubah perilaku.
    String? label;
    if (widget.simpanAlamatUji == null) {
      label = await _pilihLabelAlamat();
      if (label == null || label.trim().isEmpty || !mounted) return; // batal
    }

    setState(() => _menyimpanAlamat = true);
    try {
      if (widget.simpanAlamatUji != null) {
        await widget.simpanAlamatUji!(alamat);
        if (!mounted) return;
        setState(() {
          _menyimpanAlamat = false;
          // Tawaran hilang sendiri: alamat di profil sudah sama dengan kolom.
          _alamatProfil = alamat;
        });
        showSnack(context,
            'Alamat disimpan ke profil — pesanan berikutnya terisi otomatis.');
        return;
      } else {
        final r = await Api.saveMyAddress(
          label: label!,
          address: alamat,
          lat: _pin?.lat,
          lng: _pin?.lng,
        );
        if (!mounted) return;
        if (!r.ok) {
          setState(() => _menyimpanAlamat = false);
          showSnackError(context, r.error ?? 'Gagal menyimpan alamat.',
              'Gagal menyimpan alamat.');
          return;
        }
        setState(() {
          _menyimpanAlamat = false;
          _alamatTersimpan = r.alamat;
          // Alamat pertama otomatis menjadi utama → profil ikut berubah.
          final jadiUtama = r.alamat.any((a) =>
              a.isPrimary && a.address.toLowerCase() == alamat.toLowerCase());
          if (jadiUtama) _alamatProfil = alamat;
        });
        showSnack(context,
            'Alamat disimpan — pilih kapan saja saat memesan berikutnya.');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _menyimpanAlamat = false);
      // Pesan jalur lama dipertahankan apa adanya (dipakai pengujian & sudah
      // dikenal pengguna); jalur buku alamat memakai kalimat yang lebih tepat.
      showSnackError(
          context,
          e,
          widget.simpanAlamatUji != null
              ? 'Gagal menyimpan alamat ke profil.'
              : 'Gagal menyimpan alamat.');
    }
  }

  /// Dialog label singkat: Rumah/Kantor, atau label bebas.
  Future<String?> _pilihLabelAlamat() async {
    final ctrl = TextEditingController(text: 'Rumah');
    try {
      return await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Simpan alamat ini sebagai'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            Wrap(spacing: 8, children: [
              for (final l in const ['Rumah', 'Kantor'])
                ActionChip(
                  label: Text(l),
                  onPressed: () => Navigator.pop(ctx, l),
                ),
            ]),
            const SizedBox(height: 10),
            TextField(
              controller: ctrl,
              maxLength: 24,
              decoration: const InputDecoration(
                  labelText: 'Label lain', hintText: 'Contoh: Rumah orang tua'),
            ),
          ]),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            TextButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('Simpan'),
            ),
          ],
        ),
      );
    } finally {
      ctrl.dispose();
    }
  }

  /// Pakai alamat tersimpan: isi kolom + titik lokasinya.
  /// Alamat tanpa titik menghapus pin lama — kalau tidak, teknisi bisa
  /// diarahkan ke rumah padahal pesanan untuk kantor.
  void _pakaiAlamat(SavedAddress a) {
    setState(() {
      _address.value = TextEditingValue(
        text: a.address,
        selection: TextSelection.collapsed(offset: a.address.length),
      );
      _pin = (a.lat != null && a.lng != null)
          ? (lat: a.lat!, lng: a.lng!)
          : null;
    });
  }

  Future<void> _jadikanUtama(SavedAddress a) async {
    final r = await Api.saveMyAddress(
      label: a.label,
      address: a.address,
      lat: a.lat,
      lng: a.lng,
      makePrimary: true,
    );
    if (!mounted) return;
    if (!r.ok) {
      showSnackError(context, r.error ?? 'Gagal mengubah alamat utama.',
          'Gagal mengubah alamat utama.');
      return;
    }
    setState(() {
      _alamatTersimpan = r.alamat;
      _alamatProfil = a.address;
    });
  }

  Future<void> _hapusAlamat(SavedAddress a) async {
    final yakin = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Hapus alamat "${a.label}"?'),
        content: Text(a.address),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Batal')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Hapus',
                style: TextStyle(color: AppColors.coral)),
          ),
        ],
      ),
    );
    if (yakin != true || !mounted) return;
    final r = await Api.deleteMyAddress(a.id);
    if (!mounted) return;
    if (!r.ok) {
      showSnackError(context, r.error ?? 'Gagal menghapus alamat.',
          'Gagal menghapus alamat.');
      return;
    }
    setState(() => _alamatTersimpan = r.alamat);
  }

  /// Lembar kelola: jadikan utama / hapus alamat tersimpan.
  Future<void> _kelolaAlamat() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('Buku alamat',
                  style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                      color: AppColors.navy)),
              const SizedBox(height: 4),
              const Text('Alamat utama dipakai otomatis di pesanan berikutnya.',
                  style: TextStyle(
                      fontSize: 11.5, color: AppColors.inkSoft)),
              const SizedBox(height: 8),
              if (_alamatTersimpan.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Text('Belum ada alamat tersimpan.',
                      style: TextStyle(color: AppColors.inkSoft)),
                )
              else
                for (final a in _alamatTersimpan)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                        a.isPrimary
                            ? Icons.home_rounded
                            : Icons.place_outlined,
                        color:
                            a.isPrimary ? AppColors.brand : AppColors.inkSoft),
                    title: Text(a.label,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 13.5)),
                    subtitle: Text(a.address,
                        style: const TextStyle(fontSize: 11.5),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (!a.isPrimary)
                        IconButton(
                          tooltip: 'Jadikan alamat utama',
                          icon: const Icon(Icons.star_border_rounded, size: 20),
                          onPressed: () async {
                            await _jadikanUtama(a);
                            setSheet(() {});
                          },
                        ),
                      IconButton(
                        tooltip: 'Hapus alamat',
                        icon: const Icon(Icons.delete_outline_rounded,
                            size: 20, color: AppColors.coral),
                        onPressed: () async {
                          await _hapusAlamat(a);
                          setSheet(() {});
                        },
                      ),
                    ]),
                  ),
              const SizedBox(height: 4),
            ]),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _address.dispose();
    _notes.dispose();
    for (final b in _bidang) {
      b.dispose();
    }
    super.dispose();
  }

  Voucher? _voucher;
  List<Voucher>? _vouchers;
  Uint8ListWrap? _attachment;

  Service get _service => widget.args.service;

  /// Bungkus child dalam Hero bila wizard dibuka dari kartu layanan.
  /// Deep link: tanpa Hero — hindari assert "RenderBox was not laid out".
  Widget _serviceHero({required String tag, required Widget child}) =>
      widget.args.heroEnabled ? Hero(tag: tag, child: child) : child;

  int get _unitPrice => _option?.price ?? _service.basePrice;

  /// Pemilih jumlah hanya muncul untuk layanan per unit (AC) dan per kendaraan.
  /// Untuk kategori lain nilainya tetap 1 sehingga perilaku lama tidak berubah.
  bool get _pakaiJumlah => _service.supportsQuantity;

  /// Layanan kendaraan memakai satu pilihan jenis (Motor/Mobil) + jumlah
  /// kendaraan, bukan jumlah per varian seperti AC.
  bool get _kendaraan => _service.isVehicle;

  /// Layanan AC yang punya varian memakai pemilih jumlah PER varian, sehingga
  /// satu pesanan bisa berisi mis. 1 unit 1 PK + 2 unit 1,5 PK. Kendaraan
  /// dikecualikan: satu pesanan = satu jenis kendaraan × jumlah.
  bool get _pakaiVarian => _pakaiJumlah && _service.hasOptions && !_kendaraan;

  /// Varian terpilih (qty > 0), tetap dalam urutan katalog.
  List<({ServiceOption option, int qty})> get _barisVarian => [
        for (final o in _service.options)
          if ((_qtyVarian[o.id] ?? 0) > 0) (option: o, qty: _qtyVarian[o.id]!),
      ];

  /// Total unit satu pesanan (jumlah semua varian).
  int get _totalQty => _pakaiVarian
      ? _barisVarian.fold(0, (sum, b) => sum + b.qty)
      : (_pakaiJumlah ? _qty : 1);

  int get _quantity => _pakaiLuas ? 1 : _totalQty;
  int get _discount => _voucher?.amount ?? 0;

  /// Layanan per meter persegi: pelanggan mengisi panjang × lebar tiap bidang.
  bool get _pakaiLuas => _service.usesArea;

  /// Total luas (m²) seluruh bidang yang lengkap; null bila belum ada.
  double? get _luasTotal {
    double total = 0;
    var ada = false;
    for (final b in _bidang) {
      final luas = luasBidang(b.panjang.text, b.lebar.text);
      if (luas == null) continue;
      total += luas;
      ada = true;
    }
    if (!ada) return null;
    return (total * 100).roundToDouble() / 100;
  }

  /// Subtotal layanan: harga per m² × luas total (layanan area), atau jumlah
  /// harga satuan × qty tiap varian/unit (layanan biasa).
  int get _subtotalLayanan {
    if (_pakaiLuas) return subtotalLuas(_unitPrice, _luasTotal);
    return _pakaiVarian
        ? _barisVarian.fold(0, (sum, b) => sum + b.option.price * b.qty)
        : _unitPrice * _quantity;
  }

  /// Rincian tagihan dihitung dengan aturan yang sama seperti server:
  /// subtotal baris + biaya aplikasi sekali − diskon.
  BookingPrice get _harga => hitungHargaDariSubtotal(
        subtotal: _subtotalLayanan,
        appFee: _appFee,
        discount: _discount,
      );
  int get _total => _harga.total;

  /// Baris untuk ringkasan pembayaran. Satu baris memakai tampilan lama
  /// (harga satuan + jumlah); lebih dari satu tampil per varian.
  List<({String label, int qty, int unitPrice, int lineTotal, double? area})>
      get _barisRingkasan {
    if (_pakaiVarian) {
      return [
        for (final b in _barisVarian)
          (
            label: b.option.label,
            qty: b.qty,
            unitPrice: b.option.price,
            lineTotal: b.option.price * b.qty,
            area: null,
          ),
      ];
    }
    return [
      (
        label: _option?.label ?? _service.name,
        qty: _quantity,
        unitPrice: _unitPrice,
        lineTotal: _subtotalLayanan,
        area: _pakaiLuas ? _luasTotal : null,
      ),
    ];
  }

  /// Nama layanan pada ringkasan: multi-varian memakai nama layanan saja
  /// (varian tampil per baris), selain itu sertakan varian tunggalnya.
  String get _namaRingkasan {
    if (_pakaiLuas) {
      return _option == null
          ? _service.name
          : '${_service.name} — ${_option!.label}';
    }
    if (_pakaiVarian) {
      final baris = _barisVarian;
      // Satu varian: sertakan namanya seperti tampilan lama. Multi-varian:
      // nama layanan saja, variannya tampil satu baris masing-masing.
      return baris.length == 1
          ? '${_service.name} — ${baris.first.option.label}'
          : _service.name;
    }
    return _option == null
        ? _service.name
        : '${_service.name} — ${_option!.label}';
  }

  /// Pemakaian slot tanggal terpilih (hasil `booking_slot_usage`). Kosong =
  /// belum dibaca / migrasi kuota belum jalan → semua slot tampil.
  Map<String, SlotUsage> _slotUsage = const {};
  bool _memuatSlot = false;

  /// Slot yang masih bisa dipesan untuk tanggal terpilih.
  ///
  /// Dua penolakan server dicegah di sini: jam yang sudah lewat (hari ini) dan
  /// slot yang kuotanya penuh. Membiarkan pelanggan memilih slot yang pasti
  /// gagal hanya membuang waktu — server tetap memeriksa ulang semuanya.
  List<String> get _availableTimes =>
      slotTersedia(_date, pemakaian: _slotUsage);

  /// Semua slot tanggal terpilih penuh karena kuota (bukan karena jam lewat).
  bool get _semuaSlotPenuh =>
      _date != null && timeSlots.every((t) => _slotUsage[t]?.full == true);

  /// Muat sisa kuota untuk [tanggal]; gagal = semua slot tetap tampil.
  Future<void> _muatSlot(String tanggal) async {
    setState(() => _memuatSlot = true);
    final usage = await Api.fetchSlotUsage(tanggal);
    if (!mounted || _date != tanggal) return;
    setState(() {
      _slotUsage = usage;
      _memuatSlot = false;
      // Slot yang tadinya dipilih bisa sudah penuh — kosongkan agar tidak
      // mengirim pesanan yang pasti ditolak.
      if (_time != null && !_availableTimes.contains(_time)) _time = null;
    });
  }

  /// Maju satu langkah, tetapi jangan biarkan langkah wajib dilewati:
  /// sebelumnya pelanggan bisa melompat ke Pembayaran lalu terlempar kembali
  /// ke Jadwal saat menekan "Buat Pesanan" — alasan gagalnya baru terlihat
  /// setelah semua isian dianggap selesai.
  void _next() {
    if (_step == 0 && _pakaiLuas && _luasTotal == null) {
      showSnack(context, 'Isi panjang dan lebar minimal satu bidang.',
          error: true);
      return;
    }
    if (_step == 0 && _pakaiVarian && _totalQty == 0) {
      showSnack(context, 'Pilih jumlah minimal satu varian AC.', error: true);
      return;
    }
    if (_step == 0 && _kendaraan && _service.hasOptions && _option == null) {
      showSnack(context, 'Pilih jenis kendaraan (Motor/Mobil) dulu.',
          error: true);
      return;
    }
    if (_step == 0 &&
        !_pakaiVarian &&
        !_kendaraan &&
        _service.hasOptions &&
        _option == null) {
      showSnack(context, 'Pilih ukuran/varian layanan dulu.', error: true);
      return;
    }
    if (_step == 1) {
      if (_address.text.trim().isEmpty) {
        showSnack(context, 'Isi alamat lengkap dulu.', error: true);
        return;
      }
      if (_date == null || _time == null || !_availableTimes.contains(_time)) {
        showSnack(context, 'Pilih tanggal dan jam kedatangan dulu.',
            error: true);
        return;
      }
    }
    setState(() => _step = (_step + 1).clamp(0, 2));
  }

  Future<void> _pickVoucher() async {
    _vouchers ??= await Api.fetchMyVouchers().catchError((_) => <Voucher>[]);
    if (!mounted) return;
    final picked = await showModalBottomSheet<Voucher>(
      context: context,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => ListView(
        padding: const EdgeInsets.all(16),
        shrinkWrap: true,
        children: [
          const Text('Voucher Saya',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 8),
          if (_vouchers!.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text(
                  'Belum ada voucher aktif. Nilai pesanan selesai untuk mendapat voucher!',
                  style: TextStyle(color: AppColors.inkSoft)),
            ),
          ..._vouchers!.map((v) => ListTile(
                leading:
                    const Icon(Icons.local_activity, color: AppColors.brand),
                title: Text(v.code,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(
                    'Diskon ${formatRupiah(v.amount)} • berlaku s.d. ${formatDateShort(v.expiresAt.toString())}'),
                onTap: () => Navigator.pop(context, v),
              )),
        ],
      ),
    );
    if (picked != null) setState(() => _voucher = picked);
  }

  Future<void> _pickAttachment() async {
    // sumber gambar: galeri atau kamera (foto AC/lokasi bisa diambil langsung)
    final source = await chooseImageSource(context, title: 'Lampiran Foto');
    if (source == null || !mounted) return; // pengguna menutup pilihan
    final bytes = await Api.pickAndCompressImage(source: source);
    if (bytes == null || !mounted) return;
    setState(() => _attachment = Uint8ListWrap(bytes));
  }

  Future<void> _submit() async {
    // Langkah bisa dilompati lewat indikator di atas; validasi varian tetap
    // harus jalan sebelum RPC dipanggil.
    if (_pakaiLuas && _luasTotal == null) {
      setState(() => _step = 0);
      showSnack(context, 'Isi panjang dan lebar minimal satu bidang.',
          error: true);
      return;
    }
    if (_pakaiVarian && _totalQty == 0) {
      setState(() => _step = 0);
      showSnack(context, 'Pilih jumlah minimal satu varian AC.', error: true);
      return;
    }
    if (!_pakaiVarian && _service.hasOptions && _option == null) {
      setState(() => _step = 0);
      showSnack(context, 'Pilih ukuran/varian layanan dulu.', error: true);
      return;
    }
    if (_date == null ||
        _time == null ||
        !_availableTimes.contains(_time) ||
        _address.text.trim().isEmpty) {
      setState(() {
        _step = 1;
        // Jam bisa menjadi tidak valid selama wizard terbuka (batas slot
        // terlewati) — kosongkan agar pelanggan memilih ulang.
        if (_time != null && !_availableTimes.contains(_time)) _time = null;
      });
      showSnack(context, 'Lengkapi jadwal dan alamat dulu.', error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      String? attachmentPath;
      if (_attachment != null) {
        attachmentPath = await Api.uploadToBucket(
          bucket: 'attachments',
          folder: 'booking-photos',
          bytes: _attachment!.bytes,
        );
      }
      final baris = _barisVarian;
      final multi = _pakaiVarian && baris.length > 1;
      final tunggal = _pakaiVarian && baris.isNotEmpty ? baris.first : null;
      final bookingResult = await Api.createBooking(
        serviceId: _service.id,
        // Satu varian tetap memakai argumen lama; multi-varian dikirim sebagai
        // daftar baris dan harganya ditentukan server dari katalog.
        optionId: multi ? null : (tunggal?.option.id ?? _option?.id),
        bookingDate: _date!,
        bookingTime: _time!,
        address: _address.text.trim(),
        notes: _notes.text.trim(),
        attachmentUrl: attachmentPath,
        paymentMethod: _payment,
        voucherId: _voucher?.id,
        lat: _pin?.lat,
        lng: _pin?.lng,
        quantity: multi ? _totalQty : (tunggal?.qty ?? _quantity),
        items: multi
            ? baris
                .map((b) => (optionId: b.option.id, quantity: b.qty))
                .toList()
            : null,
        // Layanan per m²: server menghitung subtotal dari harga katalog × luas.
        area: _pakaiLuas ? _luasTotal : null,
        // Respons RPC tidak membawa join layanan — isi dari katalog supaya
        // struk sesaat setelah memesan menampilkan nama & satuan yang benar.
        serviceName: _service.name,
        serviceCategory: _service.categoryId,
      );
      if (!mounted) return;
      // Tab tujuan setelah struk ditutup = Pesanan. Struk menggantikan
      // wizard (pushReplacement) — tombol "Lihat Pesanan" kembali ke tab itu.
      mainTabIndex.value = 1;
      if (!context.mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => ReceiptScreen(booking: bookingResult),
      ));
    } catch (e) {
      if (mounted) {
        showSnackError(context, e, 'Gagal membuat pesanan: ${_msg(e)}');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _msg(Object e) {
    final s = e.toString();
    return s.length > 120 ? '${s.substring(0, 120)}…' : s;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          // Pasangan Hero dari kartu layanan: thumbnail + nama "terbang"
          // ke sini saat wizard dibuka. Nonaktif bila dibuka via deep link.
          _serviceHero(
            tag: 'service-${_service.id}',
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: _service.imageUrl != null
                  ? Image.network(_service.imageUrl!,
                      width: 40,
                      height: 40,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => ServiceThumbBox(
                          iconKey: _service.icon, size: 40, radius: 10))
                  : ServiceThumbBox(
                      iconKey: _service.icon, size: 40, radius: 10),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _serviceHero(
              tag: 'service-name-${_service.id}',
              child: Material(
                color: Colors.transparent,
                child: Text(
                  _service.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppColors.navy),
                ),
              ),
            ),
          ),
        ]),
      ),
      // Stepper kustom — widget Stepper bawaan bermasalah di web saat
      // wizard dirender sebagai route pertama (deep link): internals-nya
      // melempar constraint lebar tak terbatas ke tombol controls.
      body: SingleChildScrollView(
        // Bawah: 32 px desain + tinggi bilah navigasi sistem — tombol
        // "Lanjut"/"Buat Pesanan" ada di ujung gulir dan bisa tertutup bilah
        // gestur/3 tombol di Android 15+ (edge-to-edge).
        padding: EdgeInsets.fromLTRB(16, 16, 16, jarakBawahSistem(context, 32)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _StepIndicator(
                current: _step, onStepTapped: (i) => setState(() => _step = i)),
            const SizedBox(height: 24),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 220),
              child:
                  KeyedSubtree(key: ValueKey(_step), child: _buildStep(_step)),
            ),
            const SizedBox(height: 24),
            // Catatan: tema global memberi tombol minimumSize lebar tak
            // terbatas (Size.fromHeight) — sah di Column/Expanded, tapi
            // assert di dalam Row. Karena itu kedua tombol diberi
            // minimumSize eksplisit di sini.
            Row(children: [
              if (_step > 0)
                OutlinedButton(
                  onPressed: () =>
                      setState(() => _step = (_step - 1).clamp(0, 2)),
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size(104, 48)),
                  child: const Text('Kembali'),
                ),
              const SizedBox(width: 10),
              FilledButton(
                onPressed: _loading ? null : (_step == 2 ? _submit : _next),
                style: FilledButton.styleFrom(minimumSize: const Size(150, 48)),
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Text(_step == 2 ? 'Buat Pesanan' : 'Lanjut'),
              ),
            ]),
          ],
        ),
      ),
    );
  }

  /// Panel ukur luas untuk layanan per meter persegi (mis. cat dinding).
  /// Tiap bidang diisi panjang × lebar; luasnya dijumlahkan dan dikalikan
  /// harga per m² — angka yang sama dipakai server saat menagih.
  /// Panel khusus layanan kendaraan: pilih Motor/Mobil lalu jumlah kendaraan.
  /// Harga satuan = harga varian terpilih; subtotal = harga × jumlah, sama
  /// dengan yang dihitung server dari katalog.
  Widget _vehiclePanel() {
    return Container(
      margin: const EdgeInsets.only(top: 2, bottom: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.brandTint.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.directions_car_filled_rounded,
              size: 20, color: AppColors.brandDeep),
          SizedBox(width: 8),
          Text('Jenis kendaraan',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        ]),
        const SizedBox(height: 4),
        const Text(
            'Pilih kendaraan yang akan diservis. Harga mobil berbeda dari motor.',
            style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
        const SizedBox(height: 10),
        ..._service.options.map((o) => _OptionCard(
              label: o.label,
              duration: o.durationEstimate,
              price: formatRupiah(o.price),
              selected: _option?.id == o.id,
              onTap: () => setState(() => _option = o),
            )),
        if (_option == null)
          const Padding(
            padding: EdgeInsets.only(top: 2, bottom: 6),
            child: Text('Pilih Motor atau Mobil dulu.',
                style: TextStyle(fontSize: 12, color: AppColors.coral)),
          ),
        _QuantityPicker(
          value: _qty,
          unitPrice: _unitPrice,
          subtotal: _harga.subtotal,
          title: 'Jumlah kendaraan',
          subtitle: 'Harga dihitung per kendaraan',
          icon: Icons.two_wheeler_rounded,
          unitWord: 'kendaraan',
          onChanged: (v) => setState(() => _qty = v),
        ),
      ]),
    );
  }

  Widget _areaPanel() {
    final total = _luasTotal;
    return Container(
      margin: const EdgeInsets.only(top: 4, bottom: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.brandTint.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Luas yang dikerjakan',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 4),
        Text(_service.areaNoteTeks,
            style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
        const SizedBox(height: 10),
        for (var i = 0; i < _bidang.length; i++) ...[
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(
              flex: 4,
              child: TextField(
                controller: _bidang[i].panjang,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                    labelText: 'Panjang (m)', hintText: '4', isDense: true),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 4,
              child: TextField(
                controller: _bidang[i].lebar,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                    labelText: 'Lebar (m)', hintText: '3', isDense: true),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 3,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Text(
                  luasBidang(_bidang[i].panjang.text, _bidang[i].lebar.text) ==
                          null
                      ? '–'
                      : formatArea(luasBidang(
                          _bidang[i].panjang.text, _bidang[i].lebar.text)),
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 13),
                ),
              ),
            ),
            if (_bidang.length > 1)
              IconButton(
                onPressed: () => setState(() {
                  _bidang.removeAt(i).dispose();
                }),
                icon: const Icon(Icons.close_rounded,
                    size: 18, color: AppColors.coral),
                tooltip: 'Hapus bidang',
              ),
          ]),
          const SizedBox(height: 6),
        ],
        TextButton.icon(
          onPressed: () => setState(() => _bidang.add(_BidangUkur())),
          icon: const Icon(Icons.add_rounded, size: 18),
          label: const Text('Tambah bidang'),
        ),
        const Divider(height: 14),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('Total luas',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          Text(total == null ? '–' : formatArea(total),
              style:
                  const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        ]),
        const SizedBox(height: 2),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(
              '${formatRupiah(_unitPrice)} / m² × ${total == null ? '0 m²' : formatArea(total)}',
              style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
          Text(formatRupiah(_subtotalLayanan),
              style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                  color: AppColors.brandDeep)),
        ]),
        if (total == null)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('Isi panjang dan lebar minimal satu bidang.',
                style: TextStyle(fontSize: 12, color: AppColors.coral)),
          ),
      ]),
    );
  }

  /// Konten tiap langkah — dipindah apa adanya dari widget Stepper lama.
  Widget _buildStep(int step) {
    if (step == 0) {
      // STEP 0 — varian & keluhan
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (_service.description != null)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 14),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.brandTint,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(children: [
              const Icon(Icons.info_outline_rounded,
                  size: 18, color: AppColors.brandDeep),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(_service.description!,
                      style: const TextStyle(
                          color: AppColors.brandDeep, fontSize: 13))),
            ]),
          ),
        // Berlaku untuk SEMUA layanan: nominal katalog adalah harga jasa,
        // bukan termasuk sparepart/suku cadang/bahan.
        Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.line),
          ),
          child: const Row(children: [
            Icon(Icons.receipt_long_outlined,
                size: 15, color: AppColors.inkSoft),
            SizedBox(width: 8),
            Expanded(
              child: Text(hargaJasaNote,
                  style: TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
            ),
          ]),
        ),
        // AC dengan varian: jumlah diisi PER varian, bukan memilih satu kartu.
        // Satu kunjungan bisa menangani 1 unit 1 PK + 2 unit 1,5 PK.
        if (_pakaiVarian) ...[
          const Text('Varian & jumlah unit AC',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 4),
          const Text('Isi jumlah tiap ukuran. Minimal satu varian dipesan.',
              style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
          const SizedBox(height: 10),
          ..._service.options.map((o) => _VariantRow(
                label: o.label,
                duration: o.durationEstimate,
                unitPrice: o.price,
                value: _qtyVarian[o.id] ?? 0,
                canAdd: _totalQty < maxServiceQuantity,
                onChanged: (v) {
                  // Total seluruh varian dibatasi 20 (sama dengan constraint DB).
                  final lain = _totalQty - (_qtyVarian[o.id] ?? 0);
                  final maks = maxServiceQuantity - lain;
                  setState(() => _qtyVarian[o.id] = v.clamp(0, maks));
                },
              )),
          if (_totalQty >= maxServiceQuantity)
            const Padding(
              padding: EdgeInsets.only(top: 2),
              child: Text('Total unit mencapai batas 20 per pesanan.',
                  style: TextStyle(fontSize: 12, color: AppColors.coral)),
            ),
        ] else if (_kendaraan) ...[
          _vehiclePanel(),
        ] else if (_service.hasOptions) ...[
          Text(_pakaiLuas ? 'Pilih jenis pekerjaan' : 'Pilih ukuran/varian',
              style:
                  const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          ..._service.options.map((o) {
            final selected = _option?.id == o.id;
            return _OptionCard(
              label: o.label,
              duration: o.durationEstimate,
              price: formatRupiah(o.price),
              selected: selected,
              onTap: () => setState(() => _option = o),
            );
          }),
        ],
        // Layanan per unit TANPA varian tetap memakai satu pemilih jumlah.
        if (_pakaiJumlah && !_service.hasOptions) ...[
          const SizedBox(height: 4),
          _QuantityPicker(
            value: _qty,
            unitPrice: _unitPrice,
            subtotal: _harga.subtotal,
            title: _kendaraan ? 'Jumlah kendaraan' : 'Jumlah unit AC',
            subtitle: _kendaraan
                ? 'Harga dihitung per kendaraan'
                : 'Harga dihitung per unit',
            icon:
                _kendaraan ? Icons.two_wheeler_rounded : Icons.ac_unit_rounded,
            unitWord: _kendaraan ? 'kendaraan' : 'unit',
            onChanged: (v) => setState(() => _qty = v),
          ),
        ],
        if (_pakaiLuas) _areaPanel(),
        const SizedBox(height: 4),
        TextField(
          controller: _notes,
          maxLines: 3,
          decoration: const InputDecoration(
              labelText: 'Catatan keluhan (opsional)',
              hintText: 'Contoh: AC tidak dingin sejak kemarin'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: _pickAttachment,
          style:
              OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          icon: const Icon(Icons.photo_camera_outlined, size: 18),
          label: Text(_attachment == null
              ? 'Lampirkan foto (opsional)'
              : 'Foto terlampir ✓'),
        ),
      ]);
    }
    if (step == 1) {
      // STEP 1 — jadwal & alamat
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Buku alamat berlabel: satu ketukan mengisi alamat + titiknya.
        // Tidak muncul untuk akun tanpa alamat tersimpan (perilaku lama tetap).
        if (_alamatTersimpan.isNotEmpty) ...[
          Row(children: [
            const Expanded(
              child: Text('Alamat tersimpan',
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.navy)),
            ),
            TextButton.icon(
              onPressed: _kelolaAlamat,
              style: TextButton.styleFrom(
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 6),
                visualDensity: VisualDensity.compact,
              ),
              icon: const Icon(Icons.edit_outlined, size: 14),
              label: const Text('Kelola',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            ),
          ]),
          const SizedBox(height: 4),
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _alamatTersimpan.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final a = _alamatTersimpan[i];
                final terpilih =
                    _address.text.trim().toLowerCase() ==
                        a.address.trim().toLowerCase();
                return ActionChip(
                  avatar: Icon(
                    a.isPrimary ? Icons.home_rounded : Icons.place_outlined,
                    size: 15,
                    color: terpilih ? Colors.white : AppColors.brandDeep,
                  ),
                  label: Text(a.label,
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: terpilih ? Colors.white : AppColors.navy)),
                  backgroundColor:
                      terpilih ? AppColors.brand : AppColors.brandTint,
                  side: BorderSide(
                      color: terpilih ? AppColors.brand : AppColors.line),
                  onPressed: () => _pakaiAlamat(a),
                );
              },
            ),
          ),
          const SizedBox(height: 10),
        ],
        TextField(
          controller: _address,
          maxLines: 2,
          // Rebuild kecil agar tawaran "simpan ke profil" muncul/hilang tepat
          // saat alamat berubah — tanpa perlu menekan Lanjut dulu.
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
              labelText: 'Alamat lengkap',
              hintText: 'Nama jalan, nomor rumah, kelurahan, kota'),
        ),
        // Tawaran menyimpan alamat baru ke profil. Sengaja MUNCUL SAJA saat
        // alamatnya berbeda, dan tidak pernah menyimpan sendiri: alamat pesanan
        // bisa berbeda dari rumah (mis. memesan untuk kantor/orang tua).
        if (_bisaSimpanAlamatKeProfil)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              const Icon(Icons.bookmark_add_outlined,
                  size: 16, color: AppColors.brandDeep),
              const SizedBox(width: 6),
              const Expanded(
                child: Text(
                  'Simpan alamat ini ke profil agar pesanan berikutnya terisi otomatis.',
                  style: TextStyle(
                      fontSize: 11.5, height: 1.3, color: AppColors.inkSoft),
                ),
              ),
              TextButton(
                onPressed: _menyimpanAlamat ? null : _simpanAlamatKeProfil,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 36),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  visualDensity: VisualDensity.compact,
                ),
                child: _menyimpanAlamat
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Simpan',
                        style: TextStyle(
                            fontSize: 12.5, fontWeight: FontWeight.w800)),
              ),
            ]),
          ),
        // Pin lokasi (opsional): teknisi dapat titik + rute navigasi Google Maps.
        const SizedBox(height: 6),
        OutlinedButton.icon(
          onPressed: _pickPin,
          icon: Icon(
              _pinChosen
                  ? Icons.location_on_rounded
                  : Icons.add_location_alt_rounded,
              size: 18,
              color: _pinChosen ? AppColors.mint : null),
          label: Text(_pinChosen
              ? 'Titik lokasi terpasang ✓ (ketuk untuk ubah)'
              : 'Pasang titik lokasi (opsional)'),
        ),
        // Hapus pin: muncul hanya bila pin terpasang — pelanggan bisa
        // membatalkan titik lokasi (booking tetap sah tanpa pin).
        if (_pinChosen)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: TextButton.icon(
              onPressed: () => setState(() => _pin = null),
              icon: const Icon(Icons.delete_outline_rounded,
                  size: 16, color: AppColors.coral),
              label: const Text('Hapus pin lokasi',
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.coral)),
            ),
          ),
        const SizedBox(height: 12),
        Row(children: [
          // Tanggal cukup 2 bagian: isinya pendek ("Pilih" / "24 Okt").
          // Jam butuh 3 bagian — label "Jam kedatangan" dan nilai
          // "08:00-10:00" terpotong ("Jam keda…") saat keduanya 3:2.
          Expanded(
            flex: 2,
            child: InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: _ScheduleChip(
                icon: Icons.event_outlined,
                label: 'Tanggal',
                value: _date == null ? 'Pilih' : formatDateShort(_date!),
                filled: _date != null,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 3,
            child: DropdownButtonFormField<String>(
              // Key berubah bersama tanggal/slot: initialValue hanya dibaca
              // saat FormField dibuat, jadi tanpa ini pilihan jam lama bisa
              // tetap tampil walau slotnya sudah tidak tersedia.
              key: ValueKey('jam-${_date ?? '-'}-${_availableTimes.join(',')}'),
              initialValue: _time != null && _availableTimes.contains(_time)
                  ? _time
                  : null,
              decoration: const InputDecoration(labelText: 'Jam kedatangan'),
              items: _availableTimes.map((t) {
                final u = _slotUsage[t];
                return DropdownMenuItem(
                  value: t,
                  child: Text(u == null ? t : '$t · sisa ${u.remaining}'),
                );
              }).toList(),
              onChanged: (v) => setState(() => _time = v),
            ),
          ),
        ]),
        // Semua slot hari ini sudah lewat → beri tahu sebabnya, jangan
        // biarkan dropdown kosong tanpa penjelasan.
        if (_date != null && !_memuatSlot && _availableTimes.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _semuaSlotPenuh
                  ? 'Semua slot pada tanggal ini penuh. Pilih tanggal lain.'
                  : 'Slot hari ini sudah lewat. Pilih tanggal berikutnya.',
              style: const TextStyle(fontSize: 12.5, color: AppColors.coral),
            ),
          ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.amberTint,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(children: [
            Icon(Icons.schedule_rounded, size: 18, color: AppColors.amber),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Teknisi datang 08:00–17:00. Kamu akan dihubungi sebelum teknisi berangkat.',
                style: TextStyle(fontSize: 12.5, color: AppColors.navy),
              ),
            ),
          ]),
        ),
      ]);
    }
    // STEP 2 — pembayaran & ringkasan
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Metode pembayaran',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      const SizedBox(height: 8),
      if (_payment == 'transfer') ...[
        _TransferAccountBox(account: _transferAccount),
        const SizedBox(height: 8),
      ],
      RadioGroup<String>(
        groupValue: _payment,
        onChanged: (v) => setState(() => _payment = v!),
        child: Column(
            children: paymentMethods
                .map((m) => _PaymentCard(
                      value: m.$1,
                      title: m.$2,
                      subtitle: m.$3,
                      groupValue: _payment,
                      onChanged: (v) => setState(() => _payment = v),
                    ))
                .toList()),
      ),
      const SizedBox(height: 14),
      OutlinedButton.icon(
        onPressed: _pickVoucher,
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        icon: const Icon(Icons.local_activity_outlined, size: 18),
        label: Text(_voucher == null
            ? 'Pakai voucher (opsional)'
            : 'Voucher ${_voucher!.code} ✓'),
      ),
      const SizedBox(height: 16),
      _SummaryCard(
        serviceName: _namaRingkasan,
        lines: _barisRingkasan,
        subtotal: formatRupiah(_harga.subtotal),
        appFee: formatRupiah(_harga.appFee),
        discount: _harga.discount > 0 ? formatRupiah(_harga.discount) : null,
        total: formatRupiah(_total),
        qtyLabel: _kendaraan ? 'Jumlah kendaraan' : 'Jumlah unit',
        unitWord: _kendaraan ? 'kendaraan' : 'unit',
      ),
    ]);
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
      helpText: 'Pilih tanggal kedatangan',
    );
    if (picked != null) {
      final tanggal = picked.toIso8601String().substring(0, 10);
      setState(() {
        _date = tanggal;
        // Jam lama dikosongkan saat tanggal berubah: kuota tanggal baru belum
        // dibaca, jadi jangan mempertahankan pilihan yang belum tentu ada.
        _time = null;
        _slotUsage = const {};
      });
      await _muatSlot(tanggal);
      if (!mounted) return;
      if (_availableTimes.isEmpty) {
        showSnack(
            context,
            _semuaSlotPenuh
                ? 'Semua slot pada tanggal ini penuh. Pilih tanggal lain.'
                : 'Slot hari ini sudah lewat. Pilih tanggal berikutnya.',
            error: true);
      }
    }
  }
}

/// Kotak info rekening transfer resmi (dari app_settings, diisi admin).
/// Ditempel di wizard sebelum daftar metode saat "Transfer Bank" dipilih.
class _TransferAccountBox extends StatelessWidget {
  final Map<String, String>? account;
  const _TransferAccountBox({required this.account});

  @override
  Widget build(BuildContext context) {
    final a = account;
    final filled = a != null && a['name']!.isNotEmpty;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.brandTint,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.account_balance_rounded,
            size: 18, color: AppColors.brandDeep),
        const SizedBox(width: 8),
        Expanded(
          child: filled
              ? Text.rich(
                  TextSpan(
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.navy),
                      children: [
                        TextSpan(text: 'Transfer ke ${a['bank']} '),
                        TextSpan(
                            text: a['number'],
                            style:
                                const TextStyle(fontWeight: FontWeight.w800)),
                        TextSpan(text: ' a.n. ${a['name']}'),
                      ]),
                )
              : const Text(
                  'Transfer manual ke rekening resmi Fixify — bukti transfer dikirim setelah pesanan dibuat.',
                  style: TextStyle(fontSize: 12.5, color: AppColors.navy)),
        ),
      ]),
    );
  }
}

class Uint8ListWrap {
  final Uint8List bytes;
  Uint8ListWrap(this.bytes);
}

/// Kartu varian layanan (mis. ukuran PK AC): selectable, harga menonjol,
/// border berwarna saat aktif dengan ikon centang.
class _OptionCard extends StatelessWidget {
  final String label;
  final String? duration;
  final String price;
  final bool selected;
  final VoidCallback onTap;
  const _OptionCard({
    required this.label,
    required this.price,
    required this.selected,
    required this.onTap,
    this.duration,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: selected ? AppColors.brandTint : Colors.white,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: selected ? AppColors.brand : AppColors.line,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected ? AppColors.brand : Colors.white,
                  border: Border.all(
                    color: selected ? AppColors.brand : AppColors.line,
                    width: 2,
                  ),
                ),
                child: selected
                    ? const Icon(Icons.check_rounded,
                        size: 14, color: Colors.white)
                    : null,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label,
                          style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 14.5,
                              color: selected
                                  ? AppColors.brandDeep
                                  : AppColors.navy)),
                      if (duration != null)
                        Text(duration!,
                            style: const TextStyle(
                                fontSize: 12, color: AppColors.inkSoft)),
                    ]),
              ),
              Text(price,
                  style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14.5,
                      color: selected ? AppColors.brand : AppColors.navy)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Satu baris varian AC dengan tombol −/+. Nilai 0 = varian tidak dipesan.
class _VariantRow extends StatelessWidget {
  final String label;
  final String? duration;
  final int unitPrice;
  final int value;
  final bool canAdd;
  final ValueChanged<int> onChanged;
  const _VariantRow({
    required this.label,
    required this.unitPrice,
    required this.value,
    required this.canAdd,
    required this.onChanged,
    this.duration,
  });

  @override
  Widget build(BuildContext context) {
    final aktif = value > 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
        decoration: BoxDecoration(
          color: aktif ? AppColors.brandTint : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: aktif ? AppColors.brand : AppColors.line,
            width: aktif ? 2 : 1,
          ),
        ),
        child: Row(children: [
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label,
                  style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14.5,
                      color: aktif ? AppColors.brandDeep : AppColors.navy)),
              Text(
                  duration == null
                      ? '${formatRupiah(unitPrice)} / unit'
                      : '${formatRupiah(unitPrice)} / unit · $duration',
                  style: const TextStyle(
                      fontSize: 11.5, color: AppColors.inkSoft)),
              if (aktif)
                Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Text(
                    '$value unit × ${formatRupiah(unitPrice)} = ${formatRupiah(unitPrice * value)}',
                    style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.brandDeep),
                  ),
                ),
            ]),
          ),
          _QtyButton(
            icon: Icons.remove_rounded,
            tooltip: 'Kurangi $label',
            onTap: value > 0 ? () => onChanged(value - 1) : null,
          ),
          SizedBox(
            width: 40,
            child: Semantics(
              label: 'Jumlah $label',
              value: '$value unit',
              child: ExcludeSemantics(
                child: Text(
                  '$value',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 17,
                      color: AppColors.brandDeep),
                ),
              ),
            ),
          ),
          _QtyButton(
            icon: Icons.add_rounded,
            tooltip: 'Tambah $label',
            onTap: canAdd ? () => onChanged(value + 1) : null,
          ),
        ]),
      ),
    );
  }
}

/// Pemilih jumlah unit untuk layanan per unit (kategori AC).
///
/// Subtotal ditampilkan langsung di sini supaya pelanggan melihat akibat
/// perubahan jumlah sebelum sampai ke langkah pembayaran.
class _QuantityPicker extends StatelessWidget {
  final int value;
  final int unitPrice;
  final int subtotal;
  final ValueChanged<int> onChanged;

  /// Judul & satuan bisa diganti: AC memakai "unit", layanan kendaraan
  /// memakai "kendaraan". Bawaan = AC supaya pemakai lama tidak berubah.
  final String title;
  final String subtitle;
  final IconData icon;
  final String unitWord;
  const _QuantityPicker({
    required this.value,
    required this.unitPrice,
    required this.subtotal,
    required this.onChanged,
    this.title = 'Jumlah unit AC',
    this.subtitle = 'Harga dihitung per unit',
    this.icon = Icons.ac_unit_rounded,
    this.unitWord = 'unit',
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.brandTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, size: 20, color: AppColors.brandDeep),
          const SizedBox(width: 8),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title,
                  style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14.5,
                      color: AppColors.navy)),
              Text(subtitle,
                  style: const TextStyle(
                      fontSize: 11.5, color: AppColors.inkSoft)),
            ]),
          ),
          _QtyButton(
            icon: Icons.remove_rounded,
            tooltip: 'Kurangi $unitWord',
            onTap: value > 1 ? () => onChanged(value - 1) : null,
          ),
          SizedBox(
            width: 46,
            child: Semantics(
              label: title,
              value: '$value $unitWord',
              child: ExcludeSemantics(
                child: Text(
                  '$value',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 18,
                      color: AppColors.brandDeep),
                ),
              ),
            ),
          ),
          _QtyButton(
            icon: Icons.add_rounded,
            tooltip: 'Tambah $unitWord',
            onTap:
                value < maxServiceQuantity ? () => onChanged(value + 1) : null,
          ),
        ]),
        const SizedBox(height: 8),
        Text(
          '$value $unitWord × ${formatRupiah(unitPrice)} = ${formatRupiah(subtotal)}',
          style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: AppColors.brandDeep),
        ),
      ]),
    );
  }
}

/// Tombol kecil − / + pemilih jumlah unit. Material+InkWell (bukan
/// FilledButton) agar tidak terkena minimumSize tema yang tak terbatas
/// di dalam Row — pola yang sama dengan tombol lain di wizard ini.
class _QtyButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  const _QtyButton({required this.icon, required this.tooltip, this.onTap});

  @override
  Widget build(BuildContext context) {
    final aktif = onTap != null;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: aktif ? Colors.white : AppColors.paper,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border:
                  Border.all(color: aktif ? AppColors.brand : AppColors.line),
            ),
            child: Icon(icon,
                size: 18,
                color: aktif ? AppColors.brandDeep : AppColors.inkSoft),
          ),
        ),
      ),
    );
  }
}

/// Chip jadwal (tanggal) bergaya kartu: ikon + label + nilai terisi.
class _ScheduleChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool filled;
  const _ScheduleChip({
    required this.icon,
    required this.label,
    required this.value,
    required this.filled,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: filled ? AppColors.brandTint : Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
            color: filled ? AppColors.brand : AppColors.line,
            width: filled ? 2 : 1.5),
      ),
      child: Row(children: [
        Icon(icon,
            size: 20, color: filled ? AppColors.brand : AppColors.inkSoft),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(
                        fontSize: 10.5, color: AppColors.inkSoft)),
                Text(value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color:
                            filled ? AppColors.brandDeep : AppColors.inkSoft)),
              ]),
        ),
      ]),
    );
  }
}

/// Kartu metode pembayaran: selectable dengan radio custom + ikon per metode.
class _PaymentCard extends StatelessWidget {
  final String value;
  final String title;
  final String subtitle;
  final String groupValue;
  final ValueChanged<String> onChanged;
  const _PaymentCard({
    required this.value,
    required this.title,
    required this.subtitle,
    required this.groupValue,
    required this.onChanged,
  });

  IconData get _icon => switch (value) {
        'transfer' => Icons.account_balance_rounded,
        _ => Icons.payments_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final selected = groupValue == value;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: selected ? AppColors.brandTint : Colors.white,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: () => onChanged(value),
          borderRadius: BorderRadius.circular(14),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: selected ? AppColors.brand : AppColors.line,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: selected ? AppColors.brand : AppColors.brandTint,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(_icon,
                    size: 20,
                    color: selected ? Colors.white : AppColors.brandDeep),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                              color: selected
                                  ? AppColors.brandDeep
                                  : AppColors.navy)),
                      Text(subtitle,
                          style: const TextStyle(
                              fontSize: 11.5, color: AppColors.inkSoft)),
                    ]),
              ),
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                size: 22,
                color: selected ? AppColors.brand : AppColors.line,
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Kartu ringkasan pembayaran: rincian + total menonjol di kartu gradien.
/// Dua isian (panjang & lebar) satu bidang ukur. Controller dimiliki wizard
/// supaya isian tidak hilang saat langkah berpindah.
class _BidangUkur {
  final panjang = TextEditingController();
  final lebar = TextEditingController();

  void dispose() {
    panjang.dispose();
    lebar.dispose();
  }
}

class _SummaryCard extends StatelessWidget {
  final String serviceName;
  final List<
          ({String label, int qty, int unitPrice, int lineTotal, double? area})>
      lines;
  final String subtotal;
  final String appFee;
  final String? discount;
  final String total;

  /// Layanan kendaraan memakai satuan "kendaraan", layanan lain "unit".
  final String qtyLabel;
  final String unitWord;
  const _SummaryCard({
    required this.serviceName,
    required this.lines,
    required this.subtotal,
    required this.appFee,
    required this.total,
    this.discount,
    this.qtyLabel = 'Jumlah unit',
    this.unitWord = 'unit',
  });

  bool get _perBaris => lines.length > 1;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
        boxShadow: [
          BoxShadow(
              color: AppColors.navy.withValues(alpha: 0.06),
              blurRadius: 12,
              offset: const Offset(0, 4))
        ],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Ringkasan pesanan',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        const SizedBox(height: 10),
        _row('Layanan', serviceName),
        // Beberapa varian → satu baris rincian per varian. Satu baris saja
        // mempertahankan tampilan lama (harga satuan + jumlah unit); untuk
        // layanan per m² barisnya ditulis sebagai luas × harga per m².
        if (_perBaris) ...[
          for (final l in lines)
            _row(
                l.area != null
                    ? '${l.label} (${formatArea(l.area)})'
                    : '${l.label} ×${l.qty}',
                formatRupiah(l.lineTotal)),
          _row('Subtotal', subtotal),
        ] else ...[
          if (lines.isNotEmpty && lines.first.area != null) ...[
            _row('Harga per m²', formatRupiah(lines.first.unitPrice)),
            _row('Luas area', formatArea(lines.first.area)),
            _row('Subtotal', subtotal),
          ] else ...[
            if (lines.isNotEmpty && lines.first.qty > 1) ...[
              _row('Harga satuan', formatRupiah(lines.first.unitPrice)),
              _row(qtyLabel, '${lines.first.qty} $unitWord'),
            ],
            _row(lines.isNotEmpty && lines.first.qty > 1 ? 'Subtotal' : 'Harga',
                subtotal),
          ],
        ],
        _row('Biaya aplikasi', appFee),
        if (discount != null)
          _row('Diskon voucher', '− $discount', color: AppColors.mint),
        const Divider(height: 20),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('Total',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.brand,
              borderRadius: BorderRadius.circular(10),
              boxShadow: [
                BoxShadow(
                    color: AppColors.brand.withValues(alpha: 0.35),
                    blurRadius: 8,
                    offset: const Offset(0, 3))
              ],
            ),
            child: Text(total,
                style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    color: Colors.white)),
          ),
        ]),
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(hargaJasaNote,
              style: TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
        ),
      ]),
    );
  }

  Widget _row(String k, String v, {Color? color}) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Flexible(
            child: Text(k,
                style: const TextStyle(fontSize: 13, color: AppColors.inkSoft)),
          ),
          const SizedBox(width: 12),
          Text(v,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: color ?? AppColors.navy)),
        ]),
      );
}

/// Indikator langkah stepper kustom: tiga lingkaran bernomor yang
/// terhubung garis. Langkah aktif berwarna brand, selesai = centang.
/// Bisa ditap untuk lompat antar langkah.
class _StepIndicator extends StatelessWidget {
  final int current;
  final ValueChanged<int> onStepTapped;
  const _StepIndicator({required this.current, required this.onStepTapped});

  static const _labels = ['Layanan', 'Jadwal & Alamat', 'Pembayaran'];

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(3, (i) {
        final done = i < current;
        final active = i == current;
        final color = done || active ? AppColors.brand : AppColors.line;
        return Expanded(
          child: Column(children: [
            Row(children: [
              if (i > 0)
                Expanded(
                    child: Container(
                        height: 2,
                        color:
                            i <= current ? AppColors.brand : AppColors.line)),
              InkWell(
                onTap: () => onStepTapped(i),
                borderRadius: BorderRadius.circular(14),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: done || active ? AppColors.brand : Colors.white,
                    border: Border.all(color: color, width: 2),
                  ),
                  child: Icon(
                    done ? Icons.check_rounded : Icons.radio_button_unchecked,
                    size: 16,
                    color: done || active ? Colors.white : AppColors.inkSoft,
                  ),
                ),
              ),
              if (i < 2)
                Expanded(
                    child: Container(
                        height: 2,
                        color: i < current ? AppColors.brand : AppColors.line)),
            ]),
            const SizedBox(height: 6),
            Text(
              _labels[i],
              style: TextStyle(
                fontSize: 11,
                fontWeight: active ? FontWeight.w800 : FontWeight.w500,
                color: active ? AppColors.brandDeep : AppColors.inkSoft,
              ),
            ),
          ]),
        );
      }),
    );
  }
}
