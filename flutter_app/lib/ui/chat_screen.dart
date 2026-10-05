import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';

/// Chat pelanggan ↔ teknisi untuk satu pesanan.
/// - Riwayat dimuat sekali; pesan baru masuk via Supabase Realtime.
/// - Bubble kiri = lawan bicara, kanan = pengirim (chat klasik).
/// - Tombol kirim disabled saat teks kosong / sedang mengirim.
class ChatScreen extends StatefulWidget {
  final Booking booking;
  final String myId;
  final String peerName;
  final String? peerAvatarUrl;

  const ChatScreen({
    super.key,
    required this.booking,
    required this.myId,
    required this.peerName,
    this.peerAvatarUrl,
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
  /// Saya pelanggan bila saya bukan teknisi yang ditugaskan.
  bool get _isCustomer => widget.booking.technicianId != widget.myId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // Nama + avatar lawan bicara: pelanggan melihat teknisi, teknisi
    // melihat pelanggan — ambil profilnya sekali.
    if (!_peerLoaded) {
      _peerLoaded = true;
      _loadPeerInfo();
    }
    try {
      final msgs = await Api.fetchChatMessages(widget.booking.id);
      if (!mounted) return;
      setState(() => _messages = msgs);
      _jumpToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages = []);
      showSnackError(context, e, 'Gagal memuat chat.');
    }
    // Realtime — mulai setelah riwayat ada agar tidak dobel.
    _unsubscribe = await Api.subscribeChat(widget.booking.id, (msg) {
      if (!mounted) return;
      final exists = _messages?.any((m) => m.id == msg.id) ?? false;
      if (exists) return;
      setState(() => _messages = [...?_messages, msg]);
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
    if (text.isEmpty || _sending) return;
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

  @override
  void dispose() {
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
      ),
      body: Column(children: [
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
            child: Row(children: [
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
