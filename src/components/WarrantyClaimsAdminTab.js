"use client";

import { useEffect, useState } from "react";
import {
  decideWarrantyClaimAdmin,
  getWarrantyClaimsAdmin,
  getWarrantySettingsAdmin,
  saveWarrantySettingsAdmin,
} from "@/app/actions/admin";
import { TIME_SLOTS, slotLabel } from "@/lib/booking-slots";
import { formatRupiah } from "@/lib/pricing";
import { Check, Loader2, Power, RefreshCw, ShieldCheck, X } from "lucide-react";

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
 * Tab "Garansi": PENGATURAN garansi + klaim garansi pekerjaan dari pelanggan.
 *
 * Pengaturan (kartu di atas): satu saklar aktif/nonaktif dan satu durasi standar
 * untuk SELURUH katalog (app_settings.warranty_enabled / warranty_days, lihat
 * supabase/migrate-warranty-settings.sql). Durasi efektif dihitung di database,
 * jadi setelan ini juga yang dipakai aplikasi pelanggan — bukan disalin di sini.
 * `services.warranty_days = 0` tetap berarti "layanan ini dikecualikan".
 *
 * Klaim: pelanggan mengajukan dari aplikasi untuk pesanan yang sudah selesai
 * dan masih dalam masa garansi; admin memutuskan di sini. MENYETUJUI berarti
 * sistem membuatkan kunjungan ulang BERHARGA 0 yang langsung ditugaskan ke
 * teknisi yang mengerjakan pesanan asalnya — jadi garansi tidak menambah
 * pekerjaan penjadwalan manual, dan komisi teknisi tidak terpotong (biaya
 * garansi ditanggung platform; lihat supabase/migrate-warranty-claims.sql).
 * Mematikan garansi sengaja TIDAK menyentuh klaim yang sudah masuk maupun
 * kunjungan ulang yang sudah terjadwal.
 */
export default function WarrantyClaimsAdminTab() {
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState([]);
  const [error, setError] = useState(null);
  // Setelan garansi platform: { enabled, days } — dibaca bersama daftar klaim.
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState(null);
  // Perubahan yang belum disimpan. `null` = form mengikuti nilai dari server,
  // jadi tidak perlu menyalin props ke state lewat efek (pola yang sama dengan
  // tab admin lain yang menolak set-state-in-effect).
  const [draft, setDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [pesanPengaturan, setPesanPengaturan] = useState(null); // { type, text }
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

  /** Ambil setelan garansi platform (terpisah: gagal baca setelan ≠ gagal klaim). */
  async function muatSetelan() {
    const res = await getWarrantySettingsAdmin();
    if (res.error) {
      setSettingsError(res.error);
      return;
    }
    setSettingsError(null);
    setSettings({ enabled: !!res.enabled, days: Number(res.days) });
  }

  // Muat pertama: pola yang sama dengan AdminNotifyRecipientsTab — IIFE async
  // dengan penanda hidup. Badan efek tidak menyetel state secara sinkron
  // (react-hooks/set-state-in-effect) dan tidak menyetel state setelah widget
  // dilepas saat permintaan masih berjalan.
  useEffect(() => {
    let hidup = true;
    (async () => {
      const [klaim, setel] = await Promise.all([
        getWarrantyClaimsAdmin(),
        getWarrantySettingsAdmin(),
      ]);
      if (!hidup) return;
      if (klaim.error) {
        setError(klaim.error);
        setClaims([]);
      } else {
        setError(null);
        setClaims(klaim.claims || []);
      }
      if (setel.error) {
        setSettingsError(setel.error);
      } else {
        setSettingsError(null);
        setSettings({ enabled: !!setel.enabled, days: Number(setel.days) });
      }
      setLoading(false);
    })();
    return () => {
      hidup = false;
    };
  }, []);

  async function muatUlang() {
    setLoading(true);
    await Promise.all([muat(), muatSetelan()]);
    setLoading(false);
  }

  // Nilai form: draft menang saat admin sedang mengubah, kalau tidak ikut server.
  const garansiAktif = draft?.enabled ?? settings?.enabled ?? true;
  const durasiHari = draft?.days ?? String(settings?.days ?? 7);
  const adaPerubahan =
    draft !== null &&
    (garansiAktif !== settings?.enabled || String(durasiHari) !== String(settings?.days));

  async function simpanSetelan() {
    setSavingSettings(true);
    setPesanPengaturan(null);
    const res = await saveWarrantySettingsAdmin({
      enabled: garansiAktif,
      days: durasiHari,
    });
    setSavingSettings(false);
    if (res.error) {
      setPesanPengaturan({ type: "error", text: res.error });
      return;
    }
    setSettings({ enabled: !!res.enabled, days: Number(res.days) });
    setDraft(null);
    setPesanPengaturan({
      type: "ok",
      text: res.enabled
        ? `Pengaturan disimpan — garansi aktif ${res.days} hari untuk semua layanan.`
        : "Pengaturan disimpan — garansi nonaktif. Klaim baru akan ditolak; klaim yang sudah masuk tetap bisa diputuskan.",
    });
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

      {/* --- Pengaturan garansi: satu saklar & satu durasi untuk semua layanan --- */}
      <div className="card !p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold text-navy flex items-center gap-2">
              <ShieldCheck size={16} /> Pengaturan garansi
            </p>
            <p className="text-xs text-ink-soft mt-1 max-w-xl">
              Durasi standar berlaku untuk semua layanan. Layanan yang ditandai tanpa garansi (masa
              garansi 0 per layanan) tetap dikecualikan. Mematikan garansi tidak membatalkan klaim
              yang sudah masuk maupun kunjungan ulang yang sudah dijadwalkan.
            </p>
          </div>
          {settings && (
            <span
              className={`pill text-xs font-bold ${
                settings.enabled ? "bg-mint-tint text-mint" : "bg-coral-tint text-coral"
              }`}
            >
              {settings.enabled ? `Aktif · ${settings.days} hari` : "Nonaktif"}
            </span>
          )}
        </div>

        {settingsError ? (
          <p className="text-sm text-coral">{settingsError}</p>
        ) : (
          <div className="flex items-end gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setDraft({ enabled: !garansiAktif, days: durasiHari })}
              disabled={!settings || savingSettings}
              className={`btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 ${
                garansiAktif ? "" : "!border-coral !text-coral"
              }`}
            >
              <Power size={14} />
              {garansiAktif
                ? "Garansi aktif — klik untuk mematikan"
                : "Garansi nonaktif — klik untuk mengaktifkan"}
            </button>
            <div>
              <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                Durasi standar (hari)
              </label>
              <input
                type="number"
                min="1"
                max="365"
                className="input mt-1 w-32"
                value={durasiHari}
                disabled={!settings || savingSettings}
                onChange={(e) => setDraft({ enabled: garansiAktif, days: e.target.value })}
              />
            </div>
            <button
              onClick={simpanSetelan}
              disabled={!settings || savingSettings || !adaPerubahan}
              className="btn-primary !py-2 !px-4 text-xs flex items-center gap-1.5"
            >
              {savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
              Simpan pengaturan
            </button>
            <span className="text-[11px] text-ink-soft">
              Durasi 1–365 hari. Matikan saklar untuk meniadakan garansi.
            </span>
          </div>
        )}

        {pesanPengaturan && (
          <p className={`text-sm ${pesanPengaturan.type === "error" ? "text-coral" : "text-mint"}`}>
            {pesanPengaturan.text}
          </p>
        )}
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
                      {settings?.enabled && Number(garansiHari ?? 0) > 0
              ? ` · garansi ${settings.days} hari`
              : " · tanpa garansi"}
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
