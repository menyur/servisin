"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  RefreshCw,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  assignSlotTechnicianAdmin,
  autoAssignSlotTechniciansAdmin,
  getSlotTechniciansAdmin,
} from "@/app/actions/admin";
import { slotLabel } from "@/lib/booking-slots";
import { formatTanggalPendek } from "@/lib/slot-capacity";
import {
  rencanakanPenugasanOtomatis,
  ringkasKesiapan,
  susunKandidatTeknisi,
} from "@/lib/slot-technicians";

const STATUS_PESANAN = {
  pending: "Menunggu bayar",
  paid: "Siap dikerjakan",
  in_progress: "Sedang dikerjakan",
};

function labelKandidat(t) {
  const tanda = [
    t.skillCocok ? "skill cocok" : null,
    t.areaCocok ? "area cocok" : null,
    `beban ${Number(t.beban_hari) || 0}`,
    t.rating_count ? `★ ${t.rating_avg}` : null,
  ].filter(Boolean);
  return `${t.name}${tanda.length ? ` — ${tanda.join(" · ")}` : ""}`;
}

/**
 * Aksi cepat dari peringatan kuota: lihat pesanan pada satu slot dan tugaskan
 * teknisi yang benar-benar siap pada jam itu.
 *
 * Kenapa tidak langsung pindah ke tab Pesanan: admin harus mencari pesanan satu
 * per satu, padahal masalahnya satu slot. Di sini semua pesanan slot terlihat
 * bersama daftar teknisi siap/bentrok, dan penugasannya tetap lewat server
 * (email + push) seperti dropdown biasa.
 *
 * Penting: penugasan TIDAK menambah kuota. Kuota = jumlah pesanan; teknisi
 * menentukan siapa yang mengerjakan. Untuk menerima pesanan baru, kuota harus
 * dinaikkan atau jadwal dipindah.
 */
export default function SlotTechnicianAssignModal({
  slot,
  categories = [],
  onClose,
  onAssigned,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [busyAuto, setBusyAuto] = useState(false);
  const [konfirmasiAuto, setKonfirmasiAuto] = useState(false);
  const [notif, setNotif] = useState(null); // { type, text }

  const date = slot?.date || "";
  const jam = slot?.slot || "";

  async function muat() {
    setLoading(true);
    setError(null);
    const res = await getSlotTechniciansAdmin({ date, slot: jam });
    setLoading(false);
    if (res?.error) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res);
  }

  useEffect(() => {
    if (!date || !jam) return;
    let alive = true;
    (async () => {
      const res = await getSlotTechniciansAdmin({ date, slot: jam });
      if (!alive) return;
      setLoading(false);
      if (res?.error) {
        setError(res.error);
        setData(null);
      } else {
        setData(res);
      }
    })();
    return () => {
      alive = false;
    };
  }, [date, jam]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const namaKategori = useMemo(() => {
    const map = new Map();
    for (const c of Array.isArray(categories) ? categories : []) {
      if (c?.id) map.set(c.id, c.name || c.id);
    }
    return map;
  }, [categories]);

  const ringkas = ringkasKesiapan(data?.technicians || []);
  const pesanan = data?.orders || [];
  const belumDitugaskan = pesanan.filter((o) => !o.technician_id);
  // Pratinjau murni (tanpa menulis): berapa pesanan bisa langsung dipasangkan
  // dan berapa yang tidak punya kandidat siap pada slot ini.
  const pratinjau = rencanakanPenugasanOtomatis({
    orders: pesanan,
    technicians: data?.technicians || [],
    bebanKerja: Object.fromEntries(
      (data?.technicians || []).map((t) => [t.id, Number(t.beban_hari) || 0])
    ),
    leaves: data?.leaves || [],
    tanggal: date || data?.date || null,
  });

  async function tugaskan(order, technicianId) {
    if (!technicianId || busyId) return;
    setBusyId(order.id);
    setNotif(null);
    const res = await assignSlotTechnicianAdmin({
      bookingId: order.id,
      technicianId,
    });
    setBusyId(null);
    if (res?.error) {
      setNotif({ type: "error", text: res.error });
      return;
    }
    setNotif({
      type: "ok",
      text: `${res.technician_name} ditugaskan ke ${order.code}. Notifikasi sudah dikirim ke teknisi & pelanggan.`,
    });
    onAssigned?.({ bookingId: order.id, technicianId });
    await muat();
  }

  async function tugaskanOtomatis() {
    if (busyAuto || pratinjau.rencana.length === 0) return;
    setBusyAuto(true);
    setNotif(null);
    const res = await autoAssignSlotTechniciansAdmin({ date, slot: jam });
    setBusyAuto(false);
    setKonfirmasiAuto(false);
    if (res?.error) {
      setNotif({ type: "error", text: res.error });
      return;
    }
    const berhasil = res.assignments?.length || 0;
    const gagal = res.gagal?.length || 0;
    const tanpa = res.tanpaKandidat?.length || 0;
    const rincian = [
      berhasil ? `${berhasil} berhasil` : null,
      gagal ? `${gagal} gagal` : null,
      tanpa ? `${tanpa} tanpa kandidat` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (gagal > 0) {
      const contoh = res.gagal.slice(0, 2).map((g) => `${g.code}: ${g.error}`).join("; ");
      setNotif({
        type: berhasil > 0 ? "ok" : "error",
        text: `Penugasan otomatis selesai — ${rincian}. ${contoh}`,
      });
    } else {
      let teks = "Tidak ada pesanan yang bisa ditugaskan otomatis.";
      if (berhasil > 0) {
        teks = `Penugasan otomatis selesai — ${rincian}. Notifikasi sudah dikirim ke teknisi & pelanggan.`;
      } else if (tanpa > 0) {
        teks = `${tanpa} pesanan tidak punya teknisi siap pada slot ini. Tambah teknisi, pilih jam lain, atau tugaskan manual.`;
      }
      setNotif({ type: berhasil > 0 ? "ok" : "error", text: teks });
    }
    if (berhasil > 0 && res.assignments?.length) {
      onAssigned?.({ assignments: res.assignments });
    }
    await muat();
  }

  if (!slot) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Atur teknisi ${formatTanggalPendek(date)} ${slotLabel(jam)}`}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-display font-bold text-navy flex items-center gap-2">
              <UserCheck size={18} className="text-brand" /> Atur Teknisi Slot
            </h3>
            <p className="text-xs text-ink-soft mt-0.5 flex items-center gap-1.5">
              <CalendarClock size={13} />
              {formatTanggalPendek(date)} · {slotLabel(jam)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-soft hover:text-navy p-1"
            aria-label="Tutup"
          >
            <X size={20} />
          </button>
        </div>

        <div className="rounded-xl bg-surface-2 px-4 py-3 mb-4">
          <p className="text-xs text-navy">
            <strong>{data?.booked ?? slot.booked ?? "—"}</strong> dari{" "}
            <strong>{data?.capacity ?? slot.capacity ?? "—"}</strong> kuota pesanan terpakai
            {data?.remaining != null && (
              <span className="text-ink-soft">
                {" "}
                · sisa {data.remaining}
              </span>
            )}
          </p>
          <p className="text-[11px] text-ink-soft mt-1">
            Menugaskan teknisi <strong>tidak menambah kuota</strong>. Kuota adalah jumlah
            pesanan; aksi ini memastikan pesanan yang sudah masuk punya teknisi yang siap
            pada jam tersebut.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-ink-soft flex items-center justify-center gap-2 py-10">
            <Loader2 size={16} className="animate-spin" /> Memuat teknisi & pesanan slot...
          </p>
        ) : error ? (
          <div className="rounded-xl border-2 border-coral/40 bg-coral-tint/50 px-4 py-3">
            <p className="text-xs text-coral font-medium flex items-start gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <section>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-xs font-bold text-navy uppercase tracking-wide flex items-center gap-1.5">
                  <Users size={13} /> Teknisi siap pada jam ini
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-mint font-semibold">
                    {ringkas.siap} siap
                  </span>
                  {ringkas.bentrok > 0 && (
                    <span className="text-[11px] text-amber font-semibold">
                      {ringkas.bentrok} bentrok
                    </span>
                  )}
                  {ringkas.cuti > 0 && (
                    <span className="text-[11px] text-coral font-semibold">
                      {ringkas.cuti} cuti
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={muat}
                    disabled={loading}
                    className="text-ink-soft hover:text-navy p-1"
                    title="Muat ulang"
                    aria-label="Muat ulang teknisi slot"
                  >
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {data?.technicians?.length === 0 ? (
                <p className="text-xs text-ink-soft rounded-xl bg-amber-tint px-3 py-2.5">
                  Belum ada teknisi terverifikasi. Setujui pendaftar di tab Pengguna &amp;
                  Teknisi sebelum menugaskan.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.technicians.map((t) => (
                    <span
                      key={t.id}
                      title={t.alasan || t.sedang_bertugas?.code || "Siap pada slot ini"}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                        t.tersedia
                          ? "border-mint/40 bg-mint-tint/60 text-navy"
                          : "border-amber/40 bg-amber-tint/60 text-amber"
                      }`}
                    >
                      {t.tersedia ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                      {t.name}
                      {t.cuti && (
                        <span className="font-normal text-coral">
                          · cuti
                        </span>
                      )}
                      {t.skill && (
                        <span className="font-normal text-ink-soft">
                          {namaKategori.get(t.skill) || t.skill}
                        </span>
                      )}
                      {t.beban_hari > 0 && (
                        <span className="font-normal text-ink-soft">
                          · beban {t.beban_hari}
                        </span>
                      )}
                      {t.sedang_bertugas && t.tersedia && (
                        <span className="font-normal text-ink-soft">
                          · sedang {t.sedang_bertugas.code}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-ink-soft mt-1.5">
                Bentrok = teknisi sudah memegang pesanan aktif lain pada tanggal &amp; jam
                yang sama. Cuti diperlakukan sama seperti bentrok — catatannya ada di kartu
                skor teknisi. Skill/area hanya saran; admin tetap boleh memilih siapa pun
                yang siap.
              </p>
              {data.cutiError && (
                <p className="text-[10.5px] text-coral mt-1.5">{data.cutiError}</p>
              )}
            </section>

            {belumDitugaskan.length > 0 && (
              <section className="rounded-xl border-2 border-brand/25 bg-brand-tint/35 px-3.5 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-navy">
                      Tugaskan otomatis {belumDitugaskan.length} pesanan
                    </p>
                    <p className="text-[11px] text-ink-soft mt-0.5">
                      Pilih kandidat terbaik: skill cocok → area cocok → beban kerja hari itu
                      paling ringan → rating. Satu pesanan satu teknisi, tanpa bentrok slot.
                      {pratinjau.tanpaKandidat.length > 0 && (
                        <span className="text-amber font-semibold">
                          {" "}
                          {pratinjau.tanpaKandidat.length} pesanan belum punya kandidat siap.
                        </span>
                      )}
                    </p>
                  </div>
                  {!konfirmasiAuto ? (
                    <button
                      type="button"
                      onClick={() => setKonfirmasiAuto(true)}
                      disabled={
                        busyAuto || pratinjau.rencana.length === 0 || Boolean(busyId)
                      }
                      className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5 shrink-0"
                    >
                      <UserCheck size={13} /> Tugaskan otomatis
                      {pratinjau.rencana.length > 0 ? ` (${pratinjau.rencana.length})` : ""}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={tugaskanOtomatis}
                        disabled={busyAuto}
                        className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5"
                      >
                        {busyAuto ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={13} />
                        )}
                        {busyAuto ? "Menugaskan..." : "Ya, tugaskan"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setKonfirmasiAuto(false)}
                        disabled={busyAuto}
                        className="btn-outline !px-2.5 !py-1.5 text-xs"
                      >
                        Batal
                      </button>
                    </div>
                  )}
                </div>
                {konfirmasiAuto && (
                  <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2">
                    <ul className="space-y-0.5">
                      {pratinjau.rencana.map((p) => (
                        <li key={p.order.id} className="text-[10.5px] text-navy">
                          {p.order.code} → <strong>{p.technician.name}</strong>
                          <span className="text-ink-soft">
                            {" "}
                            (skill {p.technician.skillCocok ? "✓" : "—"} · area{" "}
                            {p.technician.areaCocok ? "✓" : "—"} · beban{" "}
                            {p.technician.beban_hari})
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10.5px] text-ink-soft mt-1.5">
                      Setiap penugasan mengirim email + push ke teknisi dan pelanggan. Teknisi yang
                      sudah bentrok tidak akan dipilih.
                    </p>
                  </div>
                )}
              </section>
            )}

            <section>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wide mb-2">
                Pesanan di slot ini ({pesanan.length})
              </h4>
              {pesanan.length === 0 ? (
                <p className="text-xs text-ink-soft rounded-xl bg-surface-2 px-3 py-2.5">
                  Tidak ada pesanan aktif di slot ini.
                </p>
              ) : (
                <div className="divide-y divide-line rounded-xl border border-line">
                  {pesanan.map((o) => {
                    const kandidat = susunKandidatTeknisi({
                      technicians: data.technicians,
                      slotBookings: pesanan,
                      categoryId: o.category_id,
                      teksArea: `${o.area || ""} ${o.address || ""}`,
                      abaikanBookingId: o.id,
                      leaves: data.leaves || [],
                      tanggal: date || data.date || null,
                    });
                    const siap = kandidat.filter((t) => t.tersedia);
                    return (
                      <div key={o.id} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-navy">
                              {o.code} · {o.service_name}
                              <span className="font-normal text-ink-soft">
                                {" "}
                                · {STATUS_PESANAN[o.status] || o.status}
                              </span>
                            </p>
                            <p className="text-[11px] text-ink-soft truncate">
                              {o.customer_name} · {o.address || "Alamat belum diisi"}
                            </p>
                          </div>
                          {o.technician_name && (
                            <span className="text-[10px] font-semibold text-mint shrink-0">
                              ✓ {o.technician_name}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <select
                            value={o.technician_id || ""}
                            onChange={(e) => tugaskan(o, e.target.value)}
                            disabled={busyId === o.id || busyAuto || siap.length === 0}
                            className="input !w-auto !py-1.5 text-xs max-w-full"
                            aria-label={`Teknisi untuk ${o.code}`}
                          >
                            <option value="" disabled={Boolean(o.technician_id)}>
                              {siap.length === 0 ? "Tidak ada teknisi siap" : "Pilih teknisi..."}
                            </option>
                            {siap.map((t) => (
                              <option key={t.id} value={t.id}>
                                {labelKandidat(t)}
                              </option>
                            ))}
                          </select>
                          {busyId === o.id && (
                            <span className="text-[11px] text-ink-soft flex items-center gap-1">
                              <Loader2 size={12} className="animate-spin" /> Menugaskan...
                            </span>
                          )}
                          {siap.length === 0 && (
                            <span className="text-[11px] text-amber">
                              {kandidat.some((t) => t.cuti)
                                ? "Semua teknisi bentrok atau sedang cuti di jam ini — pilih jam lain, tugaskan teknisi lain, atau hapus catatan cutinya bila mendesak."
                                : "Semua teknisi bentrok di jam ini — pilih jam lain atau tambah teknisi."}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {notif && (
              <p
                className={`text-xs font-medium ${
                  notif.type === "ok" ? "text-mint" : "text-coral"
                }`}
              >
                {notif.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
