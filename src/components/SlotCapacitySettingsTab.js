"use client";

import { useEffect, useState } from "react";
import { getSlotCapacityAdmin, saveSlotCapacityAdmin } from "@/app/actions/admin";
import {
  SLOT_CAPACITY_DEFAULT,
  SLOT_CAPACITY_MAX,
  SLOT_CAPACITY_MIN,
  formatTanggalPendek,
} from "@/lib/slot-capacity";
import { TIME_SLOTS, slotLabel } from "@/lib/booking-slots";
import {
  CalendarClock,
  Info,
  Loader2,
  RefreshCw,
  Save,
  TriangleAlert,
  UserCheck,
} from "lucide-react";

/**
 * Tab "Kuota Slot" panel admin.
 *
 * Kuota adalah jumlah pesanan maksimum per satu slot (tanggal + jam) untuk
 * SEMUA layanan. Angka ini ditegakkan trigger database
 * (supabase/migrate-slot-capacity.sql), jadi berlaku untuk pemesanan web,
 * aplikasi Flutter, dan perubahan jadwal pelanggan — bukan hanya tampilan.
 *
 * Kenapa diatur di sini: kapasitas lapangan mengikuti jumlah teknisi yang siap.
 * Terlalu longgar = admin harus menjadwal ulang; terlalu ketat = slot kosong
 * padahal teknisi menganggur.
 */
export default function SlotCapacitySettingsTab({
  pressure = null,
  pressureError = null,
  pressureLoading = false,
  onSaved,
  onRefresh,
  onAssign,
} = {}) {
  const [form, setForm] = useState(String(SLOT_CAPACITY_DEFAULT));
  const [tersimpan, setTersimpan] = useState(null); // { capacity, sumber, catatan }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getSlotCapacityAdmin();
      if (!alive) return;
      if (r.error) setMsg({ type: "error", text: r.error });
      else {
        setForm(String(r.capacity));
        setTersimpan(r);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const r = await saveSlotCapacityAdmin({ capacity: form });
    setSaving(false);
    if (r.error) {
      setMsg({ type: "error", text: r.error });
      return;
    }
    setTersimpan({ capacity: r.capacity, sumber: "setelan", catatan: null });
    setForm(String(r.capacity));
    setMsg({
      type: "ok",
      text: `Kuota ${r.capacity} pesanan per slot tersimpan. Berlaku untuk pesanan BARU; pesanan yang sudah dibuat tidak berubah.`,
    });
    // Segarkan pantauan: slot yang tadinya "hampir penuh" bisa berubah status
    // karena kapasitas baru, dan banner di atas panel ikut diperbarui.
    onSaved?.();
  }

  const n = Number(form);
  const sah = Number.isInteger(n) && n >= SLOT_CAPACITY_MIN && n <= SLOT_CAPACITY_MAX;
  const belumTersimpan =
    tersimpan?.sumber === "setelan" && Number(tersimpan.capacity) !== Number(form);

  return (
    <div className="max-w-xl space-y-4">
      <div className="card !p-5">
        <h3 className="font-display font-semibold text-navy flex items-center gap-2 mb-1">
          <CalendarClock size={17} className="text-brand" /> Kuota per Slot Jadwal
        </h3>
        <p className="text-xs text-ink-soft mb-4">
          Batas jumlah pesanan untuk satu tanggal + jam, dihitung untuk <strong>semua layanan</strong>.
          Slot yang sudah penuh tidak bisa dipesan lagi dari web maupun aplikasi; pelanggan diminta
          memilih jam/tanggal lain. Pesanan yang menahan slot: menunggu bayar, sudah dibayar, dan
          sedang dikerjakan.
        </p>

        {loading ? (
          <p className="text-sm text-ink-soft flex items-center gap-2 py-6 justify-center">
            <Loader2 size={16} className="animate-spin" /> Memuat...
          </p>
        ) : (
          <div className="space-y-4">
            {tersimpan?.sumber === "bawaan" && (
              <div className="rounded-xl border-2 border-amber/50 bg-amber-tint px-4 py-3 flex gap-2.5">
                <TriangleAlert size={17} className="text-amber shrink-0 mt-0.5" />
                <div className="text-xs text-navy">
                  <p className="font-semibold mb-0.5">
                    Yang berlaku sekarang kuota BAWAAN {SLOT_CAPACITY_DEFAULT} — setelannya belum ada di database.
                  </p>
                  <p className="text-ink-soft">{tersimpan.catatan}</p>
                </div>
              </div>
            )}

            <div>
              <label className="label" htmlFor="kuota-slot">
                Maksimal pesanan per slot
              </label>
              <input
                id="kuota-slot"
                className="input"
                inputMode="numeric"
                value={form}
                onChange={(e) => setForm(e.target.value)}
                placeholder="Contoh: 2"
              />
              <p className="text-[11px] text-ink-soft mt-1.5">
                Angka bulat {SLOT_CAPACITY_MIN}–{SLOT_CAPACITY_MAX}. Sesuaikan dengan jumlah teknisi
                yang benar-benar bisa melayani pada satu slot, bukan jumlah teknisi terdaftar.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((v) => (
                <button
                  key={v}
                  type="button"
                  className="btn-outline !py-1.5 text-xs"
                  onClick={() => setForm(String(v))}
                >
                  {v} pesanan
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-surface-2 px-4 py-3 text-xs text-ink-soft space-y-1">
              <p className="font-semibold text-navy flex items-center gap-1.5">
                <Info size={14} /> Dengan {TIME_SLOTS.length} slot per hari
              </p>
              <p>
                Maksimal <strong className="text-navy">{sah ? n * TIME_SLOTS.length : "—"}</strong>{" "}
                pesanan baru per hari (semua layanan). Slot:{" "}
                {TIME_SLOTS.map(slotLabel).join(" · ")}.
              </p>
              <p>
                Kuota tidak mengubah pesanan yang sudah ada. Untuk keadaan darurat, admin tetap bisa
                membatalkan/menjadwalkan ulang pesanan lewat tab Pesanan.
              </p>
            </div>

            <button
              className="btn-primary flex items-center gap-2"
              onClick={save}
              disabled={saving || !sah}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Menyimpan..." : "Simpan kuota slot"}
            </button>

            {belumTersimpan && !saving && (
              <p className="text-[11px] text-amber font-medium">
                Belum disimpan — klik &quot;Simpan kuota slot&quot; untuk menerapkan {form}.
              </p>
            )}

            {msg && (
              <p className={`text-xs font-medium ${msg.type === "ok" ? "text-mint" : "text-coral"}`}>
                {msg.text}
              </p>
            )}
          </div>
        )}
      </div>

      <PantauanKuota
        pressure={pressure}
        error={pressureError}
        loading={pressureLoading}
        onRefresh={onRefresh}
        onAssign={onAssign}
      />
    </div>
  );
}

/** Daftar slot penuh/hampir penuh 7 hari ke depan (data dari parent). */
function PantauanKuota({ pressure, error, loading, onRefresh, onAssign }) {
  const alerts = pressure?.alerts || [];
  const hari = pressure?.days || 7;
  const penuh = Number(pressure?.full) || 0;
  const hampir = Number(pressure?.near) || 0;

  return (
    <div className="card !p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-navy flex items-center gap-2 mb-1">
            <TriangleAlert size={17} className="text-amber" /> Pantauan {hari} Hari ke Depan
          </h3>
          <p className="text-xs text-ink-soft">
            Slot <strong>penuh</strong> berarti pelanggan berikutnya sudah ditolak. Slot{" "}
            <strong>hampir penuh</strong> tinggal beberapa kursi — waktu untuk menambah teknisi
            atau menyesuaikan kuota.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="btn-outline !px-2.5 !py-1.5 text-xs flex items-center gap-1.5 shrink-0"
          title="Muat ulang pantauan"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {loading ? "Memuat..." : "Muat ulang"}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-coral font-medium mt-3">{error}</p>
      ) : loading && alerts.length === 0 ? (
        <p className="text-sm text-ink-soft flex items-center gap-2 py-5 justify-center">
          <Loader2 size={15} className="animate-spin" /> Memuat pantauan kuota...
        </p>
      ) : alerts.length === 0 ? (
        <div className="mt-3 rounded-xl bg-mint-tint px-4 py-3 text-xs text-navy">
          Tidak ada slot penuh atau hampir penuh dalam {hari} hari ke depan. Kuota saat ini
          masih longgar.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mt-3">
            {penuh > 0 && (
              <span className="pill !px-2.5 !py-1 text-[11px] bg-coral-tint text-coral font-bold">
                {penuh} slot penuh
              </span>
            )}
            {hampir > 0 && (
              <span className="pill !px-2.5 !py-1 text-[11px] bg-amber-tint text-amber font-bold">
                {hampir} hampir penuh
              </span>
            )}
          </div>
          <div className="mt-2 divide-y divide-line">
            {alerts.map((a) => (
              <div
                key={`${a.date}-${a.slot}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-navy">
                    {formatTanggalPendek(a.date)} · {slotLabel(a.slot)}
                  </p>
                  <p className="text-[11px] text-ink-soft">
                    {a.booked} dari {a.capacity} pesanan
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`pill !px-2.5 !py-1 text-[11px] font-bold ${
                      a.full ? "bg-coral-tint text-coral" : "bg-amber-tint text-amber"
                    }`}
                  >
                    {a.full ? "Penuh" : `Sisa ${a.remaining}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAssign?.(a)}
                    className="btn-outline !px-2.5 !py-1 text-[11px] flex items-center gap-1"
                    title="Lihat teknisi yang siap pada jam ini dan tugaskan"
                  >
                    <UserCheck size={12} /> Atur teknisi
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-soft mt-2">
            Tindakan: tambah teknisi yang siap lewat <strong>Atur teknisi</strong> pada jam tersebut,
            atau naikkan kuota bila kapasitas lapangan memang memadai. Penugasan tidak menambah
            kuota; pesanan yang sudah masuk tidak dipindahkan otomatis.
          </p>
        </>
      )}
    </div>
  );
}
