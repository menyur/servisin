"use client";

import { useEffect, useState } from "react";
import { getReviewRewardAdmin, saveReviewRewardAdmin } from "@/app/actions/admin";
import {
  REVIEW_REWARD_AMOUNT_MAKS,
  REVIEW_REWARD_DELAY_DAYS_MAKS,
  REVIEW_REWARD_VALID_DAYS_MAKS,
} from "@/lib/review-reward";
import { formatRupiah } from "@/lib/pricing";
import { Gift, Info, Loader2, Save, TriangleAlert } from "lucide-react";

/**
 * Tab "Voucher Penilaian" panel admin — mengatur insentif yang diterbitkan
 * otomatis saat pelanggan mengirim penilaian BARU untuk pesanan selesai
 * (tabel app_settings; kolomnya dibuat supabase/migrate-review-reward.sql).
 *
 * Tiga angka, satu arti masing-masing:
 *   nominal   → nilai voucher (Rp 0 = insentif dimatikan, tanpa perlu deploy)
 *   berlaku   → berapa hari voucher bisa dipakai sejak terbit
 *   jeda      → berapa hari setelah pesanan selesai voucher baru terbit
 *
 * Yang ditampilkan di sini adalah angka yang BENAR-BENAR dipakai: penerbit
 * voucher di web (src/lib/review-reward.js) dan di aplikasi
 * (public.review_reward_efektif()) membaca baris setelan yang sama, jadi
 * pelanggan tidak mungkin menerima nominal berbeda tergantung platform.
 *
 * Perubahan berlaku untuk voucher yang TERBIT SESUDAHNYA. Voucher yang sudah
 * terbit menyimpan nominal & masa berlakunya sendiri — itu janji yang sudah
 * dilihat pelanggan di tab Voucher Saya.
 */
export default function ReviewRewardSettingsTab() {
  const [form, setForm] = useState({ amount: "", validDays: "", delayDays: "" });
  const [tersimpan, setTersimpan] = useState(null); // { amount, validDays, delayDays, sumber, alasan }
  const [maks, setMaks] = useState({
    amount: REVIEW_REWARD_AMOUNT_MAKS,
    validDays: REVIEW_REWARD_VALID_DAYS_MAKS,
    delayDays: REVIEW_REWARD_DELAY_DAYS_MAKS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getReviewRewardAdmin();
      if (!alive) return;
      if (r.error) setMsg({ type: "error", text: r.error });
      else {
        setForm({
          amount: String(r.amount ?? ""),
          validDays: String(r.validDays ?? ""),
          delayDays: String(r.delayDays ?? ""),
        });
        setTersimpan({
          amount: r.amount,
          validDays: r.validDays,
          delayDays: r.delayDays,
          sumber: r.sumber,
          alasan: r.alasan,
        });
        if (r.maks) setMaks((m) => ({ ...m, ...r.maks }));
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
    const r = await saveReviewRewardAdmin(form);
    setSaving(false);
    if (r.error) {
      setMsg({ type: "error", text: r.error });
      return;
    }
    setTersimpan({ amount: r.amount, validDays: r.validDays, delayDays: r.delayDays, sumber: "setelan", alasan: null });
    setForm({ amount: String(r.amount), validDays: String(r.validDays), delayDays: String(r.delayDays) });
    setMsg({
      type: "ok",
      text:
        r.amount > 0
          ? `Insentif ${formatRupiah(r.amount)} / ${r.validDays} hari tersimpan. Berlaku untuk voucher yang TERBIT SESUDAHNYA; voucher yang sudah ada tidak berubah.`
          : "Insentif dimatikan (nominal Rp0). Penilaian tetap tersimpan, hanya tidak menerbitkan voucher baru.",
    });
  }

  const belumTersimpan =
    tersimpan &&
    (String(tersimpan.amount) !== String(form.amount ?? "").trim() ||
      String(tersimpan.validDays) !== String(form.validDays ?? "").trim() ||
      String(tersimpan.delayDays) !== String(form.delayDays ?? "").trim());

  return (
    <div className="max-w-xl">
      <div className="card !p-5">
        <h3 className="font-display font-semibold text-navy flex items-center gap-2 mb-1">
          <Gift size={17} className="text-brand" /> Voucher Penilaian
        </h3>
        <p className="text-xs text-ink-soft mb-4">
          Diterbitkan otomatis untuk <strong>penilaian baru</strong> pada pesanan selesai yang punya teknisi.
          Satu voucher per pesanan. Angka ini juga yang dijanjikan di panduan pelanggan, syarat &amp; ketentuan,
          banner dashboard, dan tab Voucher Saya.
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
                    Yang berlaku sekarang insentif BAWAAN {formatRupiah(tersimpan.amount)} — setelannya belum ada di
                    database.
                  </p>
                  <p className="text-ink-soft">
                    Jalankan <code>supabase/migrate-review-reward.sql</code> di Supabase SQL Editor supaya insentif
                    bisa diubah dari panel ini
                    {tersimpan.alasan ? ` (${tersimpan.alasan})` : ""}.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="label" htmlFor="voucher-nominal">
                Nominal voucher (rupiah)
              </label>
              <input
                id="voucher-nominal"
                className="input"
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="Contoh: 2000"
              />
              <p className="text-[11px] text-ink-soft mt-1.5">
                Tanpa titik/koma. Isi <strong>0</strong> untuk mematikan insentif tanpa deploy. Batas maksimal{" "}
                {formatRupiah(maks.amount)}.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="voucher-berlaku">
                  Masa berlaku (hari)
                </label>
                <input
                  id="voucher-berlaku"
                  className="input"
                  inputMode="numeric"
                  value={form.validDays}
                  onChange={(e) => setForm({ ...form, validDays: e.target.value })}
                  placeholder="90"
                />
                <p className="text-[11px] text-ink-soft mt-1.5">1–{maks.validDays} hari sejak terbit.</p>
              </div>
              <div>
                <label className="label" htmlFor="voucher-jeda">
                  Jeda terbit (hari)
                </label>
                <input
                  id="voucher-jeda"
                  className="input"
                  inputMode="numeric"
                  value={form.delayDays}
                  onChange={(e) => setForm({ ...form, delayDays: e.target.value })}
                  placeholder="0"
                />
                <p className="text-[11px] text-ink-soft mt-1.5">
                  0 = langsung. Maks {maks.delayDays} hari setelah pesanan selesai.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { amount: "2000", validDays: "90", delayDays: "0" },
                { amount: "5000", validDays: "90", delayDays: "0" },
                { amount: "5000", validDays: "30", delayDays: "0" },
                { amount: "0", validDays: "90", delayDays: "0" },
              ].map((p) => (
                <button
                  key={`${p.amount}-${p.validDays}-${p.delayDays}`}
                  type="button"
                  className="btn-outline !py-1.5 text-xs"
                  onClick={() => setForm(p)}
                >
                  {p.amount === "0" ? "Matikan insentif" : `${formatRupiah(Number(p.amount))} · ${p.validDays} hari`}
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-surface-2 px-4 py-3 text-xs text-ink-soft space-y-1">
              <p className="font-semibold text-navy flex items-center gap-1.5">
                <Info size={14} /> Pratinjau
              </p>
              <p>
                Pelanggan menilai pesanan selesai → voucher{" "}
                <strong className="text-navy">{formatRupiah(Number(form.amount) || 0)}</strong>{" "}
                {Number(form.delayDays) > 0
                  ? `terbit ${Number(form.delayDays)} hari setelah pesanan selesai`
                  : "terbit segera"}
                , berlaku {Number(form.validDays) || 0} hari, dan dipotong dari total pesanan berikutnya.
              </p>
              <p>Penilaian ulang pesanan yang sama tidak memberi voucher kedua (dijaga unique index di database).</p>
            </div>

            <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Menyimpan..." : "Simpan insentif"}
            </button>

            {belumTersimpan && !saving && (
              <p className="text-[11px] text-amber font-medium">
                Belum disimpan — klik &quot;Simpan insentif&quot; untuk menerapkan{" "}
                {formatRupiah(Number(form.amount) || 0)} / {Number(form.validDays) || 0} hari.
              </p>
            )}

            {msg && (
              <p className={`text-xs font-medium ${msg.type === "ok" ? "text-mint" : "text-coral"}`}>{msg.text}</p>
            )}

            <p className="text-[11px] text-ink-soft border-t border-hairline pt-3">
              Voucher yang <strong>sudah terbit</strong> menyimpan nominal dan masa berlakunya sendiri — mengubah
              setelan tidak memperpendek voucher yang sudah dipegang pelanggan, dan tidak mengubah dasar diskon
              pesanan lama.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
