"use client";

import { useEffect, useState } from "react";
import { getAppFeeAdmin, saveAppFeeAdmin } from "@/app/actions/admin";
import { APP_FEE, APP_FEE_MAKS, calculateTotal, formatRupiah } from "@/lib/pricing";
import { Coins, Info, Loader2, Save, TriangleAlert } from "lucide-react";

/**
 * Tab "Biaya Aplikasi" panel admin — menetapkan biaya layanan aplikasi yang
 * ditagihkan ke pelanggan pada setiap pesanan (tabel app_settings, kolom
 * app_fee; dibuat supabase/migrate-app-fee-setting.sql).
 *
 * Yang ditampilkan di sini adalah tarif yang BENAR-BENAR berlaku: jalur
 * penagihan (booking web & RPC pembuat booking di aplikasi) membaca setelan yang
 * sama, jadi pelanggan tidak mungkin melihat angka berbeda dari yang ditagihkan.
 *
 * Perubahan berlaku untuk pesanan BARU saja. Pesanan yang sudah ada menyimpan
 * tarifnya sendiri (`bookings.app_fee`) — itu bagian dari tagihan yang sudah
 * disepakati pelanggan dan dasar komisi teknisi, jadi menimpanya akan mengubah
 * laporan dan pemotongan saldo secara surut. Karena itu kartu ini menyebutkan
 * hal tersebut apa adanya, bukan sekadar menyimpan.
 */
export default function AppFeeSettingsTab() {
  const [form, setForm] = useState({ fee: "" });
  const [tersimpan, setTersimpan] = useState(null); // { fee, sumber, alasan }
  const [maks, setMaks] = useState(APP_FEE_MAKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getAppFeeAdmin();
      if (!alive) return;
      if (r.error) setMsg({ type: "error", text: r.error });
      else {
        setForm({ fee: String(r.fee ?? "") });
        setTersimpan({ fee: r.fee, sumber: r.sumber, alasan: r.alasan });
        if (Number.isFinite(Number(r.maks))) setMaks(Number(r.maks));
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
    const r = await saveAppFeeAdmin({ fee: form.fee });
    setSaving(false);
    if (r.error) {
      setMsg({ type: "error", text: r.error });
      return;
    }
    setTersimpan({ fee: r.fee, sumber: "setelan", alasan: null });
    setForm({ fee: String(r.fee) });
    setMsg({
      type: "ok",
      text: `Biaya aplikasi ${formatRupiah(r.fee)} tersimpan. Berlaku untuk pesanan BARU; pesanan yang sudah ada tidak berubah.`,
    });
  }

  // Pratinjau memakai rumus yang sama dengan jalur penagihan (calculateTotal),
  // jadi contoh di panel tidak bisa menyimpang dari tagihan sungguhan.
  const contoh = calculateTotal(100000, 0, Number(form.fee) || 0);
  const belumTersimpan = tersimpan && String(tersimpan.fee) !== String(form.fee ?? "").trim();

  return (
    <div className="max-w-xl">
      <div className="card !p-5">
        <h3 className="font-display font-semibold text-navy flex items-center gap-2 mb-1">
          <Coins size={17} className="text-brand" /> Biaya Aplikasi
        </h3>
        <p className="text-xs text-ink-soft mb-4">
          Ditambahkan ke subtotal layanan pada <strong>setiap pesanan baru</strong> dan ikut dipotong dari
          saldo teknisi bersama komisi. Angka ini juga yang diumumkan di panduan pelanggan &amp; teknisi.
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
                    Yang berlaku sekarang tarif BAWAAN {formatRupiah(tersimpan.fee)} — setelannya belum ada di database.
                  </p>
                  <p className="text-ink-soft">
                    Jalankan <code>supabase/migrate-app-fee-setting.sql</code> di Supabase SQL Editor supaya tarif
                    bisa diubah dari panel ini
                    {tersimpan.alasan ? ` (${tersimpan.alasan})` : ""}.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="label" htmlFor="biaya-app">Biaya aplikasi per pesanan (rupiah)</label>
              <input
                id="biaya-app"
                className="input"
                inputMode="numeric"
                value={form.fee}
                onChange={(e) => setForm({ fee: e.target.value })}
                placeholder="Contoh: 5000"
              />
              <p className="text-[11px] text-ink-soft mt-1.5">
                Tanpa titik/koma. Isi <strong>0</strong> bila biaya aplikasi mau digratiskan (mis. masa promo).
                Batas maksimal {formatRupiah(maks)}.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {[APP_FEE, 10000, 15000, 0].map((v) => (
                <button
                  key={v}
                  type="button"
                  className="btn-outline !py-1.5 text-xs"
                  onClick={() => setForm({ fee: String(v) })}
                >
                  {v === 0 ? "Gratis (0)" : formatRupiah(v)}
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-surface-2 px-4 py-3 text-xs text-ink-soft space-y-1">
              <p className="font-semibold text-navy flex items-center gap-1.5">
                <Info size={14} /> Pratinjau: pesanan layanan {formatRupiah(100000)}
              </p>
              <p>
                Biaya aplikasi {formatRupiah(contoh.appFee)} → pelanggan membayar{" "}
                <strong className="text-navy">{formatRupiah(contoh.total)}</strong>
              </p>
              <p>
                Dasar komisi teknisi = total − biaya aplikasi = {formatRupiah(contoh.total - contoh.appFee)},
                lalu dipotong komisi teknisi + {formatRupiah(contoh.appFee)} dari saldonya.
              </p>
            </div>

            <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Menyimpan..." : "Simpan biaya aplikasi"}
            </button>

            {belumTersimpan && !saving && (
              <p className="text-[11px] text-amber font-medium">
                Belum disimpan — klik &quot;Simpan biaya aplikasi&quot; untuk menerapkan {formatRupiah(Number(form.fee) || 0)}.
              </p>
            )}

            {msg && (
              <p className={`text-xs font-medium ${msg.type === "ok" ? "text-mint" : "text-coral"}`}>{msg.text}</p>
            )}

            <p className="text-[11px] text-ink-soft border-t border-hairline pt-3">
              Pesanan yang <strong>sudah ada</strong> tetap memakai biaya aplikasi yang ditagihkan padanya dulu —
              mengubah tarif tidak menagih ulang pelanggan dan tidak mengubah komisi pekerjaan yang sudah selesai.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
