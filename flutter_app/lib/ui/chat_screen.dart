import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../chat_moderation.dart';
import '../chat_unread.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';

/// Chat pelanggan ↔ teknisi untuk satu pesanan.
/// - Riwayat dimuat sekali; pesan baru masuk via Supabase Realtime.
/// - Bubble kiri = lawan bicara, kanan = pengirim (chat klasik).
/// - Tombol kirim disabled saat teks kosong / sedang mengirim.
/// - Menu ⋮ menyediakan **Laporkan percakapan** dan **Blokir** pengguna:
///   dua jalur yang diwajibkan kebijakan konten buatan pengguna Google Play.
///
/// Semua akses jaringan bisa diganti lewat parameter opsional (dipakai tes
/// widget supaya alur laporkan & blokir bisa diuji tanpa Supabase).
class ChatScreen extends StatefulWidget {
  final Booking booking;
  final String myId;
  final String peerName;
  final String? peerAvatarUrl;

  /// Pengganti [Api.fetchChatMessages] — hanya dipakai tes.
  final Future<List<ChatMessage>> Function(String bookingId)? loadMessages;

  /// Pengganti [Api.subscribeChat] — hanya dipakai tes.
  final Future<ChatUnsubscribe> Function(
      String bookingId, void Function(ChatMessage) onMessage)? subscribeMessages;

  /// Pengganti [Api.fetchChatBlockState] — hanya dipakai tes.
  final Future<ChatBlockState> Function(String peerId)? loadBlockState;

  /// Pengganti pengiriman laporan. Menerima alasan yang dipilih pengguna.
  final Future<void> Function({required ChatReportReason reason, String? detail})?
      sendReport;

  /// Pengganti blokir/buka blokir lawan bicara.
  final Future<void> Function()? blockPeer;
  final Future<void> Function()? unblockPeer;

  const ChatScreen({
    super.key,
    required this.booking,
    required this.myId,
    required this.peerName,
    this.peerAvatarUrl,
    this.loadMessages,
    this.subscribeMessages,
    this.loadBlockState,
    this.sendReport,
    this.blockPeer,
    this.unblockPeer,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<ChatMessage>? _messages;
  bool _sending = false;
  VoidCallback? _unsubscribe;
  bool _peerLoaded = false;
  /// Status blokir dua arah; dianggap tidak ada blokir sampai terbukti
  /// sebaliknya (lihat [Api.fetchChatBlockState]).
  ChatBlockState _block = ChatBlockState.none;
  /// Saya pelanggan bila saya bukan teknisi yang ditugaskan.
  bool get _isCustomer => widget.booking.technicianId != widget.myId;

  /// Id lawan bicara, atau null bila pesanan belum punya teknisi / saya bukan
  /// peserta pesanan ini. Aturannya di [chatPeerId] supaya bisa diuji terpisah
  /// (salah menunjuk orang = laporan/blokir mengenai orang yang salah).
  String? get _peerId => chatPeerId(
        myId: widget.myId,
        technicianId: widget.booking.technicianId,
        userId: widget.booking.userId,
      );

  @override
  void initState() {
    super.initState();
    unawaited(ChatUnreadService.enterChat(widget.booking.id));
    _loadBlockState();
    _load();
  }

  Future<void> _loadBlockState() async {
    final peerId = _peerId;
    if (peerId == null || peerId.isEmpty) return;
    final load = widget.loadBlockState ?? Api.fetchChatBlockState;
    final state = await load(peerId);
    if (!mounted) return;
    setState(() => _block = state);
  }

  Future<void> _load() async {
    // Nama + avatar lawan bicara: pelanggan melihat teknisi, teknisi
    // melihat pelanggan — ambil profilnya sekali.
    if (!_peerLoaded) {
      _peerLoaded = true;
      _loadPeerInfo();
    }
    try {
      final load = widget.loadMessages ?? Api.fetchChatMessages;
      final msgs = await load(widget.booking.id);
      if (!mounted) return;
      setState(() => _messages = msgs);
      if (msgs.isNotEmpty) {
        // Riwayat yang baru dimuat sudah terlihat: majukan penanda baca sampai
        // pesan terakhir, tanpa memundurkannya bila ada pesan realtime.
        unawaited(ChatUnreadService.markRead(widget.booking.id, at: msgs.last.createdAt));
      }
      _jumpToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages = []);
      showSnackError(context, e, 'Gagal memuat chat.');
    }
    // Realtime — mulai setelah riwayat ada agar tidak dobel.
    final subscribe = widget.subscribeMessages ?? Api.subscribeChat;
    _unsubscribe = await subscribe(widget.booking.id, (msg) {
      if (!mounted) return;
      final exists = _messages?.any((m) => m.id == msg.id) ?? false;
      if (exists) return;
      setState(() => _messages = [...?_messages, msg]);
      // Pesan ini tampil langsung di layar chat — jangan biarkan badge naik.
      unawaited(ChatUnreadService.markRead(widget.booking.id, at: msg.createdAt));
      _jumpToBottom();
    });
  }

  Future<void> _loadPeerInfo() async {
    try {
      final peerId = _isCustomer ? widget.booking.technicianId! : widget.booking.userId!;
      final p = await Api.fetchProfileById(peerId);
      if (!mounted || p == null) return;
      setState(() {
        _peerName = p.name;
        _peerAvatar = p.avatarUrl;
      });
    } catch (_) {
      // fallback tetap pakai nama awal
    }
  }

  String _peerName = '';
  String? _peerAvatar;

  String get _peerNameLabel => _peerName.isNotEmpty ? _peerName : widget.peerName;

  void _jumpToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending || !_block.inputEnabled) return;
    setState(() => _sending = true);
    _input.clear();
    try {
      // Optimistis: tampilkan seketika; realtime dedupe via id.
      await Api.sendChatMessage(widget.booking.id, text);
    } catch (e) {
      if (mounted) {
        _input.text = text; // kembalikan teks agar tidak hilang
        showSnackError(context, e, 'Gagal mengirim pesan.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  // ================== Moderasi: laporkan & blokir ==================
  // Dua jalur ini yang membuat aplikasi memenuhi kebijakan konten buatan
  // pengguna Google Play: pengguna bisa melaporkan konten dan memblokir orang
  // yang menyalahgunakan chat, tanpa harus menghubungi admin lewat email.

  /// Lembar pilihan alasan → kirim laporan ke tabel `reports` (kind='chat').
  Future<void> _openReportSheet() async {
    final result = await showModalBottomSheet<_ChatReportResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _ReportSheet(peerName: _peerNameLabel),
    );
    if (result == null || !mounted) return;

    final peerId = _peerId;
    if (peerId == null || peerId.isEmpty) return;
    final send = widget.sendReport ??
        ({required ChatReportReason reason, String? detail}) => Api.reportChat(
              bookingId: widget.booking.id,
              bookingCode: widget.booking.code,
              peerId: peerId,
              reason: reason,
              detail: detail,
            );
    try {
      await send(reason: result.reason, detail: result.detail);
      if (!mounted) return;
      showSnack(context, chatReportSentMessage);
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mengirim laporan.');
    }
  }

  /// Konfirmasi sebelum memblokir — akibatnya disebut lebih dulu.
  Future<void> _confirmBlock() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Blokir $_peerNameLabel?'),
        content: Text(chatBlockConfirmBody(_peerNameLabel)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.coral),
            child: const Text('Blokir'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final peerId = _peerId;
    if (peerId == null || peerId.isEmpty) return;
    final run = widget.blockPeer ??
        () => Api.blockChatUser(peerId, bookingId: widget.booking.id);
    try {
      await run();
      if (!mounted) return;
      setState(() => _block = ChatBlockState(byMe: true, byPeer: _block.byPeer));
      showSnack(context, '$_peerNameLabel diblokir. Chat ini dinonaktifkan.');
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal memblokir pengguna.');
    }
  }

  /// Buka blokir — pengguna tidak boleh terjebak dengan keputusan lamanya.
  Future<void> _confirmUnblock() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Buka blokir $_peerNameLabel?'),
        content: Text(
            '$_peerNameLabel bisa mengirim pesan lagi dan percakapan ini aktif kembali.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Buka blokir'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final peerId = _peerId;
    if (peerId == null || peerId.isEmpty) return;
    final run = widget.unblockPeer ?? () => Api.unblockChatUser(peerId);
    try {
      await run();
      if (!mounted) return;
      setState(() => _block = ChatBlockState(byMe: false, byPeer: _block.byPeer));
      showSnack(context, 'Blokir $_peerNameLabel dibuka.');
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal membuka blokir.');
    }
  }

  void _onMenu(_ChatMenuAction action) {
    switch (action) {
      case _ChatMenuAction.report:
        unawaited(_openReportSheet());
      case _ChatMenuAction.block:
        unawaited(_confirmBlock());
      case _ChatMenuAction.unblock:
        unawaited(_confirmUnblock());
    }
  }

  @override
  void dispose() {
    unawaited(ChatUnreadService.leaveChat(widget.booking.id));
    _unsubscribe?.call();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final title = _peerNameLabel;
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        title: Row(children: [
          TechAvatarChip(
              url: (_peerAvatar != null && _peerAvatar!.isNotEmpty) ? _peerAvatar : widget.peerAvatarUrl,
              name: title,
              size: 34),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.navy)),
              Text('#${widget.booking.code}',
                  style: const TextStyle(fontSize: 11, color: AppColors.inkSoft)),
            ]),
          ),
        ]),
        actions: [
          PopupMenuButton<_ChatMenuAction>(
            tooltip: 'Opsi percakapan',
            onSelected: _onMenu,
            itemBuilder: (_) => [
              const PopupMenuItem(
                value: _ChatMenuAction.report,
                child: ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.flag_outlined, size: 20),
                  title: Text('Laporkan percakapan'),
                ),
              ),
              PopupMenuItem(
                value: _block.byMe ? _ChatMenuAction.unblock : _ChatMenuAction.block,
                child: ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    _block.byMe ? Icons.lock_open_rounded : Icons.block_rounded,
                    size: 20,
                    color: _block.byMe ? null : AppColors.coral,
                  ),
                  title: Text(_block.byMe
                      ? 'Buka blokir $_peerNameLabel'
                      : 'Blokir $_peerNameLabel'),
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(children: [
        if (_block.any) _BlockNotice(state: _block, peerName: _peerNameLabel),
        Expanded(
          child: _messages == null
              ? const Center(child: CircularProgressIndicator())
              : _messages!.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.chat_bubble_outline_rounded, size: 44, color: AppColors.line),
                          const SizedBox(height: 12),
                          const Text('Belum ada pesan.',
                              style: TextStyle(color: AppColors.inkSoft, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text('Sapa $_peerNameLabel dan sepakati detail pekerjaan di sini.',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
                        ]),
                      ),
                    )
                  : ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.all(16),
                      itemCount: _messages!.length,
                      itemBuilder: (context, i) {
                        final m = _messages![i];
                        final mine = m.senderId == widget.myId;
                        return _Bubble(message: m, mine: mine);
                      },
                    ),
        ),
        // ==== Input bar ====
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: AppColors.line)),
            ),
            child: !_block.inputEnabled
                ? _BlockedComposer(
                    state: _block,
                    peerName: _peerNameLabel,
                    onReport: () => unawaited(_openReportSheet()),
                  )
                : Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _send(),
                  decoration: InputDecoration(
                    hintText: 'Tulis pesan…',
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    filled: true,
                    fillColor: AppColors.paper,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(22),
                      borderSide: const BorderSide(color: AppColors.line),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(22),
                      borderSide: const BorderSide(color: AppColors.line),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: _send,
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(color: AppColors.brand, shape: BoxShape.circle),
                  child: _sending
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// Aksi di menu ⋮ percakapan.
enum _ChatMenuAction { report, block, unblock }

/// Hasil lembar "Laporkan percakapan": alasan terpilih + catatan opsional.
class _ChatReportResult {
  final ChatReportReason reason;
  final String? detail;
  const _ChatReportResult(this.reason, this.detail);
}

/// Keterangan di atas riwayat pesan saat ada blokir (dua arah).
class _BlockNotice extends StatelessWidget {
  final ChatBlockState state;
  final String peerName;
  const _BlockNotice({required this.state, required this.peerName});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      color: const Color(0xFFFDECEC),
      child: Row(children: [
        const Icon(Icons.block_rounded, size: 18, color: AppColors.coral),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            state.byMe
                ? chatBlockedByMeNotice(peerName)
                : chatBlockedByPeerNotice(peerName),
            style: const TextStyle(fontSize: 11.5, color: AppColors.navy, height: 1.3),
          ),
        ),
      ]),
    );
  }
}

/// Pengganti kotak tulis saat chat diblokir.
///
/// Tombol **Laporkan** tetap tersedia: pengguna yang diblokir tidak boleh
/// buntu tanpa jalan melapor ke admin.
class _BlockedComposer extends StatelessWidget {
  final ChatBlockState state;
  final String peerName;
  final VoidCallback onReport;
  const _BlockedComposer({
    required this.state,
    required this.peerName,
    required this.onReport,
  });

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      const Icon(Icons.lock_outline_rounded, size: 18, color: AppColors.inkSoft),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          state.byMe
              ? 'Kamu memblokir $peerName.'
              : 'Chat dinonaktifkan.',
          style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft),
        ),
      ),
      TextButton.icon(
        onPressed: onReport,
        icon: const Icon(Icons.flag_outlined, size: 16),
        label: const Text('Laporkan'),
      ),
    ]);
  }
}

/// Lembar bawah pilihan alasan pelaporan.
///
/// Mengembalikan [_ChatReportResult] lewat `Navigator.pop`, atau null bila
/// dibatalkan — pemanggilan jaringan tetap di [ChatScreen] supaya lembar ini
/// murni soal pilihan pengguna.
class _ReportSheet extends StatefulWidget {
  final String peerName;
  const _ReportSheet({required this.peerName});

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  ChatReportReason? _picked;
  final _detail = TextEditingController();

  @override
  void dispose() {
    _detail.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Laporkan percakapan dengan ${widget.peerName}',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.navy)),
          const SizedBox(height: 4),
          const Text(chatReportSheetIntro,
              style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
          const SizedBox(height: 8),
          // RadioGroup (bukan groupValue/onChanged per baris): API lama sudah
          // usang di Flutter 3.47 dan `analyze --fatal-infos` akan merah.
          RadioGroup<ChatReportReason>(
            groupValue: _picked,
            onChanged: (v) => setState(() => _picked = v),
            child: Column(
              children: [
                for (final r in chatReportReasons)
                  RadioListTile<ChatReportReason>(
                    value: r,
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(r.label, style: const TextStyle(fontSize: 13.5)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          TextField(
            controller: _detail,
            minLines: 2,
            maxLines: 4,
            maxLength: 300,
            decoration: const InputDecoration(
              labelText: 'Catatan tambahan (opsional)',
              hintText: 'Mis. jam kejadian atau kalimat yang mengganggu',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 4),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _picked == null
                  ? null
                  : () => Navigator.pop(
                        context,
                        _ChatReportResult(_picked!, _detail.text),
                      ),
              child: const Text('Kirim laporan'),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Bubble chat: kanan brand (pengirim), kiri putih (lawan), ekor membulat.
class _Bubble extends StatelessWidget {
  final ChatMessage message;
  final bool mine;
  const _Bubble({required this.message, required this.mine});

  String get _time {
    final t = message.createdAt.toLocal();
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        constraints: const BoxConstraints(maxWidth: 300),
        decoration: BoxDecoration(
          color: mine ? AppColors.brand : Colors.white,
          border: mine ? null : Border.all(color: AppColors.line),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(mine ? 18 : 4),
            bottomRight: Radius.circular(mine ? 4 : 18),
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(
            message.body,
            style: TextStyle(
              fontSize: 13.5,
              color: mine ? Colors.white : AppColors.navy,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 2),
          Text(_time,
              style: TextStyle(
                  fontSize: 9.5, color: mine ? Colors.white70 : AppColors.inkSoft)),
        ]),
      ),
    );
  }
}
