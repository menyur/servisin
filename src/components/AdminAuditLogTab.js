"use client";

import { useEffect, useState } from "react";
import { History, Search, Loader2, RefreshCw, ShieldCheck, UserRound, Clock } from "lucide-react";
import { getAdminAuditLogAdmin } from "@/app/actions/admin";
import { AUDIT_ENTITY_LABEL } from "@/lib/admin-audit";

/**
 * Tab "Jejak Audit" — siapa mengubah apa, kapan, dari nilai apa.
 *
 * Sebelum ini, perubahan harga, keahlian, peran, voucher, dan eksekusi hapus
 * akun hanya menyisakan KEADAAN AKHIR. Saat sengketa (saldo, KTP, penugasan),
 * pertanyaan pertama justru "siapa yang mengubah ini?" dan jawabannya tidak ada
 * di mana pun kecuali SQL manual.
 *
 * Tabelnya tambah-saja (tanpa policy UPDATE/DELETE), jadi yang ditampilkan di
 * sini tidak bisa "dirapikan" dari panel — termasuk oleh admin.
 */

const ENTITAS = Object.entries(AUDIT_ENTITY_LABEL);

function waktu(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** jsonb { kolom: nilai } → "harga: 50000 · is_active: true" */
function ringkasNilai(nilai) {
  if (!nilai || typeof nilai !== "object") return "—";
  const bagian = Object.entries(nilai)
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${v === null ? "kosong" : JSON.stringify(v)}`);
  return bagian.join(" · ") || "—";
}

export default function AdminAuditLogTab() {
  const [rows, setRows] = useState([]);
  const [entity, setEntity] = useState("");
  const [q, setQ] = useState("");
  const [cari, setCari] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await getAdminAuditLogAdmin({ entity: entity || undefined, q: cari || undefined });
        if (!alive) return;
        if (res.error) {
          setError(res.error);
          setRows([]);
        } else {
          setRows(res.rows || []);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e?.message || "Gagal memuat jejak audit.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [entity, cari, reload]);

  return (
    <div>
      <div className="card !p-4 mb-4 flex items-start gap-3">
        <ShieldCheck size={16} className="text-brand mt-0.5 shrink-0" />
        <p className="text-xs text-ink-soft leading-relaxed">
          <span className="font-semibold text-navy">Catatan tambah-saja.</span> Setiap baris menyalin nama admin
          saat tindakan dilakukan, jadi riwayatnya tetap terbaca walau akunnya kelak dihapus. Isi kolom{" "}
          <code>before</code>/<code>after</code> hanya memuat kolom yang berubah — dokumen pribadi seperti KTP dan
          nomor telepon tidak disalin.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className="input !w-auto text-sm">
          <option value="">Semua jenis</option>
          {ENTITAS.map(([kunci, label]) => (
            <option key={kunci} value={kunci}>
              {label}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCari(q.trim());
          }}
          className="relative flex-1 min-w-52"
        >
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari ringkasan atau nama admin…"
            className="input !pl-9 text-sm w-full"
          />
        </form>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="btn-outline !px-4 !py-2 text-sm inline-flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Muat ulang
        </button>
      </div>

      {error && <p className="text-xs text-coral mb-3">{error}</p>}

      {!error && !loading && rows.length === 0 && (
        <p className="text-sm text-ink-soft">
          Belum ada catatan{cari ? ` untuk pencarian “${cari}”` : ""}. Tindakan admin setelah migrasi dijalankan
          akan muncul di sini.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="card !p-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy">{r.summary}</p>
                <p className="text-[11px] text-ink-soft mt-1 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    <UserRound size={11} /> {r.admin_name || "admin (nama tidak tercatat)"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={11} /> {waktu(r.created_at)}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <span className="pill bg-brand-tint text-brand-deep text-[10px] font-semibold">
                  {AUDIT_ENTITY_LABEL[r.entity] || r.entity}
                </span>
                <span className="pill bg-surface-2 text-ink-soft text-[10px] font-mono">{r.action}</span>
              </div>
            </div>

            {(r.before || r.after) && (
              <details className="mt-2">
                <summary className="text-[11px] text-brand-deep cursor-pointer select-none inline-flex items-center gap-1">
                  <History size={11} /> Lihat nilai sebelum → sesudah
                </summary>
                <div className="mt-1.5 grid sm:grid-cols-2 gap-2">
                  <div className="rounded-lg bg-coral-tint/40 px-2.5 py-2">
                    <p className="text-[10px] font-semibold text-coral mb-0.5">Sebelum</p>
                    <p className="text-[11px] text-navy break-words">{ringkasNilai(r.before)}</p>
                  </div>
                  <div className="rounded-lg bg-mint-tint/50 px-2.5 py-2">
                    <p className="text-[10px] font-semibold text-mint mb-0.5">Sesudah</p>
                    <p className="text-[11px] text-navy break-words">{ringkasNilai(r.after)}</p>
                  </div>
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
