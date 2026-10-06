"use client";

import { useEffect, useState } from "react";
import { getPaymentSettingsAdmin, savePaymentSettingsAdmin } from "@/app/actions/admin";
import { Landmark, Loader2, Save } from "lucide-react";

/**
 * Tab "Rekening Transfer" panel admin: nomor rekening resmi yang dipakai
 * metode "Transfer Bank" di web & aplikasi Flutter (tabel app_settings,
 * dibuat oleh supabase/migrate-transfer-settings.sql).
 */
export default function PaymentSettingsTab() {
  const [form, setForm] = useState({ bank: "", number: "", name: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getPaymentSettingsAdmin();
      if (!alive) return;
      if (r.error) setMsg({ type: "error", text: r.error });
      else setForm({ bank: r.bank, number: r.number, name: r.name });
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const r = await savePaymentSettingsAdmin(form);
    setSaving(false);
    setMsg(r.error ? { type: "error", text: r.error } : { type: "ok", text: "Rekening transfer tersimpan." });
  }

  return (
    <div className="max-w-xl">
      <div className="card !p-5">
        <h3 className="font-display font-semibold text-navy flex items-center gap-2 mb-1">
          <Landmark size={17} className="text-brand" /> Rekening Transfer Resmi
        </h3>
        <p className="text-xs text-ink-soft mb-4">
          Ditampilkan ke pelanggan saat memilih metode <strong>Transfer Bank</strong> di web dan aplikasi Flutter.
        </p>

        {loading ? (
          <p className="text-sm text-ink-soft flex items-center gap-2 py-6 justify-center">
            <Loader2 size={16} className="animate-spin" /> Memuat...
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">Nama bank</label>
              <input
                className="input"
                value={form.bank}
                onChange={(e) => setForm((f) => ({ ...f, bank: e.target.value }))}
                placeholder="Contoh: BCA"
              />
            </div>
            <div>
              <label className="label">Nomor rekening</label>
              <input
                className="input"
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                placeholder="Contoh: 1234567890"
              />
            </div>
            <div>
              <label className="label">Atas nama (opsional)</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Contoh: CV Fixify"
              />
            </div>

            <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Menyimpan..." : "Simpan rekening"}
            </button>

            {msg && (
              <p className={`text-xs font-medium ${msg.type === "ok" ? "text-mint" : "text-coral"}`}>{msg.text}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
