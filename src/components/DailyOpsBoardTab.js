"use client";

import { useState } from "react";
import {
  getDailyOpsBoardAdmin,
  notifyLateStartCustomerAdmin,
  releaseLateTechnicianAdmin,
  remindTechnicianBalanceAdmin,
} from "@/app/actions/admin";
import { formatTerlambat } from "@/lib/late-start";
import { StatusPill } from "@/components/StatusPipeline";
import { formatRupiah } from "@/lib/pricing";
import { serviceLabel } from "@/lib/booking-quantity";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  ClipboardList,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  UserRound,
  UserX,
  Wallet,
  Wrench,
  TimerOff,
  Send,
  UserMinus,
} from "lucide-react";

/** "2026-10-14" → "Rabu, 14 Okt 2026" (tanpa zona waktu: tanggalnya sudah WIB). */
function tanggalPanjang(ymd) {
  if (!ymd) return "-";
  try {
    return new Date(`${ymd}T00:00:00`).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

/** Waktu pembatalan/pelepasan: 14 Okt 2026, 14.30 */
function waktuSingkat(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function Kartu({ label, nilai, icon: Icon, tone = "navy", catatan }) {
  const warna = {
    navy: "text-navy",
    amber: "text-amber",
    coral: "text-coral",
    mint: "text-mint",
    brand: "text-brand-deep",
  }[tone];
  return (
    <div className="card !p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
        {Icon && <Icon size={13} />}
        {label}
      </div>
      <p className={`font-display text-2xl font-bold mt-1 ${warna}`}>{nilai}</p>
      {catatan && <p className="text-[11px] text-ink-soft mt-0.5 truncate" title={catatan}>{catatan}</p>}
    </div>
  );
}

function BarisPesanan({ b, aksi }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-line last:border-0 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="pill bg-brand-tint text-brand-deep font-bold text-xs">#{b.code}</span>
          <span className="text-sm font-semibold text-navy truncate">{serviceLabel(b)}</span>
          <StatusPill status={b.status} />
        </div>
        <p className="text-xs text-ink-soft mt-0.5 truncate">
          {b.booking_time} · {b.address || "-"}
        </p>
        <p className="text-xs text-ink-soft">
          Pelanggan: {b.customer?.name || "-"}
          {b.technician?.name ? ` · Teknisi: ${b.technician.name}` : ""}
        </p>
        {b.status === "cancelled" && (
          <p className="text-[11px] text-coral mt-1">
            Alasan batal: {b.cancelled_reason || "tidak dicatat"}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {b.total_price != null && (
          <span className="text-xs font-semibold text-navy">{formatRupiah(b.total_price)}</span>
        )}
        {aksi}
      </div>
    </div>
  );
}

/**
 * Tab "Hari Ini" panel admin.
 *
 * Mengapa satu papan, bukan menambah tab lain: pekerjaan admin berpola
 * "apa yang perlu saya lakukan sekarang?", dan pertanyaan itu sebelumnya
 * harus dijawab dengan membuka beberapa tab berbentuk daftar. Papan ini
 * sengaja hanya memuat hal yang bisa DITINDAKLANJUTI — bukan seluruh riwayat.
 *
 * Tugas yang dilepas teknisi ikut ditampilkan di sini. Sebelumnya pelepasan
 * hanya dikabarkan lewat email; email tidak membentuk antrean, sehingga
 * pekerjaan yang sudah dilepas mudah terlupakan sampai pelanggan menelepon.
 *
 * Piutang teknisi yang sudah melewati ambang umur (mis. teknisi berhenti dan
 * tak akan pernah menyetor) juga menjadi TUGAS di sini: ingatkan setor langsung
 * dari papan, atau lanjut ke tab Saldo Aktif untuk mengajukan penghapusan.
 */
export default function DailyOpsBoardTab({
  board: boardAwal = null,
  error: errorAwal = null,
  onOpenBookings,
  onOpenBalances,
}) {
  const [board, setBoard] = useState(boardAwal);
  const [error, setError] = useState(errorAwal);
  const [loading, setLoading] = useState(false);
  const [remindingId, setRemindingId] = useState(null);
  const [busyLate, setBusyLate] = useState(null); // `${aksi}:${bookingId}`
  const [toast, setToast] = useState("");

  /** Kirim pengingat setor ke satu teknisi — tanpa pindah tab. */
  async function ingatkan(row) {
    setRemindingId(row.id);
    setToast("");
    try {
      const res = await remindTechnicianBalanceAdmin(row.id);
      setToast(res?.error ? `Gagal mengirim pengingat: ${res.error}` : `Pengingat setor terkirim ke ${row.nama}.`);
    } finally {
      setRemindingId(null);
    }
  }

  async function muatUlang() {
    setLoading(true);
    setError(null);
    const res = await getDailyOpsBoardAdmin();
    setLoading(false);
    if (res.error) setError(res.error);
    else setBoard(res.board);
  }

  /** Kabari pelanggan bahwa admin sedang menangani teknisi yang terlambat. */
  async function beriTahuPelanggan(b) {
    setBusyLate(`notify:${b.id}`);
    setToast("");
    try {
      const res = await notifyLateStartCustomerAdmin(b.id);
      if (res?.error) {
        setToast(`Gagal mengirim kabar: ${res.error}`);
      } else {
        setToast(`Pelanggan pesanan ${b.code} sudah dikabari — push berisi status penanganan dikirim.`);
      }
    } finally {
      setBusyLate(null);
    }
  }

  /** Lepas teknisi yang belum mulai agar pesanan bisa ditugaskan ulang. */
  async function lepasTeknisi(b) {
    const yakin = window.confirm(
      `Lepas ${b.technician?.name || "teknisi"} dari pesanan ${b.code}?\n\nPesanan kembali ke daftar Tersedia, teknisi dan pelanggan menerima pemberitahuan. Gunakan ini hanya bila teknisi benar-benar tidak bisa datang.`
    );
    if (!yakin) return;
    setBusyLate(`release:${b.id}`);
    setToast("");
    try {
      const res = await releaseLateTechnicianAdmin(
        b.id,
        `Terlambat mulai ${formatTerlambat(b.menit_terlambat)} — dilepas admin`
      );
      if (res?.error) {
        setToast(`Gagal melepas tugas: ${res.error}`);
      } else {
        setToast(`Tugas ${b.code} dilepas. Pelanggan sudah diberi tahu bahwa teknisi pengganti sedang dicarikan.`);
        await muatUlang();
      }
    } finally {
      setBusyLate(null);
    }
  }

  if (error) {
    return (
      <p className="card text-sm text-coral">
        Gagal memuat papan harian: {error}
      </p>
    );
  }

  if (!board) {
    return (
      <div className="card text-center py-8 text-sm text-ink-soft">
        <p>Papan harian belum terbaca.</p>
        <button onClick={muatUlang} disabled={loading} className="btn-outline !py-2 !px-3 text-xs mt-3">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Coba muat
        </button>
      </div>
    );
  }

  const c = board.counts || {};
  const rilisPerluTindak = (board.rilis || []).filter((r) => r.perluTeknisiBaru);
  const piutangJatuhTempo = board.piutang?.jatuhTempo || [];
  const piutangAmbang = board.piutang?.ambangHari ?? 30;
  const piutangNominal = piutangJatuhTempo.reduce((s, r) => s + Number(r.total || 0), 0);
  const terlambat = board.terlambat || [];
  // Hanya yang BELUM dijawab pelanggan yang dihitung sebagai tugas; riwayat
  // "sudah dijawab" tetap ditampilkan sebagai konteks di bagiannya.
  const tidakAda = board.tidakAda || [];
  const tidakAdaMenunggu = tidakAda.filter((b) => !b.customer_present_at);
  const tidakAdaYangPerluTindak =
    (board.perluTeknisi || []).length === 0 &&
    (board.menungguBayar || []).length === 0 &&
    rilisPerluTindak.length === 0 &&
    piutangJatuhTempo.length === 0 &&
    terlambat.length === 0 &&
    tidakAdaMenunggu.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-navy flex items-center gap-2">
            <CalendarDays size={15} /> {tanggalPanjang(board.hariIni)}
          </p>
          <p className="text-xs text-ink-soft mt-0.5">
            Hanya memuat hal yang perlu ditindaklanjuti — riwayat lengkap ada di tab Pesanan.
          </p>
        </div>
        <button onClick={muatUlang} disabled={loading} className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 shrink-0">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Muat ulang
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kartu
          label="Terlambat mulai"
          nilai={c.terlambat ?? terlambat.length}
          icon={TimerOff}
          tone={terlambat.length ? "coral" : "navy"}
          catatan={terlambat.length ? "sudah lewat 15 menit dari awal slot" : "semua teknisi mulai tepat waktu"}
        />
        <Kartu label="Perlu teknisi" nilai={c.perluTeknisi ?? 0} icon={UserX} tone={c.perluTeknisi ? "coral" : "navy"} />
        <Kartu label="Menunggu konfirmasi bayar" nilai={c.menungguBayar ?? 0} icon={Wallet} tone={c.menungguBayar ? "amber" : "navy"} />
        <Kartu
          label="Dikerjakan hari ini"
          nilai={c.dikerjakan ?? 0}
          icon={Wrench}
          tone="brand"
          catatan={`Selesai: ${c.selesai ?? 0} · Dibatalkan: ${c.dibatalkan ?? 0}`}
        />
        <Kartu
          label="Dilepas teknisi"
          nilai={c.rilisPerluTindak ?? 0}
          icon={AlertTriangle}
          tone={c.rilisPerluTindak ? "coral" : "navy"}
          catatan={`dari ${(board.rilis || []).length} catatan terakhir`}
        />
        <Kartu
          label="Pelanggan tidak ada"
          nilai={c.tidakAda ?? tidakAdaMenunggu.length}
          icon={UserX}
          tone={tidakAdaMenunggu.length ? "coral" : "navy"}
          catatan={tidakAdaMenunggu.length ? "menunggu jawaban pelanggan" : "tidak ada laporan menunggu"}
        />
        <Kartu
          label="Piutang jatuh tempo"
          nilai={c.piutangJatuhTempo ?? piutangJatuhTempo.length}
          icon={TrendingDown}
          tone={piutangJatuhTempo.length ? "coral" : "navy"}
          catatan={`${formatRupiah(piutangNominal)} belum tertutup · > ${piutangAmbang} hari`}
        />
      </div>

      {toast && (
        <div className="rounded-xl bg-brand-tint/60 border border-brand/30 text-navy text-sm px-4 py-2.5">
          {toast}
        </div>
      )}

      {tidakAdaYangPerluTindak ? (
        <div className="card text-center py-8">
          <p className="text-sm font-semibold text-mint">Tidak ada yang perlu ditindaklanjuti.</p>
          <p className="text-xs text-ink-soft mt-1">
            Semua pesanan sudah bergerak: ada teknisi, atau sudah dibayar. Jadwal hari ini tetap tercatat di bawah.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card">
            <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-2">
              <UserX size={15} className="text-coral" /> Sudah dibayar, belum ada teknisi ({(board.perluTeknisi || []).length})
            </p>
            <p className="text-xs text-ink-soft mb-2">
              Teknisi bisa mengambil sendiri dari aplikasi. Tugaskan manual bila tak kunjung diambil.
            </p>
            {(board.perluTeknisi || []).length === 0 ? (
              <p className="text-xs text-ink-soft py-3">Tidak ada.</p>
            ) : (
              (board.perluTeknisi || []).slice(0, 8).map((b) => (
                <BarisPesanan
                  key={b.id}
                  b={b}
                  aksi={
                    onOpenBookings && (
                      <button onClick={() => onOpenBookings(b.id)} className="btn-outline !py-1.5 !px-2.5 text-xs">
                        Tugaskan
                      </button>
                    )
                  }
                />
              ))
            )}
            {(board.perluTeknisi || []).length > 8 && (
              <p className="text-[11px] text-ink-soft mt-2">+{(board.perluTeknisi || []).length - 8} lagi — lihat tab Pesanan.</p>
            )}
          </div>

          <div className="card">
            <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-2">
              <Wallet size={15} className="text-amber" /> Menunggu konfirmasi bayar ({(board.menungguBayar || []).length})
            </p>
            <p className="text-xs text-ink-soft mb-2">Pesanan transfer yang belum dikonfirmasi. COD tidak muncul di sini.</p>
            {(board.menungguBayar || []).length === 0 ? (
              <p className="text-xs text-ink-soft py-3">Tidak ada.</p>
            ) : (
              (board.menungguBayar || []).slice(0, 8).map((b) => (
                <BarisPesanan
                  key={b.id}
                  b={b}
                  aksi={
                    onOpenBookings && (
                      <button onClick={() => onOpenBookings(b.id)} className="btn-outline !py-1.5 !px-2.5 text-xs">
                        Buka
                      </button>
                    )
                  }
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== Pelanggan tidak ada di lokasi ===== */}
      <div className={`card ${tidakAdaMenunggu.length ? "border-coral/50" : ""}`}>
        <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-2">
          <UserX size={15} className={tidakAdaMenunggu.length ? "text-coral" : "text-ink-soft"} /> Pelanggan tidak ada di lokasi
          {tidakAda.length > 0 && (
            <span className="pill bg-coral-tint text-coral text-xs font-bold">{tidakAda.length}</span>
          )}
        </p>
        {tidakAda.length === 0 ? (
          <p className="text-xs text-ink-soft py-2">
            Tidak ada laporan. Teknisi hanya bisa melapor setelah slot mulai + 15 menit, dan laporannya membawa waktu,
            koordinat, serta foto lokasi bila dilampirkan.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-soft">
              Pelanggan menerima push untuk menekan &quot;Saya di sini&quot;. Bila tetap tidak ada, hubungi pelanggan
              lalu putuskan penugasan lewat tab Pesanan.
            </p>
            {tidakAda.map((b) => (
              <div key={b.id} className="rounded-xl border border-line bg-paper p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="pill bg-brand-tint text-brand-deep font-bold text-xs">#{b.code}</span>
                  <span className="text-sm font-semibold text-navy">{serviceLabel(b)}</span>
                  {b.customer_present_at ? (
                    <span className="pill bg-mint-tint text-mint text-xs font-bold">Pelanggan sudah hadir</span>
                  ) : (
                    <span className="pill bg-amber-tint text-amber text-xs font-bold">Menunggu pelanggan</span>
                  )}
                </div>
                <p className="text-xs text-ink-soft mt-1 flex items-center gap-1.5 flex-wrap">
                  <UserRound size={12} /> {b.customer?.name || "Pelanggan"}
                  {b.technician?.name ? ` · Teknisi: ${b.technician.name}` : ""}
                </p>
                <p className="text-xs text-ink-soft">
                  Dilaporkan {waktuSingkat(b.no_show_at)} · Slot {b.booking_time} · {b.address || "alamat belum diisi"}
                </p>
                {b.no_show_note && (
                  <p className="text-[11px] italic text-ink-soft mt-1">&ldquo;{b.no_show_note}&rdquo;</p>
                )}
                {b.customer_present_at && (
                  <p className="text-[11px] text-mint mt-1">
                    Pelanggan menandai hadir {waktuSingkat(b.customer_present_at)}.
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px]">
                  {b.customer?.phone && (
                    <a href={`tel:${b.customer.phone}`} className="text-brand-deep font-semibold">
                      Telepon pelanggan
                    </a>
                  )}
                  {b.foto_url && (
                    <a href={b.foto_url} target="_blank" rel="noopener noreferrer" className="text-brand-deep font-semibold">
                      Lihat foto lokasi
                    </a>
                  )}
                  {b.no_show_lat != null && b.no_show_lng != null && (
                    <a
                      href={`https://www.google.com/maps?q=${b.no_show_lat},${b.no_show_lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-deep font-semibold"
                    >
                      Titik laporan
                    </a>
                  )}
                  {onOpenBookings && (
                    <button onClick={() => onOpenBookings(b.id)} className="btn-outline !py-1 !px-2 text-[11px]">
                      Buka pesanan
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Terlambat mulai ===== */}
      <div className={`card ${terlambat.length ? "border-coral/50" : ""}`}>
        <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-2">
          <TimerOff size={15} className={terlambat.length ? "text-coral" : "text-ink-soft"} /> Terlambat mulai
          {terlambat.length > 0 && (
            <span className="pill bg-coral-tint text-coral text-xs font-bold">{terlambat.length}</span>
          )}
        </p>
        {terlambat.length === 0 ? (
          <p className="text-xs text-ink-soft py-2">
            Tidak ada. Pesanan dianggap terlambat bila slot sudah berjalan lebih dari 15 menit dan teknisi belum
            menekan &quot;Mulai&quot; — sinyal yang juga dipakai kartu skor.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-soft">
              Pelanggan sedang menunggu. Hubungi teknisi lebih dulu; bila tidak bisa datang, lepas tugasnya supaya bisa
              ditugaskan ke pengganti.
            </p>
            {terlambat.map((b) => (
              <div key={b.id} className="rounded-xl border border-coral/40 bg-coral-tint/30 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="pill bg-brand-tint text-brand-deep font-bold text-xs">#{b.code}</span>
                  <span className="text-sm font-semibold text-navy">{serviceLabel(b)}</span>
                  <span className="pill bg-coral-tint text-coral text-xs font-bold">
                    {formatTerlambat(b.menit_terlambat)} terlambat
                  </span>
                </div>
                <p className="text-xs text-ink-soft mt-1 flex items-center gap-1.5 flex-wrap">
                  <UserRound size={12} /> {b.customer?.name || "Pelanggan"}
                  {b.customer?.phone && <span>· {b.customer.phone}</span>}
                  {b.technician?.name ? ` · Teknisi: ${b.technician.name}` : " · Teknisi belum ada"}
                </p>
                <p className="text-xs text-ink-soft">
                  Slot {b.booking_time} · {b.address || "alamat belum diisi"}
                </p>
                {(b.customer?.phone || b.technician?.phone) && (
                  <p className="text-[11px] mt-1 flex items-center gap-3 flex-wrap">
                    {b.customer?.phone && (
                      <a href={`tel:${b.customer.phone}`} className="text-brand-deep font-semibold">
                        Telepon pelanggan
                      </a>
                    )}
                    {b.technician?.phone && (
                      <a href={`tel:${b.technician.phone}`} className="text-brand-deep font-semibold">
                        Hubungi teknisi
                      </a>
                    )}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => beriTahuPelanggan(b)}
                    disabled={busyLate === `notify:${b.id}`}
                    className="btn-outline !py-1.5 !px-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {busyLate === `notify:${b.id}` ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Send size={12} />
                    )}
                    Beri tahu pelanggan
                  </button>
                  {b.technician_id && (
                    <button
                      type="button"
                      onClick={() => lepasTeknisi(b)}
                      disabled={busyLate === `release:${b.id}`}
                      className="btn-outline !py-1.5 !px-2.5 text-xs flex items-center gap-1.5 text-coral border-coral/40 disabled:opacity-50"
                    >
                      {busyLate === `release:${b.id}` ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <UserMinus size={12} />
                      )}
                      Lepas & cari pengganti
                    </button>
                  )}
                  {onOpenBookings && (
                    <button
                      type="button"
                      onClick={() => onOpenBookings(b.id)}
                      className="btn-outline !py-1.5 !px-2.5 text-xs"
                    >
                      Tugaskan pengganti
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Piutang teknisi yang menua ===== */}
      <div className={`card ${piutangJatuhTempo.length ? "border-coral/50" : ""}`}>
        <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-2">
          <Clock size={15} className={piutangJatuhTempo.length ? "text-coral" : "text-ink-soft"} /> Piutang teknisi perlu tindak
          {piutangJatuhTempo.length > 0 && (
            <span className="pill bg-coral-tint text-coral text-xs font-bold">{piutangJatuhTempo.length}</span>
          )}
        </p>
        {board.piutangError ? (
          <p className="text-xs text-coral">{board.piutangError}</p>
        ) : piutangJatuhTempo.length === 0 ? (
          <p className="text-xs text-ink-soft py-2">
            Tidak ada piutang lewat {piutangAmbang} hari. Saldo minus yang belum jatuh tempo tetap terlihat di tab Saldo Aktif.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-soft">
              Teknisi ini tidak akan melunasi sendiri (mis. sudah berhenti). Ingatkan setor, atau lanjut ke tab Saldo Aktif
              untuk mengajukan penghapusan — penghapusan berlaku setelah diputuskan admin.
            </p>
            {piutangJatuhTempo.slice(0, 10).map((r) => (
              <div key={r.id} className="rounded-xl border border-coral/40 bg-coral-tint/30 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-navy flex items-center gap-1.5">
                    <ShieldAlert size={13} className="text-coral" /> {r.nama}
                  </span>
                  <span className="pill bg-coral-tint text-coral text-xs font-bold">
                    {formatRupiah(r.jatuhTempo?.total ?? r.total)} terlewat
                  </span>
                  {!r.masihAktif && <span className="pill bg-white text-ink-soft text-xs">tidak aktif</span>}
                </div>
                <p className="text-xs text-ink-soft mt-1">
                  Piutang terbuka {formatRupiah(r.total)} · tertua {r.tertua} hari · {r.baris} baris pesanan
                  {r.reminder_terakhir ? ` · diingatkan ${waktuSingkat(r.reminder_terakhir)}` : " · belum pernah diingatkan"}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => ingatkan(r)}
                    disabled={remindingId === r.id}
                    className="btn-outline !py-1.5 !px-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {remindingId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />} Ingatkan setor
                  </button>
                  {onOpenBalances && (
                    <button type="button" onClick={onOpenBalances} className="btn-outline !py-1.5 !px-2.5 text-xs flex items-center gap-1.5">
                      <TrendingDown size={12} /> Kelola / hapuskan
                    </button>
                  )}
                </div>
              </div>
            ))}
            {piutangJatuhTempo.length > 10 && (
              <p className="text-[11px] text-ink-soft">+{piutangJatuhTempo.length - 10} teknisi lain — lihat tab Saldo Aktif.</p>
            )}
          </div>
        )}
      </div>

      {/* ===== Pelepasan tugas ===== */}
      <div className="card">
        <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-2">
          <AlertTriangle size={15} className={rilisPerluTindak.length ? "text-coral" : "text-ink-soft"} />
          Tugas yang dilepas teknisi
        </p>
        {board.rilisError ? (
          <p className="text-xs text-coral">{board.rilisError}</p>
        ) : (board.rilis || []).length === 0 ? (
          <p className="text-xs text-ink-soft py-2">
            Belum ada tugas yang dilepas. Catatan muncul di sini saat teknisi menekan &quot;Lepas&quot; beserta alasannya.
          </p>
        ) : (
          <div className="space-y-2">
            {board.rilis.slice(0, 10).map((r) => (
              <div
                key={r.id}
                className={`rounded-xl border p-3 ${r.perluTeknisiBaru ? "border-coral/50 bg-coral-tint/40" : "border-line"}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="pill bg-brand-tint text-brand-deep font-bold text-xs">#{r.booking?.code || "?"}</span>
                  <span className="text-sm font-semibold text-navy">{serviceLabel(r.booking)}</span>
                  {r.perluTeknisiBaru ? (
                    <span className="pill bg-coral-tint text-coral text-xs font-bold">Perlu teknisi baru</span>
                  ) : (
                    <span className="pill bg-mint-tint text-mint text-xs">Sudah ditangani</span>
                  )}
                </div>
                <p className="text-xs text-ink-soft mt-1 flex items-center gap-1.5">
                  <UserRound size={12} /> {r.technician?.name || "Teknisi"} · dilepas {waktuSingkat(r.created_at)}
                  {r.booking?.booking_date ? ` · jadwal ${r.booking.booking_date} ${r.booking.booking_time || ""}` : ""}
                </p>
                <p className="text-xs text-ink mt-1 italic">&ldquo;{r.reason}&rdquo;</p>
                {r.perluTeknisiBaru && onOpenBookings && (
                  <button onClick={() => onOpenBookings(r.booking_id)} className="btn-outline !py-1.5 !px-2.5 text-xs mt-2">
                    Tugaskan teknisi
                  </button>
                )}
              </div>
            ))}
            {(board.rilis || []).length > 10 && (
              <p className="text-[11px] text-ink-soft">+{(board.rilis || []).length - 10} catatan lebih lama tidak ditampilkan.</p>
            )}
          </div>
        )}
      </div>

      {/* ===== Jadwal hari ini ===== */}
      <div className="card">
        <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-2">
          <ClipboardList size={15} /> Jadwal hari ini ({(board.jadwal || []).length})
        </p>
        {(board.jadwal || []).length === 0 ? (
          <p className="text-xs text-ink-soft py-3">Tidak ada pesanan berjadwal hari ini.</p>
        ) : (
          (board.jadwal || []).map((b) => <BarisPesanan key={b.id} b={b} />)
        )}
      </div>
    </div>
  );
}
