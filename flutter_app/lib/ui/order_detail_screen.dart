import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../trip_share.dart';
import 'chat_screen.dart';
import 'common.dart';
import 'mini_pin_map.dart';
import 'receipt_screen.dart';
import 'report_screen.dart';
import 'review_sheet.dart';

/// Teks privasi yang WAJIB menemani posisi teknisi di layar pelanggan: ini
/// bukan riwayat dan tidak berlangsung selamanya. Ditulis sekali supaya kedua
/// keadaan (terlihat / tidak terlihat) menyebut aturan yang sama persis.
const _catatanPrivasi = 'Posisi hanya tampil selama teknisi dalam perjalanan, '
    'tidak disimpan sebagai riwayat, dan berhenti sendiri setelah 90 menit.';

class OrderDetailScreen extends StatefulWidget {
  final Booking booking;

  /// Seam uji: uid pengguna yang sedang login (default [Api.currentUserId]).
  /// Dipakai memutuskan siapa PEMILIK pesanan — lihat [Booking.isOwnedBy].
  final String? Function()? currentUserId;

  /// Seam uji: jarak/kontak teknisi dan masa garansi. Keduanya datang dari RPC
  /// (bukan dari baris pesanan), jadi tanpa seam ini kartu teknisi & kartu
  /// garansi tidak pernah bisa diuji tanpa jaringan. `null` (produksi) =
  /// ambil dari server.
  final BookingTechInfo? techInfoUji;
  final BookingWarrantyInfo? warrantyInfoUji;

  /// Seam uji sisi PELANGGAN: pembacaan posisi teknisi untuk pesanan ini.
  final Future<BookingTechPosition> Function()? positionUji;

  /// Seam uji sisi TEKNISI: alur berbagi posisi (Api + GPS + notifikasi).
  /// Diteruskan ke [TripShareSession] saat perjalanan dimulai.
  final TripShareHooks? tripShareUji;

  const OrderDetailScreen({
    super.key,
    required this.booking,
    this.currentUserId,
    this.techInfoUji,
    this.warrantyInfoUji,
    this.positionUji,
    this.tripShareUji,
  });

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late Booking _b;

  // Realtime: status pesanan ini berubah dari luar (mis. admin menyetujui
  // bukti bayar, teknisi mulai/selesai) → segarkan otomatis.
  StreamSubscription<BookingUpdate>? _tickSub;

  /// Jarak + kontak teknisi, dan masa garansi. Keduanya RPC terpisah (bukan
  /// ikut dalam baris pesanan) supaya daftar pesanan tetap ringan; keduanya
  /// fail-soft — migrasi belum dijalankan berarti kartunya tidak tampil.
  BookingTechInfo? _tech;
  BookingWarrantyInfo? _garansi;

  /// Sedang menjalankan aksi yang mengubah pesanan (batalkan / ubah jadwal /
  /// klaim garansi) — mencegah dua ketukan cepat memicu dua permintaan.
  bool _aksiSibuk = false;

  /// Posisi teknisi untuk pelanggan pemilik pesanan ("teknisi menuju lokasi").
  BookingTechPosition _posisi = BookingTechPosition.kosong;
  Timer? _posisiTimer;

  /// Sesi berbagi milik APLIKASI (bukan layar ini) — itulah sebabnya posisi
  /// tetap diperbarui setelah teknisi menutup layar detail. Di sini kita hanya
  /// memantau keadaannya untuk menggambar tombol & jarak.
  final _sesi = TripShareSession.instance;

  /// Sedang memproses tombol berbagi (mulai/hentikan) — mencegah dua ketukan.
  bool _bagikanSibuk = false;

  /// Jeda penyegaran posisi teknisi di layar pelanggan. 15 detik: rapat untuk
  /// terasa "live" saat teknisi mengendarai motor (≈200 m antar pembaruan),
  /// tetapi tetap satu RPC kecil per layar.
  static const _intervalPosisi = Duration(seconds: 15);

  String? get _uidSaya => (widget.currentUserId ?? () => Api.currentUserId)();

  @override
  void initState() {
    super.initState();
    _b = widget.booking;
    _tickSub = bookingUpdatesTick.stream.listen((u) {
      if (u.id == widget.booking.id) _reload();
    });
    unawaited(_muatInfoTambahan());
    // Sesi berbagi bisa berhenti SENDIRI (tiba / ditolak server) walau layar ini
    // tidak sedang ditekan — teknisi harus tahu, jadi sebabnya ditampilkan.
    _sesi.aktif.addListener(_segarkan);
    _sesi.jarakTerakhir.addListener(_segarkan);
    _sesi.berhentiSebab.addListener(_tampilkanSebabBerhenti);
    // Pelacakan "teknisi menuju lokasi": hanya untuk PEMILIK pesanan. Teknisi
    // tidak melacak dirinya sendiri, dan server menolak permintaan dari bukan
    // pemilik — jadi jangan buang kuota jaringan untuk itu.
    if (_b.isOwnedBy(_uidSaya)) {
      unawaited(_muatPosisi());
      _posisiTimer =
          Timer.periodic(_intervalPosisi, (_) => unawaited(_muatPosisi()));
    }
    // Detail pesanan terbuka — perubahan item ini langsung tampak, reset badge.
    unseenBookingUpdates.value = 0;
  }

  @override
  void dispose() {
    unawaited(_tickSub?.cancel());
    // Timer pelacakan pelanggan: tanpa ini, layar yang ditutup tetap memanggil
    // server setiap 15 detik dan test pelacakan kebocoran akan menangkapnya.
    _posisiTimer?.cancel();
    // Pendengar sesi WAJIB dilepas: sesinya sendiri hidup lebih lama daripada
    // layar ini (itu tujuannya), jadi ia tidak boleh memegang layar yang sudah mati.
    _sesi.aktif.removeListener(_segarkan);
    _sesi.jarakTerakhir.removeListener(_segarkan);
    _sesi.berhentiSebab.removeListener(_tampilkanSebabBerhenti);
    super.dispose();
  }

  void _segarkan() {
    if (mounted) setState(() {});
  }

  /// Tampilkan sekali sebab sesi berhenti sendiri, lalu bersihkan supaya tidak
  /// terulang setiap rebuild.
  void _tampilkanSebabBerhenti() {
    final sebab = _sesi.sebabBerhenti;
    if (sebab == null || !mounted) return;
    _sesi.berhentiSebab.value = '';
    showSnack(context, sebab, error: true);
  }

  /// Segarkan data pesanan setelah kembali dari chat (mis. ada status baru).
  /// Pelanggan memakai daftar pesanan sendiri; teknisi memakai daftar tugas.
  Future<void> _reload() async {
    try {
      final rows = await Api.fetchMyBookings();
      Booking? fresh = rows.where((r) => r.id == widget.booking.id).firstOrNull;
      if (fresh == null) {
        final jobs = await Api.fetchAssignedJobs();
        fresh = jobs.where((r) => r.id == widget.booking.id).firstOrNull;
      }
      final f = fresh;
      if (f != null && mounted) setState(() => _b = f);
      // Jarak teknisi berubah seiring waktu — disegarkan bersama pesanannya,
      // karena sesudah dibatalkan/diubah jadwal kartunya juga ikut berubah.
      unawaited(_muatInfoTambahan());
    } catch (_) {
      // diam: reload adalah best-effort
    }
  }

  /// Ambil posisi teknisi (sisi pelanggan). Server yang memutuskan `visible` —
  /// lihat supabase/migrate-technician-trip-share.sql.
  Future<void> _muatPosisi() async {
    final uji = widget.positionUji;
    final hasil = uji != null
        ? await uji()
        : await Api.bookingTechnicianPosition(_b.id);
    if (!mounted) return;
    setState(() => _posisi = hasil);
  }

  /// Teknisi menekan "Berangkat".
  ///
  /// Pengiriman berkala diserahkan ke [TripShareSession] (singleton APLIKASI),
  /// bukan ke layar ini — supaya perjalanan tetap dibagikan walau teknisi
  /// langsung menutup layar detail dan menyetir. Layar tinggal mendengarkan
  /// keadaannya untuk menggambar tombol, jarak, dan sebab berhentinya.
  Future<void> _mulaiBerbagi() async {
    if (_bagikanSibuk) return;
    setState(() => _bagikanSibuk = true);
    final r = await _sesi.mulai(_b.id, hooks: widget.tripShareUji);
    if (!mounted) return;
    setState(() => _bagikanSibuk = false);
    if (!r.ok) {
      showSnack(context, r.error ?? 'Gagal memulai berbagi lokasi.', error: true);
      return;
    }
    showSnack(
      context,
      'Pelanggan bisa melihat posisimu sampai kamu tiba atau menekan berhenti.',
    );
  }

  /// Teknisi menekan "Saya sudah tiba": hentikan berbagi — server MENGHAPUS
  /// barisnya, jadi tidak ada riwayat posisi yang tertinggal.
  Future<void> _hentikanBerbagi() async {
    if (_bagikanSibuk) return;
    setState(() => _bagikanSibuk = true);
    final r = await _sesi.berhenti();
    if (!mounted) return;
    setState(() => _bagikanSibuk = false);
    showSnack(
      context,
      r.ok
          ? 'Berbagi lokasi dihentikan — posisimu tidak lagi terlihat pelanggan.'
          : (r.error ?? 'Gagal menghentikan berbagi lokasi.'),
      error: !r.ok,
    );
  }

  /// Muat info yang TIDAK ikut dalam baris pesanan: jarak + kontak teknisi dan
  /// masa garansi. Aman dipanggil kapan pun — [Api] mengembalikan objek kosong
  /// bila migrasinya belum dijalankan atau jaringan gagal, sehingga layar ini
  /// tidak pernah menampilkan galat hanya karena info tambahan tak tersedia.
  Future<void> _muatInfoTambahan() async {
    if (widget.techInfoUji != null || widget.warrantyInfoUji != null) {
      // Seam uji: nilai sudah disuntikkan. Ditulis langsung, bukan lewat
      // setState, karena jalur ini berjalan sinkron dari initState (sebelum
      // build pertama) — setState di sana tidak ada gunanya dan berisiko.
      _tech = widget.techInfoUji ?? _tech;
      _garansi = widget.warrantyInfoUji ?? _garansi;
      return;
    }
    final hasil = await Future.wait([
      Api.bookingTechnicianInfo(_b.id),
      Api.bookingWarrantyInfo(_b.id),
    ]);
    if (!mounted) return;
    setState(() {
      _tech = hasil[0] as BookingTechInfo;
      _garansi = hasil[1] as BookingWarrantyInfo;
    });
  }

  /// Syarat tombol "Batalkan"/"Ubah Jadwal" — CERMIN dari aturan RPC di server
  /// (supabase/migrate-customer-self-service.sql). Menampilkan tombol yang pasti
  /// ditolak server hanya membuang waktu pelanggan; server tetap memeriksa ulang.
  bool get _bolehUbahJadwal => bolehBatalkanAtauUbahJadwal(
        status: _b.status,
        paymentProofUrl: _b.paymentProofUrl,
        paymentRejected: _b.paymentRejected,
        sekarang: DateTime.now(),
        bookingDate: _b.bookingDate,
        bookingTime: _b.bookingTime,
      );

  /// Dialog alasan bersama untuk pembatalan & klaim garansi.
  Future<String?> _tanyaAlasan({
    required String judul,
    required String keterangan,
    required String hint,
    required String labelKirim,
    Color? warnaKirim,
  }) {
    return showDialog<String>(
      context: context,
      builder: (_) => _AlasanDialog(
        judul: judul,
        keterangan: keterangan,
        hint: hint,
        labelKirim: labelKirim,
        warnaKirim: warnaKirim,
      ),
    );
  }

  /// Pelanggan membatalkan pesanannya sendiri.
  Future<void> _batalkanPesanan() async {
    if (_aksiSibuk) return;
    final alasan = await _tanyaAlasan(
      judul: 'Batalkan pesanan?',
      keterangan: 'Pesanan akan dibatalkan dan teknisi yang sudah ditugaskan '
          'diberi tahu supaya tidak datang ke lokasi.',
      hint: 'mis. rencana berubah, sudah pakai jasa lain',
      labelKirim: 'Ya, batalkan',
      warnaKirim: AppColors.coral,
    );
    if (alasan == null || !mounted) return;

    setState(() => _aksiSibuk = true);
    final r = await Api.cancelBooking(_b.id, alasan);
    if (!mounted) return;
    setState(() => _aksiSibuk = false);
    if (!r.ok) {
      showSnack(context, r.error ?? 'Pesanan gagal dibatalkan.', error: true);
      return;
    }
    showSnack(context, 'Pesanan dibatalkan.');
    await _reload();
  }

  /// Pelanggan mengubah jadwalnya sendiri (maks [maxReschedule] kali — server).
  Future<void> _ubahJadwal() async {
    if (_aksiSibuk) return;
    final baru = await showModalBottomSheet<({String date, String time})>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _RescheduleSheet(
        currentDate: _b.bookingDate,
        currentTime: _b.bookingTime,
        sekarang: DateTime.now(),
      ),
    );
    if (baru == null || !mounted) return;

    setState(() => _aksiSibuk = true);
    final r = await Api.rescheduleBooking(_b.id, baru.date, baru.time);
    if (!mounted) return;
    setState(() => _aksiSibuk = false);
    if (!r.ok) {
      showSnack(context, r.error ?? 'Jadwal gagal diubah.', error: true);
      return;
    }
    showSnack(context, 'Jadwal diubah ke ${formatDateId(baru.date)} · ${baru.time}.');
    await _reload();
  }

  /// Ajukan klaim garansi untuk pesanan yang sudah selesai dan masih bergaransi.
  Future<void> _ajukanGaransi() async {
    if (_aksiSibuk) return;
    final alasan = await _tanyaAlasan(
      judul: 'Ajukan klaim garansi',
      keterangan: 'Ceritakan apa yang masih bermasalah. Admin meninjau dulu; bila '
          'disetujui, teknisi yang sama datang lagi tanpa biaya.',
      hint: 'mis. AC menetes lagi setelah dua hari',
      labelKirim: 'Kirim klaim',
    );
    if (alasan == null || !mounted) return;

    setState(() => _aksiSibuk = true);
    final r = await Api.createWarrantyClaim(_b.id, alasan);
    if (!mounted) return;
    setState(() => _aksiSibuk = false);
    if (!r.ok) {
      showSnack(context, r.error ?? 'Klaim garansi gagal diajukan.', error: true);
      return;
    }
    showSnack(context, 'Klaim garansi terkirim. Admin akan meninjau.');
    await _muatInfoTambahan();
  }

  /// Buka aplikasi telepon / WhatsApp ke nomor teknisi.
  ///
  /// Nomor dinormalkan lebih dulu ([normalkanNomorId]): wa.me menolak awalan
  /// '0', jadi '0812…' harus menjadi '62812…' atau tombolnya tampak rusak.
  Future<void> _hubungi(String jenis, String nomor) async {
    final n = normalkanNomorId(nomor);
    if (n == null) {
      showSnack(context, 'Nomor teknisi belum tersedia.', error: true);
      return;
    }
    final url = jenis == 'wa' ? 'https://wa.me/$n' : 'tel:+$n';
    try {
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        showSnack(context, 'Tidak ada aplikasi yang bisa membuka kontak ini.', error: true);
      }
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal membuka kontak.');
    }
  }

  /// Kartu teknisi: jarak + cara menghubungi.
  ///
  /// Sengaja TIDAK ada peta posisi teknisi: server tidak pernah mengirim
  /// koordinat teknisi (lihat supabase/migrate-technician-gps.sql) — yang
  /// tersedia hanya jarak dan umur posisinya, dan itulah yang ditampilkan.
  Widget _kartuTeknisi(Booking b, BookingTechInfo t) {
    final nama = t.name ?? b.technicianName ?? 'Teknisi';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _cardDeco(),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          TechAvatarChip(url: t.avatarUrl ?? b.technicianAvatar, name: nama, size: 34),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(nama,
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, color: AppColors.navy, fontSize: 14)),
              Text(t.ringkasanJarak,
                  style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
            ]),
          ),
        ]),
        const SizedBox(height: 12),
        if (t.bolehDihubungi)
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _hubungi('tel', t.phone!),
                icon: const Icon(Icons.call_rounded, size: 18),
                label: const Text('Telepon'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _hubungi('wa', t.phone!),
                icon: const Icon(Icons.chat_rounded, size: 18),
                label: const Text('WhatsApp'),
              ),
            ),
          ])
        else
          // Kartu ini hanya muncul selama pesanan AKTIF, jadi cabang ini bukan
          // "pesanan sudah selesai" melainkan teknisi yang memang belum mengisi
          // nomor telepon di profilnya — jangan salah menyebut sebabnya.
          const Text('Teknisi ini belum mencantumkan nomor telepon — pakai chat.',
              style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
      ]),
    );
  }

  /// Kartu garansi + tombol klaim (hanya untuk pelanggan pemilik pesanan).
  Widget _kartuGaransi(BookingWarrantyInfo g) {
    final warna = g.disetujui
        ? AppColors.mint
        : (g.ditolak || !g.eligible ? AppColors.inkSoft : AppColors.brandDeep);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _cardDeco(),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.verified_user_outlined, size: 18, color: AppColors.brandDeep),
          SizedBox(width: 8),
          Text('Garansi pekerjaan', style: TextStyle(fontWeight: FontWeight.w800)),
        ]),
        const SizedBox(height: 6),
        Text(g.ringkasan, style: TextStyle(fontSize: 13, color: warna)),
        if (g.claimReason != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Klaimmu: ${g.claimReason}',
                style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
          ),
        if (g.claimAdminNote != null)
          Text('Catatan admin: ${g.claimAdminNote}',
              style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
        if (g.eligible) ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _aksiSibuk ? null : _ajukanGaransi,
            icon: const Icon(Icons.build_circle_outlined, size: 18),
            label: Text(g.daysLeft > 0
                ? 'Ajukan klaim garansi (sisa ${g.daysLeft} hari)'
                : 'Ajukan klaim garansi'),
          ),
        ],
      ]),
    );
  }

  /// Teknisi memulai / menyelesaikan pekerjaan (RPC set_job_status).
  /// Selesai → konfirmasi dulu karena komisi dipotong dari saldo.
  Future<void> _setJobStatus(String status) async {
    if (status == 'completed') {
      final sure = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Tandai selesai?'),
          content: const Text(
              'Pastikan pekerjaan benar-benar sudah tuntas. Komisi platform akan dipotong dari saldo Anda dan pelanggan menerima struk otomatis.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ya, Selesai')),
          ],
        ),
      );
      if (sure != true || !mounted) return;
    }
    try {
      final r = await Api.setJobStatus(_b.id, status);
      if (!mounted) return;
      if (r.ok) {
        // Event realtime pantulan RPC sudah direfresh lewat tick di layar
        // ini — tahan snack ganda di MainShell.
        suppressBookingNotify(_b.code);
        if (status == 'completed' && r.commission != null) {
          _showCommissionDialog(r.commission!, r.balance);
        } else {
          showSnack(context,
              status == 'completed' ? 'Pekerjaan selesai. Terima kasih!' : 'Pekerjaan dimulai — semangat!');
        }
        await _reload();
      } else {
        showSnack(context, r.error ?? 'Gagal mengubah status.', error: true);
      }
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mengubah status.');
    }
  }

  /// Baris "Metode bayar" — dengan tombol edit bila pesanan masih
  /// menunggu pembayaran dan yang membuka adalah pemiliknya.
  Widget _methodRow({required bool canEdit}) {
    final label = paymentMethodLabel(_b.paymentMethod!) ?? _b.paymentMethod!;
    if (!canEdit) return InfoRow('Metode bayar', label);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(children: [
        const SizedBox(
            width: 120,
            child: Text('Metode bayar', style: TextStyle(color: AppColors.inkSoft, fontSize: 13))),
        Expanded(
          child: Text(label,
              style: const TextStyle(color: AppColors.ink, fontSize: 13, fontWeight: FontWeight.w600)),
        ),
        SizedBox(
          width: 30,
          height: 30,
          child: IconButton(
            padding: EdgeInsets.zero,
            iconSize: 18,
            tooltip: 'Ganti metode bayar',
            onPressed: _editPaymentMethod,
            icon: const Icon(Icons.edit_outlined, color: AppColors.brand),
          ),
        ),
      ]),
    );
  }

  /// Bottom sheet pilih metode bayar → simpan lewat Api.updatePaymentMethod.
  Future<void> _editPaymentMethod() async {
    String selected = _b.paymentMethod ?? 'transfer';
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('Ganti Metode Bayar', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 4),
              const Text('Hanya berlaku selama pesanan belum dibayar.',
                  style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
              const SizedBox(height: 8),
              // Baris pilihan manual (bukan RadioListTile) — API Radio/
              // groupValue deprecated di Flutter 3.32+ dan pola ini seragam
              // dengan pemilih rating bintang di layar ini.
              ...paymentMethods.map((m) {
                final chosen = selected == m.$1;
                return InkWell(
                  onTap: () => setSheet(() => selected = m.$1),
                  borderRadius: BorderRadius.circular(12),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                    child: Row(children: [
                      Icon(
                        chosen ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                        size: 20,
                        color: chosen ? AppColors.brand : AppColors.inkSoft,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(m.$2, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.navy)),
                          Text(m.$3, style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                        ]),
                      ),
                    ]),
                  ),
                );
              }),
              const SizedBox(height: 10),
              FilledButton(
                onPressed: selected == _b.paymentMethod ? null : () => Navigator.pop(ctx, true),
                child: const Text('Simpan metode'),
              ),
            ]),
          ),
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final r = await Api.updatePaymentMethod(_b.id, selected);
    if (!mounted) return;
    if (r.ok) {
      setState(() => _b = _copyWith(paymentMethod: selected));
      showSnack(context, 'Metode bayar diganti ke ${paymentMethodLabel(selected) ?? selected}.');
    } else {
      showSnack(context, r.error ?? 'Gagal mengubah metode bayar.', error: true);
    }
  }

  /// Ringkasan setelah pesanan selesai: komisi yang dipotong dari saldo
  /// dan sisa saldo terbaru (hasil RPC set_job_status).
  void _showCommissionDialog(num commission, num? balance) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.check_circle, color: Color(0xFF2C8F63), size: 40),
        title: const Text('Pekerjaan selesai!'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Komisi + biaya app terpotong:', style: TextStyle(fontSize: 13, color: AppColors.inkSoft)),
            const SizedBox(height: 4),
            Text(
              '- ${formatRupiah(commission)}',
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                color: Color(0xFFC0392B), // coral
              ),
            ),
            if (balance != null) ...[
              const SizedBox(height: 10),
              Text('Saldo Anda sekarang: ${formatRupiah(balance)}',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            ],
            const SizedBox(height: 10),
            const Text(
              'Setor saldo untuk menutup komisi di menu Saldo.',
              style: TextStyle(fontSize: 12, color: AppColors.inkSoft),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Tutup')),
        ],
      ),
    );
  }

  Future<void> _uploadProof() async {
    // Pengaman lapis kedua: hanya PEMILIK (pelanggan) yang boleh mengirim /
    // mengirim ulang bukti. Teknisi yang ditugaskan juga bisa membuka layar ini
    // (RLS "technician can view assigned bookings") — tombolnya sudah
    // disembunyikan di UI, tapi guard di sini menjaga jalur lain.
    if (!_b.isOwnedBy(Api.currentUserId)) {
      showSnack(context, 'Hanya pelanggan pemilik pesanan yang bisa mengirim bukti pembayaran.', error: true);
      return;
    }
    // sumber gambar: galeri atau kamera (foto struk/rekening bisa diambil langsung)
    final source = await chooseImageSource(context, title: 'Bukti Pembayaran');
    if (source == null || !mounted) return; // pengguna menutup pilihan
    final bytes = await Api.pickAndCompressImage(source: source);
    if (bytes == null) return;
    if (!mounted) return;
    final account = await Api.transferAccount();
    if (!mounted) return;
    // Sheet mengembalikan teks jumlah apa adanya; controller dimiliki State
    // sheet ([_PaymentAmountSheet]) supaya tidak dipakai setelah di-dispose
    // saat sheet masih beranimasi keluar.
    final rawAmount = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _PaymentAmountSheet(totalPrice: _b.totalPrice, account: account),
    );
    if (rawAmount == null) return; // pengguna menutup sheet
    final amountText = rawAmount.replaceAll(RegExp(r'[^0-9]'), '');
    try {
      final path = await Api.uploadToBucket(bucket: 'payment-proofs', folder: 'proofs', bytes: bytes);
      await Api.submitPaymentProof(
        bookingId: _b.id,
        path: path,
        amount: int.tryParse(amountText) ?? _b.totalPrice,
      );
      if (!mounted) return;
      showSnack(context, 'Bukti terkirim. Menunggu konfirmasi admin.');
      setState(() => _b = Booking(
            // refresh minimal: tandai bukti terkirim pada objek lokal
            id: _b.id, code: _b.code, serviceName: _b.serviceName, optionLabel: _b.optionLabel,
            subtotalPrice: _b.subtotalPrice, appFee: _b.appFee, discountAmount: _b.discountAmount,
            totalPrice: _b.totalPrice, status: _b.status, bookingDate: _b.bookingDate,
            bookingTime: _b.bookingTime, address: _b.address, notes: _b.notes,
            paymentMethod: _b.paymentMethod, paymentProofUrl: path,
            technicianId: _b.technicianId, technicianName: _b.technicianName, hasReview: _b.hasReview,
            createdAt: _b.createdAt, paymentConfirmedAt: _b.paymentConfirmedAt,
            completedAt: _b.completedAt, lat: _b.lat, lng: _b.lng,
          ));
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mengirim bukti.');
    }
  }

  Future<void> _writeReview() async {
    if (_b.technicianId == null) {
      showSnack(context, 'Teknisi belum ditugaskan untuk pesanan ini.', error: true);
      return;
    }
    // Pengaman lapis kedua: teknisi yang ditugaskan tak boleh menilai
    // dirinya sendiri walau tombolnya sudah disembunyikan di UI.
    final myId = Api.session?.user.id;
    if (myId != null && _b.technicianId == myId) {
      showSnack(context, 'Teknisi tidak bisa menilai pekerjaannya sendiri.', error: true);
      return;
    }
    // Sheet terpisah (bisa diuji langsung): bintang + ulasan OPSIONAL.
    final input = await showReviewSheet(context, technicianName: _b.technicianName);
    if (input == null || !mounted) return; // pelanggan membatalkan
    try {
      final r = await Api.submitReview(
        bookingId: _b.id,
        technicianId: _b.technicianId!,
        rating: input.rating,
        comment: input.comment,
      );
      if (!mounted) return;
      if (!r.ok) {
        // DB menolak (tabel/policy belum ada) — tampilkan pesan berpandu,
        // jangan gagal diam-diam.
        showSnack(context, r.error ?? 'Gagal menyimpan penilaian.', error: true);
        return;
      }
      showSnack(
        context,
        r.voucher != null
            ? 'Penilaian tersimpan! Voucher ${r.voucher!['code']} (${formatRupiah(r.voucher!['amount'] as int)}) masuk ke tab Voucher.'
            : 'Terima kasih! Penilaianmu tersimpan.',
      );
      setState(() => _b = _copyWith(hasReview: true));
    } catch (e) {
      if (!mounted) return;
      if (e.toString().contains('row-level security') ||
          e.toString().contains('42501')) {
        showSnack(
            context,
            'Penilaian ditolak database (polici RLS reviews belum terpasang). '
            'Jalankan supabase/fix-reviews-policies.sql di Supabase SQL Editor.',
            error: true);
      } else {
        showSnackError(context, e, 'Gagal menyimpan penilaian.');
      }
    }
  }

  Booking _copyWith({bool? hasReview, String? paymentProofUrl, String? paymentMethod}) => Booking(
        id: _b.id, code: _b.code, serviceName: _b.serviceName, optionLabel: _b.optionLabel,
        subtotalPrice: _b.subtotalPrice, appFee: _b.appFee, discountAmount: _b.discountAmount,
        totalPrice: _b.totalPrice, status: _b.status, bookingDate: _b.bookingDate,
        bookingTime: _b.bookingTime, address: _b.address, notes: _b.notes,
        paymentMethod: paymentMethod ?? _b.paymentMethod, paymentProofUrl: paymentProofUrl ?? _b.paymentProofUrl,
        paymentRejected: _b.paymentRejected, paymentRejectionReason: _b.paymentRejectionReason,
        technicianId: _b.technicianId, technicianName: _b.technicianName,
        hasReview: hasReview ?? _b.hasReview,
        createdAt: _b.createdAt, paymentConfirmedAt: _b.paymentConfirmedAt,
        completedAt: _b.completedAt,
        lat: _b.lat, lng: _b.lng, // jaga pin: hilang → peta pratinjau ikut lenyap
      );

  /// Kartu pelacakan untuk PEMILIK pesanan — posisi teknisi yang sedang menuju
  /// lokasi. Saat server menjawab "tidak terlihat", yang muncul adalah ALASAN
  /// dari server (mis. "Teknisi belum berangkat"), bukan peta kosong tanpa sebab;
  /// saat server belum menjawab sama sekali (migrasi belum jalan / jaringan),
  /// kartunya tidak tampil — sama fail-soft-nya dengan kartu teknisi & garansi.
  Widget _kartuLacak(Booking b) {
    final p = _posisi;

    if (!p.visible) {
      final sebab = p.reason;
      if (!p.ok || sebab == null) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: _cardDeco(),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.location_searching_rounded,
                size: 18, color: AppColors.inkSoft),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(sebab,
                        style: const TextStyle(
                            fontSize: 13, color: AppColors.inkSoft, height: 1.4)),
                    const SizedBox(height: 6),
                    const Text(_catatanPrivasi,
                        style: TextStyle(
                            fontSize: 11,
                            color: AppColors.inkSoft,
                            height: 1.35)),
                  ]),
            ),
          ]),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: _cardDeco(),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Row(children: [
            Icon(Icons.navigation_rounded, size: 18, color: AppColors.brandDeep),
            SizedBox(width: 8),
            Expanded(
              child: Text('Teknisi sedang menuju lokasimu',
                  style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                      color: AppColors.navy)),
            ),
          ]),
          const SizedBox(height: 2),
          Text(
            [
              if (p.ringkasanJarak != null) p.ringkasanJarak!,
              p.ringkasanUmur,
            ].join(' · '),
            style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
          ),
          const SizedBox(height: 10),
          // Tanpa `hint`: pelanggan tidak perlu rute ke teknisi — hanya perlu
          // tahu di mana dia. Badge "Ketuk untuk rute" di sini akan berbohong.
          MiniPinMap(lat: p.lat!, lng: p.lng!, height: 170, hint: null),
          const SizedBox(height: 8),
          const Text(_catatanPrivasi,
              style: TextStyle(
                  fontSize: 11, color: AppColors.inkSoft, height: 1.35)),
        ]),
      ),
    );
  }

  /// Kartu sisi TEKNISI: satu tombol untuk mulai/berhenti berbagi posisi.
  /// Sebelum ditekan, tidak ada apa pun yang terkirim — itulah gerbang
  /// privasinya; teksnya menjelaskan akibatnya lebih dulu, bukan sesudahnya.
  Widget _kartuBerbagiLokasi(Booking b) {
    final aktif = _sesi.aktifUntuk(b.id);
    final jarak = aktif ? _sesi.jarak : null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: _cardDeco(),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(
              aktif
                  ? Icons.share_location_rounded
                  : Icons.share_location_outlined,
              size: 18,
              color: aktif ? AppColors.mint : AppColors.inkSoft,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                aktif
                    ? 'Posisimu sedang dibagikan ke pelanggan'
                    : 'Bagikan posisimu saat berangkat',
                style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13.5,
                    color: AppColors.navy),
              ),
            ),
          ]),
          const SizedBox(height: 6),
          Text(
            aktif
                ? 'Berbagi berhenti sendiri begitu kamu sampai (≤150 m dari titik '
                    'pelanggan), saat pesanan selesai, atau paling lambat 90 menit.'
                : 'Pelanggan hanya melihat posisimu SETELAH kamu menekan tombol '
                    'ini — bukan posisi on-dutymu terus-menerus, dan tidak ada '
                    'riwayat yang disimpan.',
            style: const TextStyle(
                fontSize: 12, color: AppColors.inkSoft, height: 1.4),
          ),
          if (jarak != null) ...[
            const SizedBox(height: 6),
            Text(
              'Sekitar ${formatJarak(jarak.toDouble())} dari titik pelanggan.',
              style: const TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.brandDeep),
            ),
          ],
          const SizedBox(height: 10),
          if (aktif)
            OutlinedButton.icon(
              onPressed: _bagikanSibuk ? null : _hentikanBerbagi,
              icon: const Icon(Icons.flag_rounded, size: 18),
              label: const Text('Saya sudah tiba — berhenti berbagi'),
            )
          else
            FilledButton.icon(
              onPressed: _bagikanSibuk ? null : _mulaiBerbagi,
              icon: const Icon(Icons.navigation_rounded, size: 18),
              label: const Text('Berangkat — bagikan lokasiku'),
            ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final b = _b;
    final needsPayment = b.status == BookingStatus.pending;
    final myId = (widget.currentUserId ?? () => Api.currentUserId)();
    // Saya teknisi yang ditugaskan pada pesanan ini?
    final isAssignedTech = myId != null && b.technicianId == myId;
    // Saya PEMILIK (pelanggan) pesanan ini? Hanya pemilik yang boleh melihat
    // status bukti pembayaran (termasuk penolakan admin) dan mengirim bukti.
    // Teknisi yang ditugaskan bisa membuka layar ini demi tugas, tapi urusan
    // pembayaran pelanggan bukan miliknya sehingga tidak boleh muncul di sana.
    final isOwner = b.isOwnedBy(myId);

    return Scaffold(
      appBar: AppBar(
        title: Hero(
          tag: 'order-code-${b.id}',
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.brandTint,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('#${b.code}',
                style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: AppColors.brandDeep,
                    fontSize: 14,
                    letterSpacing: .5)),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // pipeline status + timeline stempel waktu
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _cardDeco(),
            child: Column(children: [
              StatusBadge(b.status),
              const SizedBox(height: 14),
              _StatusTimeline(b: b),
            ]),
          ),
          const SizedBox(height: 12),

          // kartu teknisi (jarak + kontak) — HANYA pelanggan pemilik, dan hanya
          // selama pesanan masih aktif: setelah selesai server menutup nomornya.
          if (isOwner && _tech != null && _tech!.hasTechnician && _tech!.active) ...[
            _kartuTeknisi(b, _tech!),
            const SizedBox(height: 12),
          ],

          // "Teknisi menuju lokasi" — kartu pelacakan untuk PELANGGAN pemilik.
          // Gerbangnya ada di server (migrate-technician-trip-share.sql); di
          // sini hanya menampilkan apa yang diizinkan server.
          if (isOwner) _kartuLacak(b),

          // Sisi TEKNISI yang ditugaskan: tombol berbagi posisi, hanya selama
          // pesanan aktif — setelah selesai/dibatalkan tidak ada lagi yang
          // perlu dibagikan (dan trigger server sudah menghapus barisnya).
          if (isAssignedTech &&
              (b.status == BookingStatus.paid ||
                  b.status == BookingStatus.inProgress)) ...[
            _kartuBerbagiLokasi(b),
          ],

          // peringatan penolakan bukti — HANYA untuk pelanggan pemilik pesanan;
          // di aplikasi teknisi bagian ini tidak boleh tampil.
          if (b.paymentRejected && isOwner)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.coralTint,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.coral.withValues(alpha: .4)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Row(children: [
                  Icon(Icons.warning_amber_rounded, color: AppColors.coral, size: 20),
                  SizedBox(width: 8),
                  Text('Bukti pembayaran ditolak admin',
                      style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.coral)),
                ]),
                if (b.paymentRejectionReason != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text('Alasan: ${b.paymentRejectionReason}',
                        style: const TextStyle(fontSize: 13, color: AppColors.ink)),
                  ),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: _uploadProof,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Kirim ulang bukti'),
                  style: FilledButton.styleFrom(backgroundColor: AppColors.coral, minimumSize: const Size(0, 42)),
                ),
              ]),
            ),

          // rincian biaya
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _cardDeco(),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Rincian', style: TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              InfoRow('Layanan', b.optionLabel == null ? b.serviceName : '${b.serviceName} — ${b.optionLabel}'),
              InfoRow('Jadwal', '${formatDateId(b.bookingDate)}\n${b.bookingTime}'),
              InfoRow('Alamat', b.address),
              if (b.notes != null && b.notes!.isNotEmpty) InfoRow('Catatan', b.notes!),
              if (b.technicianName != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    const SizedBox(
                        width: 120,
                        child: Text('Teknisi', style: TextStyle(color: AppColors.inkSoft, fontSize: 13))),
                    Hero(
                      tag: 'tech-av-${b.id}',
                      child: TechAvatarChip(
                          url: b.technicianAvatar, name: b.technicianName!, size: 26),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(b.technicianName!,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, color: AppColors.navy, fontSize: 13)),
                    ),
                  ]),
                ),
              if (b.paymentMethod != null)
                _methodRow(canEdit: needsPayment && isOwner),
              const Divider(height: 24),
              InfoRow('Subtotal', formatRupiah(b.subtotalPrice)),
              InfoRow('Biaya aplikasi', formatRupiah(b.appFee)),
              if (b.discountAmount > 0)
                InfoRow('Diskon voucher', '− ${formatRupiah(b.discountAmount)}'),
              const SizedBox(height: 4),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('Total', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                Text(formatRupiah(b.totalPrice),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: AppColors.brandDeep)),
              ]),
            ]),
          ),
          const SizedBox(height: 12),

          // garansi pekerjaan (masa garansi + status klaim) — pemilik saja.
          if (isOwner && _garansi != null && _garansi!.perluTampil) ...[
            _kartuGaransi(_garansi!),
            const SizedBox(height: 12),
          ],

          // Peta mini pratinjau titik lokasi: teknisi ditugaskan ATAU pemilik
          // pesanan (pin dikirim bersama pesanan — lihat RLS).
          // flutter_map sudah ada di pubspec (picker lokasi) → pratinjau
          // statis OSM tanpa API key; ketuk kartu = buka Google Maps.
          if (b.lat != null && b.lng != null) ...[
            MiniPinMap(
              lat: b.lat!,
              lng: b.lng!,
              onTap: () => openRouteToDestination(
                context,
                lat: b.lat,
                lng: b.lng,
                address: b.address,
              ),
            ),
            const SizedBox(height: 10),
          ],
          // Tombol rute SELALU ada selama alamat pesanan terbaca: titik exact
          // (pin) bila pelanggan memasangnya, jika tidak Google Maps mencari
          // alamat lengkapnya — satu ketukan langsung membuka navigasi.
          if (b.hasPin || b.address.trim().isNotEmpty) ...[
            OutlinedButton.icon(
              onPressed: () => openRouteToDestination(
                context,
                lat: b.lat,
                lng: b.lng,
                address: b.address,
              ),
              icon: const Icon(Icons.navigation_rounded, size: 18),
              label: Text(b.hasPin
                  ? 'Buka Rute ke Titik Lokasi'
                  : 'Buka Rute ke Alamat'),
            ),
            const SizedBox(height: 10),
          ],

          // aksi pelanggan atas pesanannya sendiri: ubah jadwal / batalkan.
          // Syarat yang sama dengan server supaya tidak ada tombol pasti-gagal.
          if (isOwner && _bolehUbahJadwal) ...[
            Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _aksiSibuk ? null : _ubahJadwal,
                  icon: const Icon(Icons.event_repeat_rounded, size: 18),
                  label: const Text('Ubah Jadwal'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _aksiSibuk ? null : _batalkanPesanan,
                  icon: const Icon(Icons.cancel_outlined, size: 18),
                  label: const Text('Batalkan'),
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.coral),
                ),
              ),
            ]),
            if (b.rescheduleCount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                    'Jadwal sudah diubah ${b.rescheduleCount}× (maksimal $maxReschedule).',
                    style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
              ),
            const SizedBox(height: 10),
          ],

          // aksi teknisi: mulai / selesai pekerjaan
          if (isAssignedTech && b.status == BookingStatus.paid)
            FilledButton.icon(
              onPressed: () => _setJobStatus('in_progress'),
              icon: const Icon(Icons.play_arrow_rounded),
              label: const Text('Mulai Kerjakan'),
            ),
          if (isAssignedTech && b.status == BookingStatus.paid) const SizedBox(height: 10),
          if (isAssignedTech && b.status == BookingStatus.inProgress)
            FilledButton.icon(
              onPressed: () => _setJobStatus('completed'),
              icon: const Icon(Icons.check_circle_rounded),
              label: const Text('Tandai Selesai'),
            ),
          if (isAssignedTech && b.status == BookingStatus.inProgress) const SizedBox(height: 10),
          // teknisi melaporkan hasil pekerjaan (paritas web) — bisa sertakan
          // foto bukti hasil (galeri/kamera) lewat ReportScreen.
          if (isAssignedTech &&
              (b.status == BookingStatus.inProgress || b.status == BookingStatus.completed))
            OutlinedButton.icon(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => ReportScreen(booking: b)),
              ),
              icon: const Icon(Icons.assignment_outlined, size: 18),
              label: const Text('Laporkan Hasil Pekerjaan'),
            ),
          if (isAssignedTech &&
              (b.status == BookingStatus.inProgress || b.status == BookingStatus.completed))
            const SizedBox(height: 10),
          // teknisi melepas tugas (paid/in_progress) → kembali ke Tersedia
          if (isAssignedTech &&
              (b.status == BookingStatus.paid || b.status == BookingStatus.inProgress))
            OutlinedButton.icon(
              onPressed: () async {
                final navigator = Navigator.of(context);
                final ok = await releaseJobFlow(context, b.id);
                if (!ok || !mounted) return;
                await _reload();
                if (!mounted) return;
                if (_b.technicianId == null) navigator.pop(); // bukan tugasmu lagi
              },
              style: OutlinedButton.styleFrom(foregroundColor: AppColors.coral),
              icon: const Icon(Icons.link_off_rounded),
              label: const Text('Lepas Tugas'),
            ),
          if (isAssignedTech &&
              (b.status == BookingStatus.paid || b.status == BookingStatus.inProgress))
            const SizedBox(height: 10),

          // chat kedua sisi: pelanggan ↔ teknisi
          if (b.technicianId != null)
            FilledButton.icon(
              onPressed: () {
                final chatMyId = Api.session?.user.id;
                if (chatMyId == null) return;
                final isCustomer = b.technicianId != chatMyId;
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen(
                      booking: b,
                      myId: chatMyId,
                      peerName: isCustomer ? (b.technicianName ?? 'Teknisi') : 'Pelanggan',
                      peerAvatarUrl: isCustomer ? b.technicianAvatar : null,
                    ),
                  ),
                ).then((_) => _reload());
              },
              icon: const Icon(Icons.chat_bubble_rounded),
              label: Text(
                  b.technicianId != myId ? 'Chat Teknisi' : 'Chat Pelanggan'),
            ),
          if (b.technicianId != null) const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => ReceiptScreen(booking: b)),
            ),
            icon: const Icon(Icons.receipt_long_rounded),
            label: const Text('Lihat Struk'),
          ),
          if (needsPayment && isOwner)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: FilledButton.icon(
                onPressed: _uploadProof,
                icon: const Icon(Icons.upload_file_outlined),
                label: const Text('Kirim bukti pembayaran'),
              ),
            ),
          // penilaian hanya untuk PELANGGAN — teknisi yang ditugaskan tidak
          // boleh menilai dirinya sendiri (guard peran, bukan hanya status).
          if (b.status == BookingStatus.completed &&
              b.technicianId != null &&
              !b.hasReview &&
              !isAssignedTech)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: OutlinedButton.icon(
                onPressed: _writeReview,
                icon: const Icon(Icons.star_outline_rounded),
                label: const Text('Beri penilaian teknisi'),
              ),
            ),
          if (b.hasReview && !isAssignedTech)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(Icons.check_circle, color: AppColors.mint, size: 18),
                SizedBox(width: 6),
                Text('Sudah kamu nilai', style: TextStyle(color: AppColors.mint, fontWeight: FontWeight.w600)),
              ]),
            ),
          const SizedBox(height: 10),
          TextButton.icon(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => ReportScreen(booking: b)),
            ),
            icon: const Icon(Icons.flag_outlined, size: 18),
            label: const Text('Laporkan masalah pada pesanan ini'),
            style: TextButton.styleFrom(foregroundColor: AppColors.inkSoft),
          ),
        ],
      ),
    );
  }

  BoxDecoration _cardDeco() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      );

}

/// Sheet "Ubah jadwal": pilih tanggal (14 hari ke depan) + jam kedatangan.
/// Mengembalikan (date: 'yyyy-MM-dd', time: slot) atau null bila ditutup.
///
/// Jam yang sudah lewat TIDAK ditawarkan — mis. memilih hari ini pukul 11.00
/// menyisakan slot 13.00 ke atas saja. Server juga menolaknya, dan tombol yang
/// pasti gagal hanya membuang waktu pelanggan. Perbandingannya memakai helper
/// [slotStart] yang sama dengan pemeriksaan izin.
class _RescheduleSheet extends StatefulWidget {
  final String currentDate;
  final String currentTime;
  final DateTime sekarang;

  const _RescheduleSheet({
    required this.currentDate,
    required this.currentTime,
    required this.sekarang,
  });

  @override
  State<_RescheduleSheet> createState() => _RescheduleSheetState();
}

class _RescheduleSheetState extends State<_RescheduleSheet> {
  late DateTime _tanggal;
  late String _slot;

  @override
  void initState() {
    super.initState();
    _tanggal = _tanggalPertamaTersedia();
    _slot = _slotPertamaTersedia(_tanggal) ?? timeSlots.first;
  }

  /// 14 hari mulai hari ini (waktu perangkat).
  List<DateTime> get _pilihanTanggal {
    final hari =
        DateTime(widget.sekarang.year, widget.sekarang.month, widget.sekarang.day);
    return List.generate(14, (i) => hari.add(Duration(days: i)));
  }

  DateTime _tanggalPertamaTersedia() {
    for (final d in _pilihanTanggal) {
      if (_slotPertamaTersedia(d) != null) return d;
    }
    return _pilihanTanggal.first;
  }

  static String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// Jam pertama yang masih di masa depan untuk [tanggal], atau null bila
  /// seluruh slot hari itu sudah lewat.
  String? _slotPertamaTersedia(DateTime tanggal) {
    final ymd = _ymd(tanggal);
    for (final s in timeSlots) {
      if (slotStart(ymd, s).isAfter(widget.sekarang)) return s;
    }
    return null;
  }

  String _labelTanggal(DateTime d) {
    final hari =
        DateTime(widget.sekarang.year, widget.sekarang.month, widget.sekarang.day);
    final selisih = d.difference(hari).inDays;
    if (selisih == 0) return 'Hari ini';
    if (selisih == 1) return 'Besok';
    const nama = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    return '${nama[d.weekday - 1]} ${d.day}';
  }

  @override
  Widget build(BuildContext context) {
    final tanggalTerpilih = _ymd(_tanggal);
    final slotTersedia = timeSlots
        .where((s) => slotStart(tanggalTerpilih, s).isAfter(widget.sekarang))
        .toList();
    final tanggalTersedia =
        _pilihanTanggal.where((d) => _slotPertamaTersedia(d) != null).toList();
    final samaDenganSekarang =
        tanggalTerpilih == widget.currentDate && _slot == widget.currentTime;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Ubah jadwal', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            Text('Sekarang: ${formatDateId(widget.currentDate)} · ${widget.currentTime}',
                style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
            const SizedBox(height: 14),
            const Text('Tanggal', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final d in tanggalTersedia)
                ChoiceChip(
                  label: Text(_labelTanggal(d)),
                  selected: _ymd(d) == tanggalTerpilih,
                  onSelected: (_) => setState(() {
                    _tanggal = d;
                    _slot = _slotPertamaTersedia(d) ?? timeSlots.first;
                  }),
                ),
            ]),
            const SizedBox(height: 16),
            const Text('Jam kedatangan', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final s in slotTersedia)
                ChoiceChip(
                  label: Text(s),
                  selected: _slot == s,
                  onSelected: (_) => setState(() => _slot = s),
                ),
            ]),
            if (slotTersedia.isEmpty)
              const Text('Tidak ada jam tersisa pada tanggal ini — pilih tanggal lain.',
                  style: TextStyle(fontSize: 12.5, color: AppColors.coral)),
            if (samaDenganSekarang)
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('Pilih tanggal atau jam yang berbeda dari jadwal sekarang.',
                    style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
              ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: (slotTersedia.contains(_slot) && !samaDenganSekarang)
                    ? () => Navigator.pop(context, (date: tanggalTerpilih, time: _slot))
                    : null,
                child: const Text('Simpan jadwal baru'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Dialog teks alasan (pembatalan & klaim garansi). Mengembalikan teks yang
/// sudah di-trim, atau null bila dibatalkan.
///
/// Minimal 5 karakter — batas yang sama dengan RPC di server, jadi pelanggan
/// tidak perlu menunggu perjalanan ke server hanya untuk ditolak.
class _AlasanDialog extends StatefulWidget {
  final String judul;
  final String keterangan;
  final String hint;
  final String labelKirim;
  final Color? warnaKirim;

  const _AlasanDialog({
    required this.judul,
    required this.keterangan,
    required this.hint,
    required this.labelKirim,
    this.warnaKirim,
  });

  @override
  State<_AlasanDialog> createState() => _AlasanDialogState();
}

class _AlasanDialogState extends State<_AlasanDialog> {
  final _ctrl = TextEditingController();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  bool get _valid => _ctrl.text.trim().length >= 5;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.judul),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.keterangan,
              style: const TextStyle(fontSize: 13, color: AppColors.inkSoft)),
          const SizedBox(height: 12),
          TextField(
            controller: _ctrl,
            autofocus: true,
            maxLength: 500,
            maxLines: 3,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: widget.hint,
              border: const OutlineInputBorder(),
            ),
          ),
          if (!_valid)
            const Text('Tulis minimal 5 karakter.',
                style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
        FilledButton(
          onPressed: _valid ? () => Navigator.pop(context, _ctrl.text.trim()) : null,
          style: widget.warnaKirim == null
              ? null
              : FilledButton.styleFrom(backgroundColor: widget.warnaKirim),
          child: Text(widget.labelKirim),
        ),
      ],
    );
  }
}

/// Sheet konfirmasi pembayaran: jumlah transfer + info rekening tujuan.
///
/// StatefulWidget supaya `TextEditingController` hidup selama route sheet
/// (termasuk animasi keluar) dan dibuang di `dispose()` miliknya sendiri —
/// mem-dispose controller milik pemanggil lebih awal membuat `TextField` yang
/// masih ter-mount memakainya setelah mati (layar merah).
/// Mengembalikan teks jumlah apa adanya (format dibersihkan pemanggil), atau
/// null bila sheet ditutup.
class _PaymentAmountSheet extends StatefulWidget {
  final int totalPrice;
  final Map<String, String>? account;

  const _PaymentAmountSheet({required this.totalPrice, required this.account});

  @override
  State<_PaymentAmountSheet> createState() => _PaymentAmountSheetState();
}

class _PaymentAmountSheetState extends State<_PaymentAmountSheet> {
  late final TextEditingController _amountCtrl =
      TextEditingController(text: '${widget.totalPrice}');

  @override
  void dispose() {
    _amountCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final account = widget.account;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Konfirmasi Pembayaran', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 4),
          const Text('Foto terpilih ✓ — masukkan jumlah yang ditransfer',
              style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
          if (account != null) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: AppColors.brandTint, borderRadius: BorderRadius.circular(10)),
              child: Text.rich(
                TextSpan(style: const TextStyle(fontSize: 12.5, color: AppColors.navy), children: [
                  const WidgetSpan(child: Icon(Icons.account_balance_rounded, size: 15, color: AppColors.brandDeep)),
                  const TextSpan(text: ' '),
                  TextSpan(text: 'Transfer ke ${account['bank']} '),
                  TextSpan(text: account['number'], style: const TextStyle(fontWeight: FontWeight.w800)),
                  TextSpan(text: ' a.n. ${account['name']}'),
                ]),
              ),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _amountCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Jumlah pembayaran (Rp)', prefixText: 'Rp '),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => Navigator.pop(context, _amountCtrl.text),
            child: const Text('Kirim bukti'),
          ),
        ]),
      ),
    );
  }
}

/// Timeline vertikal status pesanan dengan stempel waktu:
/// Pesanan dibuat → Dibayar → Dikerjakan → Selesai (+ Dibatalkan).
/// Stempel hanya tampil bila kolomnya tersedia di database.
class _StatusTimeline extends StatelessWidget {
  final Booking b;
  const _StatusTimeline({required this.b});

  @override
  Widget build(BuildContext context) {
    final pipeline = [BookingStatus.pending, BookingStatus.paid, BookingStatus.inProgress, BookingStatus.completed];
    final cancelled = b.status == BookingStatus.cancelled;
    final currentIdx = cancelled ? -1 : pipeline.indexOf(b.status);

    final steps = <_TimelineStepData>[
      _TimelineStepData(
        'Pesanan dibuat',
        stamp: b.createdAt,
        reached: cancelled || currentIdx >= 0,
      ),
      _TimelineStepData(
        'Dibayar — dikonfirmasi admin',
        stamp: b.paymentConfirmedAt,
        reached: currentIdx >= 1,
      ),
      _TimelineStepData(
        'Dikerjakan teknisi',
        stamp: null, // belum ada kolom started_at di database
        reached: currentIdx >= 2,
        ongoing: b.status == BookingStatus.inProgress,
      ),
      _TimelineStepData(
        'Selesai',
        stamp: b.completedAt,
        reached: currentIdx >= 3,
      ),
    ];

    return Column(children: [
      for (var i = 0; i < steps.length; i++)
        _TimelineRow(
          step: steps[i],
          isLast: i == steps.length - 1 && !cancelled,
        ),
      if (cancelled)
        const _TimelineRow(
          step: _TimelineStepData('Pesanan dibatalkan', stamp: null, reached: true, cancelled: true),
          isLast: true,
        ),
    ]);
  }
}

class _TimelineStepData {
  final String label;
  final DateTime? stamp;
  final bool reached;
  final bool ongoing;
  final bool cancelled;
  const _TimelineStepData(this.label, {this.stamp, required this.reached, this.ongoing = false, this.cancelled = false});
}

class _TimelineRow extends StatelessWidget {
  final _TimelineStepData step;
  final bool isLast;
  const _TimelineRow({required this.step, required this.isLast});

  Color get _dotColor {
    if (step.cancelled) return AppColors.coral;
    if (step.reached) return AppColors.mint;
    return Colors.white;
  }

  @override
  Widget build(BuildContext context) {
    final stampText = step.reached
        ? (step.stamp != null ? formatDateTimeId(step.stamp!) : (step.ongoing ? 'sedang berlangsung' : '—'))
        : null;

    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // Rel vertikal + titik status
        SizedBox(
          width: 26,
          child: Column(children: [
            Container(
              width: 14,
              height: 14,
              margin: const EdgeInsets.only(top: 3),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _dotColor,
                border: Border.all(color: _dotColor == Colors.white ? AppColors.line : _dotColor, width: 2),
              ),
              child: step.reached && !step.ongoing
                  ? const Icon(Icons.check, size: 9, color: Colors.white)
                  : null,
            ),
            if (!isLast)
              Expanded(
                child: Container(width: 2, color: step.reached ? AppColors.mint.withValues(alpha: .45) : AppColors.line),
              ),
          ]),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: isLast ? 0 : 14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                step.label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: step.ongoing ? FontWeight.w800 : FontWeight.w600,
                  color: step.cancelled
                      ? AppColors.coral
                      : step.reached
                          ? AppColors.navy
                          : AppColors.inkSoft,
                ),
              ),
              if (stampText != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    stampText,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: step.ongoing ? AppColors.mint : AppColors.inkSoft,
                      fontStyle: step.ongoing ? FontStyle.italic : FontStyle.normal,
                    ),
                  ),
                ),
            ]),
          ),
        ),
      ]),
    );
  }
}
