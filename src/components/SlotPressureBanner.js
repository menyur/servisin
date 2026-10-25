"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  RefreshCw,
} from "lucide-react";
import { slotLabel } from "@/lib/booking-slots";
import { formatTanggalPendek } from "@/lib/slot-capacity";

/**
 * Peringatan proaktif kuota slot di panel admin.
 *
 * Banner ini muncul TANPA admin harus membuka tab Kuota Slot: kalau sebuah slot
 * sudah penuh (atau tinggal satu kursi), pelanggan berikutnya akan ditolak.
 * Admin masih punya waktu menambah teknisi / menyesuaikan kuota.
 *
 * Data berasal dari `getSlotPressureAdmin()` — hanya jumlah, bukan data
 * pelanggan. Banner sengaja tidak dirender saat tidak ada tekanan agar tidak
 * menjadi hiasan yang lalu diabaikan.
 */
export default function SlotPressureBanner({
  data = null,
  loading = false,
  onOpen,
  onRefresh,
  onAssign,
}) {
  if (!data?.alerts?.length) return null;

  const penuh = Number(data.full) || 0;
  const hampir = Number(data.near) || 0;
  const nada = penuh > 0 ? "coral" : "amber";
  const warna = {
    coral: {
      box: "border-coral/40 bg-coral-tint/60",
      icon: "text-coral",
      title: "text-navy",
      badge: "bg-coral text-white",
      button: "!border-coral !text-coral hover:!bg-coral-tint",
    },
    amber: {
      box: "border-amber/45 bg-amber-tint",
      icon: "text-amber",
      title: "text-navy",
      badge: "bg-amber text-white",
      button: "!border-amber !text-amber hover:!bg-amber-tint",
    },
  }[nada];

  const bagian = [
    penuh > 0 ? `${penuh} slot penuh` : null,
    hampir > 0 ? `${hampir} hampir penuh` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tampil = data.alerts.slice(0, 4);
  const sisa = data.alerts.length - tampil.length;

  return (
    <div className={`mb-5 rounded-xl border-2 px-4 py-3.5 ${warna.box}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className={`${warna.icon} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-bold ${warna.title}`}>
              Kuota jadwal {data.days || 7} hari ke depan perlu perhatian
            </p>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${warna.badge}`}>
              {bagian}
            </span>
          </div>
          <p className="text-xs text-ink-soft mt-1">
            Tambah teknisi atau longgarkan kuota <strong>sebelum</strong> pelanggan berikutnya
            ditolak. Klik slot untuk melihat teknisi yang siap pada jam itu dan menugaskan
            mereka; pesanan yang sudah ada tidak diubah otomatis.
          </p>

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {tampil.map((a) => (
              <button
                key={`${a.date}-${a.slot}`}
                type="button"
                onClick={() => onAssign?.(a)}
                title="Lihat teknisi yang siap pada jam ini dan tugaskan"
                aria-label={`Atur teknisi ${formatTanggalPendek(a.date)} ${slotLabel(a.slot)}`}
                className={`inline-flex items-center gap-1.5 rounded-lg border bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-left transition hover:bg-white ${
                  a.full ? "border-coral/40 text-coral" : "border-amber/40 text-amber"
                }`}
              >
                <CalendarClock size={11} />
                {formatTanggalPendek(a.date)} · {slotLabel(a.slot)}
                <span className="font-normal text-ink-soft">
                  {a.full ? "penuh" : `sisa ${a.remaining}`}
                </span>
                <span className="font-bold underline decoration-dotted underline-offset-2">
                  Atur teknisi
                </span>
                <ArrowRight size={10} />
              </button>
            ))}
            {sisa > 0 && (
              <span className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] text-ink-soft">
                +{sisa} slot lain
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="text-ink-soft hover:text-navy p-1.5 rounded-lg disabled:opacity-50"
            title="Muat ulang pantauan kuota"
            aria-label="Muat ulang pantauan kuota"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onOpen}
            className={`btn-outline !px-3 !py-1.5 text-xs flex items-center gap-1.5 whitespace-nowrap ${warna.button}`}
          >
            Lihat kuota <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
