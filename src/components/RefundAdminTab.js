"use client";

import { useEffect, useRef, useState } from "react";
import {
  completeBookingRefundAdmin,
  createBookingRefundAdmin,
  getBookingRefundsAdmin,
  rejectBookingRefundAdmin,
} from "@/app/actions/admin";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/pricing";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  HandCoins,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";

const BUCKET = "refund-proofs";

const LABEL_STATUS = {
  pending: { text: "Menunggu transfer", cls: "bg-amber-tint text-amber" },
  done: { text: "Dana dikembalikan", cls: "bg-mint-tint text-mint" },
  rejected: { text: "Ditolak", cls: "bg-coral-tint text-coral" },
};

function waktu(iso) {
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

/**
 * Tab "Refund" panel admin — antrean pengembalian dana pelanggan.
 *
 * Kenapa tab sendiri: pembatalan pesanan yang sudah dibayar membuat KEWAJIBAN
 * uang keluar (supabase/migrate-booking-refunds.sql). Tanpa tempat memutuskan,
 * kewajiban itu hanya terlihat sebagai pesanan "dibatalkan" dan uangnya
 * dikembalikan di luar sistem tanpa jejak.
 *
 * Aturan yang dipegang tab ini:
 *   * satu pesanan = satu baris refund (unique index) — tombol catat manual
 *     hanya menawarkan pesanan yang belum punya baris refund;
 *   * `payment_confirmed = false` berarti bukti bayar pelanggan BELUM
 *     dikonfirmasi admin saat pembatalan — periksa dulu sebelum transfer;
 *   * menyelesaikan refund WAJIB dua langkah (tombol → konfirmasi), karena
 *     tindakan ini menyatakan uang benar-benar sudah keluar;
 *   * bukti transfer balik disimpan di bucket privat `refund-proofs`; pelanggan
 *     pemilik pesanan bisa membukanya, orang lain tidak.
 */
export default function RefundAdminTab({ bookings = [], onChanged }) {
  const [loading, setLoading] = useState(true);
  const [refunds, setRefunds] = useState([]);
  const [ringkasan, setRingkasan] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [pesan, setPesan] = useState(null); // { type, text }
  const [busyId, setBusyId] = useState(null);
  const [konfirmasi, setKonfirmasi] = useState(null); // id refund yang menunggu konfirmasi
  const [catatan, setCatatan] = useState({}); // { [id]: catatan transfer }
  const [alasanTolak, setAlasanTolak] = useState({}); // { [id]: alasan }
  const [bukti, setBukti] = useState({}); // { [id]: path objek yang baru diunggah }
  const [mengunggah, setMengunggah] = useState(null);
  // Satu input file dipakai bersama semua kartu: ref dipasang SEKALI di sini,
  // bukan di dalam daftar (ref yang dipakai banyak elemen hanya menunjuk yang
  // terakhir dirender, sehingga tombol kartu lain bisa mengunggah ke refund
  // yang salah).
  const unggahUntuk = useRef(null);
  const inputBukti = useRef(null);

  async function muat() {
    const res = await getBookingRefundsAdmin();
    if (res.error) {
      setError(res.error);
      setRefunds([]);
      setRingkasan(null);
      return;
    }
    setError(null);
    setRefunds(res.refunds || []);
    setRingkasan(res.ringkasan || null);
  }

  useEffect(() => {
    let hidup = true;
    (async () => {
      const res = await getBookingRefundsAdmin();
      if (!hidup) return;
      if (res.error) {
        setError(res.error);
        setRefunds([]);
        setRingkasan(null);
      } else {
        setError(null);
        setRefunds(res.refunds || []);
        setRingkasan(res.ringkasan || null);
      }
      setLoading(false);
    })();
    return () => {
      hidup = false;
    };
  }, []);

  async function muatUlang() {
    setLoading(true);
    await muat();
    setLoading(false);
  }

  /** Unggah bukti transfer balik ke bucket privat; simpan PATH, bukan URL. */
  async function unggahBukti(refundId, file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setPesan({ type: "error", text: "Bukti harus JPG, PNG, atau WebP." });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPesan({ type: "error", text: "Ukuran bukti maksimal 10 MB." });
      return;
    }
    setMengunggah(refundId);
    setPesan(null);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${refundId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setPesan({
          type: "error",
          text: `Gagal mengunggah bukti: ${upErr.message}. Pastikan migrasi refund sudah dijalankan.`,
        });
        return;
      }
      setBukti((prev) => ({ ...prev, [refundId]: path }));
      setPesan({ type: "ok", text: "Bukti transfer balik terunggah — simpan keputusan untuk melampirkannya." });
    } finally {
      setMengunggah(null);
    }
  }

  async function selesaikan(r) {
    setBusyId(r.id);
    setPesan(null);
    const res = await completeBookingRefundAdmin(r.id, {
      proofPath: bukti[r.id],
      note: catatan[r.id],
    });
    setBusyId(null);
    setKonfirmasi(null);
    if (res.error) {
      setPesan({ type: "error", text: res.error });
      return;
    }
    setPesan({
      type: "ok",
      text: `Pengembalian ${formatRupiah(r.amount)} untuk ${r.bookings?.code || "pesanan"} ditandai sudah ditransfer. Pelanggan menerima notifikasi.`,
    });
    await muat();
    onChanged?.();
  }

  async function tolak(r) {
    const alasan = (alasanTolak[r.id] || "").trim();
    if (alasan.length < 5) {
      setPesan({ type: "error", text: "Tulis alasan penolakan (minimal 5 karakter)." });
      return;
    }
    setBusyId(r.id);
    setPesan(null);
    const res = await rejectBookingRefundAdmin(r.id, alasan);
    setBusyId(null);
    if (res.error) {
      setPesan({ type: "error", text: res.error });
      return;
    }
    setPesan({ type: "ok", text: "Pengembalian ditolak — pelanggan menerima alasannya." });
    await muat();
    onChanged?.();
  }

  const daftar = filter === "semua" ? refunds : refunds.filter((r) => r.status === filter);
  const jumlah = (s) => refunds.filter((r) => r.status === s).length;
  const sudahAdaRefund = new Set(refunds.map((r) => r.booking_id));
  const kandidatManual = (bookings || []).filter(
    (b) => b.status === "cancelled" && !sudahAdaRefund.has(b.id)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-ink-soft max-w-2xl">
          Uang pelanggan yang harus kembali karena pembatalan. Baris dibuat otomatis saat pelanggan
          atau admin membatalkan pesanan yang sudah dibayar, dan bisa dicatat manual untuk pesanan
          lama. Menandai <strong>dana dikembalikan</strong> berarti uang benar-benar sudah
          ditransfer — lakukan setelah transfer, bukan sebelum.
        </p>
        <button
          onClick={muatUlang}
          disabled={loading}
          className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 shrink-0"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Muat ulang
        </button>
      </div>

      {ringkasan && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              label: "Menunggu transfer",
              value: ringkasan.pendingAmount,
              sub: `${ringkasan.pendingCount} pesanan`,
              cls: "text-amber",
              icon: HandCoins,
            },
            {
              label: "Sudah dikembalikan",
              value: ringkasan.doneTotal,
              sub: `Bulan ini ${formatRupiah(ringkasan.donePeriode)}`,
              cls: "text-mint",
              icon: CheckCircle2,
            },
            {
              label: "Ditolak",
              value: ringkasan.rejectedCount,
              sub: "Tidak ada uang keluar",
              cls: "text-coral",
              icon: X,
            },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className="card !p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft flex items-center gap-1.5">
                  <Icon size={13} className={c.cls} /> {c.label}
                </p>
                <p className={`font-display text-xl font-bold mt-1.5 ${c.cls}`}>
                  {c.label === "Ditolak" ? c.value : formatRupiah(c.value)}
                </p>
                <p className="text-[11px] text-ink-soft mt-1">{c.sub}</p>
              </div>
            );
          })}
        </div>
      )}

      {ringkasan?.migrasiJalan === false && (
        <p className="card !p-3 text-xs text-amber">
          Ringkasan refund belum tersedia — jalankan <code>supabase/migrate-booking-refunds.sql</code>.
        </p>
      )}

      {error && <p className="card text-sm text-coral">{error}</p>}
      {pesan && (
        <p className={`card !p-3 text-sm ${pesan.type === "error" ? "text-coral" : "text-mint"}`}>
          {pesan.text}
        </p>
      )}

      <input
        ref={inputBukti}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const target = unggahUntuk.current;
          unggahUntuk.current = null;
          if (target) unggahBukti(target, file);
        }}
      />

      <div className="flex gap-2 flex-wrap">
        {[
          { id: "pending", label: `Menunggu${jumlah("pending") ? ` (${jumlah("pending")})` : ""}` },
          { id: "done", label: "Dikembalikan" },
          { id: "rejected", label: "Ditolak" },
          { id: "semua", label: "Semua" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border-2 ${
              filter === f.id ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && refunds.length === 0 ? (
        <p className="card text-sm text-ink-soft flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Memuat pengembalian dana…
        </p>
      ) : daftar.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-ink-soft">
            {filter === "pending"
              ? "Tidak ada pengembalian dana yang menunggu transfer."
              : "Tidak ada pengembalian dana pada filter ini."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {daftar.map((r) => {
            const st = LABEL_STATUS[r.status] || { text: r.status, cls: "bg-surface-2 text-ink-soft" };
            const pelanggan = r.bookings?.profiles;
            return (
              <div key={r.id} className="card !p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="pill bg-brand-tint text-brand-deep font-bold text-xs">
                        #{r.bookings?.code || "?"}
                      </span>
                      <span className="font-display font-bold text-navy">{formatRupiah(r.amount)}</span>
                      <span className={`pill ${st.cls} text-xs font-bold`}>{st.text}</span>
                      <span className="pill bg-surface-2 text-ink-soft text-[11px]">
                        {r.source === "cancel" ? "Dari pembatalan pelanggan" : "Dicatat admin"}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft mt-1">
                      Pelanggan: {pelanggan?.name || "-"}
                      {pelanggan?.phone ? ` · ${pelanggan.phone}` : ""}
                      {pelanggan?.email ? ` · ${pelanggan.email}` : ""}
                    </p>
                    <p className="text-xs text-ink-soft">
                      Pesanan {r.bookings?.booking_date || "-"} {r.bookings?.booking_time || ""} ·{" "}
                      {r.bookings?.address || "-"}
                    </p>
                    <p className="text-xs text-ink mt-1 italic">&ldquo;{r.reason}&rdquo;</p>
                    <p className="text-[11px] text-ink-soft mt-1">
                      Dicatat {waktu(r.created_at)}
                      {r.created_by_admin?.name ? ` oleh ${r.created_by_admin.name}` : ""}
                      {r.decided_at
                        ? ` · diputuskan ${waktu(r.decided_at)}${r.decided_by_admin?.name ? ` oleh ${r.decided_by_admin.name}` : ""}`
                        : ""}
                    </p>
                    {r.status === "rejected" && r.rejection_reason && (
                      <p className="text-xs text-coral mt-1">Alasan penolakan: {r.rejection_reason}</p>
                    )}
                    {r.note && <p className="text-xs text-ink-soft mt-1">Catatan: {r.note}</p>}
                    {r.proof_url && (
                      <a
                        href={r.proof_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-brand font-semibold mt-1.5 underline"
                      >
                        <ExternalLink size={12} /> Bukti transfer balik
                      </a>
                    )}
                  </div>
                  {!r.payment_confirmed && r.status === "pending" && (
                    <span className="pill bg-amber-tint text-amber text-[11px] font-bold shrink-0 flex items-center gap-1">
                      <AlertTriangle size={12} /> Bukti bayar belum dikonfirmasi
                    </span>
                  )}
                </div>

                {r.status === "pending" && (
                  <div className="mt-3 pt-3 border-t border-line space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                          Catatan transfer (opsional)
                        </label>
                        <input
                          type="text"
                          className="input mt-1"
                          placeholder="mis. BCA 24 Okt 14:02, no. referensi 8821"
                          value={catatan[r.id] ?? ""}
                          onChange={(e) => setCatatan((p) => ({ ...p, [r.id]: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                          Alasan penolakan (bila tidak dikembalikan)
                        </label>
                        <input
                          type="text"
                          className="input mt-1"
                          placeholder="mis. bukti bayar tidak ditemukan di mutasi"
                          value={alasanTolak[r.id] ?? ""}
                          onChange={(e) => setAlasanTolak((p) => ({ ...p, [r.id]: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {konfirmasi === r.id ? (
                        <>
                          <span className="text-xs font-semibold text-coral">
                            Pastikan {formatRupiah(r.amount)} sudah benar-benar ditransfer ke pelanggan.
                          </span>
                          <button
                            onClick={() => selesaikan(r)}
                            disabled={busyId === r.id}
                            className="btn-primary !py-2 !px-3 text-xs flex items-center gap-1.5"
                          >
                            {busyId === r.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            Ya, dana sudah dikirim
                          </button>
                          <button
                            onClick={() => setKonfirmasi(null)}
                            className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5"
                          >
                            <RotateCcw size={13} /> Batal
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              unggahUntuk.current = r.id;
                              inputBukti.current?.click();
                            }}
                            disabled={mengunggah === r.id}
                            className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5"
                            title="Lampirkan bukti transfer balik (opsional)"
                          >
                            {mengunggah === r.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <ImagePlus size={14} />
                            )}
                            {bukti[r.id] ? "Ganti bukti" : "Lampirkan bukti"}
                          </button>
                          <button
                            onClick={() => setKonfirmasi(r.id)}
                            className="btn-primary !py-2 !px-3 text-xs flex items-center gap-1.5"
                          >
                            <CheckCircle2 size={14} /> Dana sudah dikembalikan
                          </button>
                          <button
                            onClick={() => tolak(r)}
                            disabled={busyId === r.id}
                            className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 !border-coral !text-coral"
                          >
                            <X size={14} /> Tolak
                          </button>
                          {bukti[r.id] && (
                            <span className="text-[11px] text-mint font-medium">Bukti siap dilampirkan</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CatatManual
        bookings={kandidatManual}
        onDone={async (text) => {
          setPesan({ type: "ok", text });
          await muat();
          onChanged?.();
        }}
        onError={(text) => setPesan({ type: "error", text })}
      />
    </div>
  );
}

/** Catat refund manual untuk pesanan batal yang belum punya baris refund. */
function CatatManual({ bookings, onDone, onError }) {
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [sibuk, setSibuk] = useState(false);

  const dipilih = bookings.find((b) => b.id === bookingId) || null;

  async function kirim() {
    if (!dipilih) {
      onError("Pilih pesanan yang dibatalkan lebih dulu.");
      return;
    }
    setSibuk(true);
    const res = await createBookingRefundAdmin(bookingId, {
      amount: amount || dipilih.total_price,
      reason,
    });
    setSibuk(false);
    if (res.error) {
      onError(res.error);
      return;
    }
    if (res.sudahAda) {
      onError("Pesanan ini sudah punya catatan pengembalian dana.");
    } else {
      onDone(`Pengembalian ${formatRupiah(res.refund?.amount || amount)} untuk ${dipilih.code} dicatat.`);
    }
    setBookingId("");
    setAmount("");
    setReason("");
  }

  return (
    <div className="card !p-4 space-y-3">
      <div>
        <p className="font-semibold text-navy flex items-center gap-2">
          <HandCoins size={16} /> Catat pengembalian manual
        </p>
        <p className="text-xs text-ink-soft mt-1">
          Untuk pesanan yang dibatalkan sebelum alur ini dipasang, atau kesepakatan di luar pembatalan.
          Hanya pesanan berstatus <strong>dibatalkan</strong> yang belum punya catatan refund yang
          ditawarkan — satu pesanan tidak bisa direfund dua kali.
        </p>
      </div>

      {bookings.length === 0 ? (
        <p className="text-xs text-ink-soft">
          Semua pesanan yang dibatalkan sudah punya catatan pengembalian dana.
        </p>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                Pesanan dibatalkan
              </label>
              <select
                className="input mt-1"
                value={bookingId}
                onChange={(e) => {
                  setBookingId(e.target.value);
                  const b = bookings.find((x) => x.id === e.target.value);
                  setAmount(b ? String(b.total_price || "") : "");
                }}
              >
                <option value="">— pilih pesanan —</option>
                {bookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.code} · {b.services?.name || "Layanan"} · {formatRupiah(b.total_price)} ·{" "}
                    {b.booking_date || "-"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                Nominal (Rp)
              </label>
              <input
                className="input mt-1"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder={dipilih ? String(dipilih.total_price ?? "") : "0"}
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
              Alasan (terlihat pelanggan)
            </label>
            <input
              className="input mt-1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. pesanan dibatalkan setelah pembayaran dikonfirmasi"
            />
          </div>
          <button
            onClick={kirim}
            disabled={sibuk || !dipilih || reason.trim().length < 5}
            className="btn-primary !py-2 !px-4 text-xs flex items-center gap-1.5"
          >
            {sibuk ? <Loader2 size={13} className="animate-spin" /> : <HandCoins size={14} />}
            Catat pengembalian
          </button>
        </>
      )}
    </div>
  );
}
