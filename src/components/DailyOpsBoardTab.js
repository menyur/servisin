"use client";

import { useState } from "react";
import { getDailyOpsBoardAdmin } from "@/app/actions/admin";
import { StatusPill } from "@/components/StatusPipeline";
import { formatRupiah } from "@/lib/pricing";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  Loader2,
  RefreshCw,
  UserRound,
  UserX,
  Wallet,
  Wrench,
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
          <span className="text-sm font-semibold text-navy truncate">{b.services?.name || "Layanan"}</span>
          <StatusPill status={b.status} />
        </div>
        <p className="text-xs text-ink-soft mt-0.5 truncate">
          {b.booking_time} · {b.address || "-"}
        </p>
        <p className="text-xs text-ink-soft">
          Pelanggan: {b.customer?.name || "-"}
          {b.technician?.name ? ` · Teknisi: ${b.technician.name}` : ""}
        </p>
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
 */
export default function DailyOpsBoardTab({ board: boardAwal = null, error: errorAwal = null, onOpenBookings }) {
  const [board, setBoard] = useState(boardAwal);
  const [error, setError] = useState(errorAwal);
  const [loading, setLoading] = useState(false);

  async function muatUlang() {
    setLoading(true);
    setError(null);
    const res = await getDailyOpsBoardAdmin();
    setLoading(false);
    if (res.error) setError(res.error);
    else setBoard(res.board);
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
  const tidakAdaYangPerluTindak =
    (board.perluTeknisi || []).length === 0 &&
    (board.menungguBayar || []).length === 0 &&
    rilisPerluTindak.length === 0;

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      </div>

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
                  <span className="text-sm font-semibold text-navy">{r.booking?.services?.name || "Layanan"}</span>
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
