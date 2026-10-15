"use client";

import { useEffect, useState } from "react";
import {
  decideWarrantyClaimAdmin,
  getWarrantyClaimsAdmin,
} from "@/app/actions/admin";
import { TIME_SLOTS, slotLabel } from "@/lib/booking-slots";
import { formatRupiah } from "@/lib/pricing";
import { Check, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";

/** Besok menurut WIB — dipakai sebagai usulan jadwal kunjungan ulang. */
function besokWib() {
  const besok = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(besok);
}

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

const LABEL_STATUS = {
  open: { text: "Menunggu keputusan", cls: "bg-amber-tint text-amber" },
  approved: { text: "Disetujui", cls: "bg-mint-tint text-mint" },
  rejected: { text: "Ditolak", cls: "bg-coral-tint text-coral" },
};

/**
 * Tab "Garansi": klaim garansi pekerjaan dari pelanggan.
 *
 * Alurnya: pelanggan mengajukan klaim dari aplikasi untuk pesanan yang sudah
 * selesai dan masih dalam masa garansi layanan; admin memutuskan di sini.
 * MENYETUJUI berarti sistem membuatkan kunjungan ulang BERHARGA 0 yang
 * langsung ditugaskan ke teknisi yang mengerjakan pesanan asalnya — jadi
 * garansi tidak menambah pekerjaan penjadwalan manual, dan komisi teknisi
 * tidak terpotong (biaya garansi ditanggung platform; lihat
 * supabase/migrate-warranty-claims.sql).
 */
export default function WarrantyClaimsAdminTab() {
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("open");
  const [busyId, setBusyId] = useState(null);
  const [pesan, setPesan] = useState(null); // { type, text }
  // Nilai form per klaim (jadwal kunjungan ulang + catatan admin).
  const [form, setForm] = useState({}); // { [claimId]: { date, time, note } }

  /** Ambil ulang daftar klaim (dipakai tombol muat ulang & setelah keputusan). */
  async function muat() {
    const res = await getWarrantyClaimsAdmin();
    if (res.error) {
      setError(res.error);
      setClaims([]);
      return;
    }
    setError(null);
    setClaims(res.claims || []);
  }

  // Muat pertama: pola yang sama dengan AdminNotifyRecipientsTab — IIFE async
  // dengan penanda hidup. Badan efek tidak menyetel state secara sinkron
  // (react-hooks/set-state-in-effect) dan tidak menyetel state setelah widget
  // dilepas saat permintaan masih berjalan.
  useEffect(() => {
    let hidup = true;
    (async () => {
      const res = await getWarrantyClaimsAdmin();
      if (!hidup) return;
      if (res.error) {
        setError(res.error);
        setClaims([]);
      } else {
        setError(null);
        setClaims(res.claims || []);
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

  function nilai(claim) {
    const f = form[claim.id] || {};
    return {
      date: f.date ?? besokWib(),
      time: f.time ?? claim.booking?.booking_time ?? TIME_SLOTS[0],
      note: f.note ?? "",
    };
  }

  function ubah(claim, patch) {
    setForm((prev) => ({
      ...prev,
      [claim.id]: { ...nilai(claim), ...patch },
    }));
  }

  async function putuskan(claim, keputusan) {
    setBusyId(claim.id);
    setPesan(null);
    const v = nilai(claim);
    const res = await decideWarrantyClaimAdmin(
      claim.id,
      keputusan,
      v.note,
      keputusan === "approved" ? v.date : null,
      keputusan === "approved" ? v.time : null
    );
    setBusyId(null);
    if (res.error) {
      setPesan({ type: "error", text: res.error });
      return;
    }
    setPesan({
      type: "ok",
      text:
        keputusan === "approved"
          ? `Garansi disetujui — kunjungan ulang ${res.result?.revisit_code || ""} (${res.result?.revisit_date || ""} ${res.result?.revisit_time || ""}) dibuat dan ditugaskan ke teknisi asal.`
          : "Klaim garansi ditolak.",
    });
    muat();
  }

  const daftar =
    filter === "semua" ? claims : claims.filter((c) => c.status === filter);
  const jumlahOpen = claims.filter((c) => c.status === "open").length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-ink-soft max-w-xl">
            Pelanggan mengajukan klaim untuk pesanan yang sudah selesai dan masih dalam masa garansi
            layanan. Menyetujui membuat kunjungan ulang gratis yang langsung ditugaskan ke teknisi asal.
          </p>
        </div>
        <button onClick={muatUlang} disabled={loading} className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 shrink-0">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Muat ulang
        </button>
      </div>

      {error && (
        <p className="card text-sm text-coral">
          {error}
        </p>
      )}

      {pesan && (
        <p className={`card text-sm ${pesan.type === "error" ? "text-coral" : "text-mint"}`}>{pesan.text}</p>
      )}

      <div className="flex gap-2 flex-wrap">
        {[
          { id: "open", label: `Menunggu${jumlahOpen ? ` (${jumlahOpen})` : ""}` },
          { id: "approved", label: "Disetujui" },
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

      {loading && claims.length === 0 ? (
        <p className="card text-sm text-ink-soft flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Memuat klaim…
        </p>
      ) : daftar.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-ink-soft">
            {filter === "open"
              ? "Tidak ada klaim garansi yang menunggu keputusan."
              : "Tidak ada klaim garansi pada filter ini."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {daftar.map((c) => {
            const st = LABEL_STATUS[c.status] || { text: c.status, cls: "bg-line text-ink-soft" };
            const v = nilai(c);
            const garansiHari = c.booking?.services?.warranty_days;
            return (
              <div key={c.id} className="card !p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="pill bg-brand-tint text-brand-deep font-bold text-xs">
                        #{c.booking?.code || "?"}
                      </span>
                      <span className="text-sm font-semibold text-navy">
                        {c.booking?.services?.name || "Layanan"}
                      </span>
                      <span className={`pill ${st.cls} text-xs font-bold`}>
                        <ShieldCheck size={12} className="mr-1" /> {st.text}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft mt-1">
                      Pengerjaan selesai {waktuSingkat(c.booking?.completed_at)} ·{" "}
                      {c.booking?.booking_date} {c.booking?.booking_time} · {c.booking?.address || "-"}
                    </p>
                    <p className="text-xs text-ink-soft">
                      Pelanggan: {c.customer?.name || "-"}
                      {c.customer?.phone ? ` · ${c.customer.phone}` : ""}
                      {c.customer?.email ? ` · ${c.customer.email}` : ""}
                    </p>
                    <p className="text-xs text-ink-soft">
                      Teknisi asal: {c.technician?.name || "(belum pernah ditugaskan)"}
                      {c.technician?.phone ? ` · ${c.technician.phone}` : ""}
                      {c.booking?.total_price != null ? ` · nilai pesanan ${formatRupiah(c.booking.total_price)}` : ""}
                      {garansiHari ? ` · garansi ${garansiHari} hari` : ""}
                    </p>
                  </div>
                  <span className="text-[11px] text-ink-soft shrink-0">Diajukan {waktuSingkat(c.created_at)}</span>
                </div>

                <p className="text-sm text-ink mt-2 italic">&ldquo;{c.reason}&rdquo;</p>

                {c.status === "open" ? (
                  <div className="mt-3 pt-3 border-t border-line space-y-3">
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                          Jadwal kunjungan ulang
                        </label>
                        <input
                          type="date"
                          className="input mt-1"
                          value={v.date}
                          onChange={(e) => ubah(c, { date: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">Jam</label>
                        <select className="input mt-1" value={v.time} onChange={(e) => ubah(c, { time: e.target.value })}>
                          {/* Slot asli pesanan bisa di luar daftar baku (data lama) — tetap ditampilkan. */}
                          {!TIME_SLOTS.includes(v.time) && v.time && <option value={v.time}>{v.time}</option>}
                          {TIME_SLOTS.map((t) => (
                            <option key={t} value={t}>
                              {slotLabel(t)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                          Catatan (opsional)
                        </label>
                        <input
                          type="text"
                          className="input mt-1"
                          placeholder="mis. kerusakan bukan dari pengerjaan"
                          value={v.note}
                          onChange={(e) => ubah(c, { note: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => putuskan(c, "approved")}
                        disabled={busyId === c.id || !v.date || !v.time}
                        className="btn-primary !py-2 !px-4 text-xs flex items-center gap-1.5"
                      >
                        {busyId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                        Setujui &amp; buat kunjungan ulang
                      </button>
                      <button
                        onClick={() => putuskan(c, "rejected")}
                        disabled={busyId === c.id}
                        className="btn-outline !py-2 !px-4 text-xs flex items-center gap-1.5 !border-coral !text-coral"
                      >
                        <X size={14} /> Tolak
                      </button>
                      <span className="text-[11px] text-ink-soft">
                        Kunjungan ulang berharga Rp0 dan tidak memotong saldo teknisi.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 pt-2 border-t border-line text-xs text-ink-soft">
                    Diputuskan {waktuSingkat(c.decided_at)}
                    {c.admin_note ? ` · catatan: ${c.admin_note}` : ""}
                    {c.revisit ? (
                      <>
                        {" "}
                        · kunjungan ulang{" "}
                        <span className="font-semibold text-navy">#{c.revisit.code}</span> ({c.revisit.booking_date}{" "}
                        {c.revisit.booking_time}) — status {c.revisit.status}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
