"use client";

import { useState } from "react";
import {
  createServiceOptionAdmin,
  updateServiceOptionAdmin,
  deleteServiceOptionAdmin,
} from "@/app/actions/admin";
import { formatRupiah } from "@/lib/pricing";
import { Loader2, Plus, Pencil, Trash2, Layers } from "lucide-react";

/**
 * Kelola varian layanan (mis. ukuran PK pada AC) — ditempel di kartu layanan
 * pada tab Harga Layanan panel admin. Layanan yang punya varian aktif
 * memaksa pemilihan varian di wizard booking, dan harga final diambil
 * dari varian (bukan base_price).
 */
export default function ServiceOptionsManager({ service, onOptionsChange }) {
  const [options, setOptions] = useState(null); // null = belum dimuat
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // form edit/tambah
  const emptyForm = { label: "", price: "", durationEstimate: "" };
  const [form, setForm] = useState(emptyForm);

  async function load() {
    setLoading(true);
    const { getServiceOptionsAdmin } = await import("@/app/actions/admin");
    const res = await getServiceOptionsAdmin(service.id);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOptions(res.options);
    onOptionsChange?.(service.id, res.options.length);
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && options === null) load();
  }

  function startAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setAdding(true);
    setError("");
  }

  function startEdit(opt) {
    setForm({ label: opt.label, price: opt.price, durationEstimate: opt.duration_estimate || "" });
    setEditingId(opt.id);
    setAdding(false);
    setError("");
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = adding
      ? await createServiceOptionAdmin(service.id, form)
      : await updateServiceOptionAdmin(editingId, form);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOptions((os) =>
      adding
        ? [...(os || []), res.option].sort((a, b) => a.sort_order - b.sort_order)
        : (os || []).map((o) => (o.id === editingId ? res.option : o))
    );
    onOptionsChange?.(service.id, (options || []).length + (adding ? 1 : 0));
    setAdding(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function remove(opt) {
    if (!confirm(`Hapus varian "${opt.label}"? Booking lama tidak terpengaruh.`)) return;
    setBusy(true);
    const res = await deleteServiceOptionAdmin(opt.id);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    const rest = (options || []).filter((o) => o.id !== opt.id);
    setOptions(rest);
    onOptionsChange?.(service.id, rest.length);
  }

  const count = options?.length;

  return (
    <div className="mt-3 pt-3 border-t border-line">
      <button
        onClick={toggleOpen}
        className="text-xs font-semibold text-brand hover:text-brand-deep flex items-center gap-1.5"
      >
        <Layers size={13} />
        Varian ukuran {count ? `(${count})` : ""}
        <span className="text-ink-soft font-normal">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && <p className="text-xs text-ink-soft flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Memuat varian...</p>}

          {options !== null && options.length === 0 && !adding && (
            <p className="text-xs text-ink-soft">Belum ada varian — harga memakai harga dasar.</p>
          )}

          {(options || []).map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-sm">
              {editingId === o.id ? (
                <form onSubmit={save} className="flex-1 space-y-2 bg-brand-tint/40 rounded-xl p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] font-semibold text-navy">Nama varian</span>
                      <input className="input mt-0.5 !py-1.5 text-sm" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="1 PK" required />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold text-navy">Harga (Rp)</span>
                      <input type="number" min="0" className="input mt-0.5 !py-1.5 text-sm" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-navy">Estimasi durasi (opsional)</span>
                    <input className="input mt-0.5 !py-1.5 text-sm" value={form.durationEstimate} onChange={(e) => setForm((f) => ({ ...f, durationEstimate: e.target.value }))} placeholder="45-60 menit" />
                  </label>
                  {error && <p className="text-xs text-coral font-medium">{error}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy} className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1 disabled:opacity-60">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : null} Simpan
                    </button>
                    <button type="button" onClick={() => { setEditingId(null); setError(""); }} className="btn-outline !px-3 !py-1.5 text-xs">
                      Batal
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <span className="flex-1 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-navy">{o.label}</span>
                    <span className="text-brand font-bold">{formatRupiah(o.price)}</span>
                    {o.duration_estimate && <span className="text-[10px] text-ink-soft">{o.duration_estimate}</span>}
                    {!o.is_active && <span className="text-[10px] font-bold uppercase text-ink-soft bg-line px-1.5 py-0.5 rounded-full">Nonaktif</span>}
                  </span>
                  <button onClick={() => startEdit(o)} className="text-ink-soft hover:text-brand p-1" aria-label={`Edit ${o.label}`}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => remove(o)} className="text-ink-soft hover:text-coral p-1" aria-label={`Hapus ${o.label}`}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}

          {adding && editingId === null && (
            <form onSubmit={save} className="space-y-2 bg-brand-tint/40 rounded-xl p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-semibold text-navy">Nama varian</span>
                  <input className="input mt-0.5 !py-1.5 text-sm" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="contoh: 2 PK" required />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-navy">Harga (Rp)</span>
                  <input type="number" min="0" className="input mt-0.5 !py-1.5 text-sm" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="110000" required />
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] font-semibold text-navy">Estimasi durasi (opsional)</span>
                <input className="input mt-0.5 !py-1.5 text-sm" value={form.durationEstimate} onChange={(e) => setForm((f) => ({ ...f, durationEstimate: e.target.value }))} placeholder="60-75 menit" />
              </label>
              {error && <p className="text-xs text-coral font-medium">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1 disabled:opacity-60">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Tambah varian
                </button>
                <button type="button" onClick={() => { setAdding(false); setError(""); }} className="btn-outline !px-3 !py-1.5 text-xs">
                  Batal
                </button>
              </div>
            </form>
          )}

          {!adding && editingId === null && (
            <button onClick={startAdd} className="text-xs font-semibold text-brand hover:text-brand-deep flex items-center gap-1 mt-1">
              <Plus size={12} /> Tambah varian
            </button>
          )}

          {error && editingId === null && !adding && <p className="text-xs text-coral font-medium">{error}</p>}
        </div>
      )}
    </div>
  );
}
