"use client";

import { useEffect, useState } from "react";
import {
  getAdminNotificationSettingsAdmin,
  saveAdminNotificationSettingsAdmin,
  getAdminEmailFailuresAdmin,
  retryAdminEmailAdmin,
  discardAdminEmailAdmin,
} from "@/app/actions/admin";
import { adminNotifyEventLabel } from "@/lib/admin-notify-events";
import {
  Mail,
  MailWarning,
  Loader2,
  Save,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

/** Kunci unik satu sel matriks: satu admin × satu peristiwa. */
const cellKey = (adminId, event) => `${adminId}::${event}`;

/** Waktu ringkas (WIB) untuk jejak kegagalan. */
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

/**
 * Tab "Notif Email Admin" panel admin: matriks peristiwa × admin untuk memilih
 * siapa saja yang menerima email notifikasi tiap jenis peristiwa.
 *
 * Model penyimpanannya OPT-OUT (tabel admin_notification_optouts): kotak yang
 * TIDAK dicentang = admin itu dimatikan untuk peristiwa tersebut. Admin baru
 * atau peristiwa baru otomatis dicentang (menerima), yaitu perilaku lama.
 *
 * Penyaringan penerima dilakukan di database lewat RPC admin_emails_for_event()
 * yang dipakai jalur web (src/lib/admin-email.js) maupun jalur antrean
 * (route /api/admin-email-worker), jadi setelan ini berlaku untuk pesanan,
 * laporan, setor/tarik saldo, pendaftaran, bukti bayar, dan lepas tugas.
 */
export default function AdminNotifyRecipientsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [events, setEvents] = useState([]);
  const [muted, setMuted] = useState(() => new Set()); // pasangan yang dimatikan
  const [warning, setWarning] = useState(null);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }
  // Jejak email yang gagal dikirim: { rows, antrean } dari server action.
  const [failures, setFailures] = useState([]);
  const [antrean, setAntrean] = useState(null);
  const [failureWarning, setFailureWarning] = useState(null);
  const [failureError, setFailureError] = useState(null);
  const [failureLoading, setFailureLoading] = useState(true);
  const [failureBusy, setFailureBusy] = useState(null);
  const [failureMsg, setFailureMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [res, jejak] = await Promise.all([
        getAdminNotificationSettingsAdmin(),
        getAdminEmailFailuresAdmin(),
      ]);
      if (!alive) return;
      if (res.error) {
        setMsg({ type: "error", text: res.error });
      } else {
        setAdmins(res.admins || []);
        setEvents(res.events || []);
        setMuted(new Set((res.optouts || []).map((o) => cellKey(o.adminId, o.event))));
        setWarning(res.warning || null);
      }
      if (jejak.error) {
        setFailureError(jejak.error);
      } else {
        setFailures(jejak.rows || []);
        setAntrean(jejak.antrean ?? null);
        setFailureWarning(jejak.warning || null);
      }
      setLoading(false);
      setFailureLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Muat ulang daftar jejak saja (tombol "Muat ulang" & setelah aksi). */
  async function muatJejak() {
    setFailureLoading(true);
    const jejak = await getAdminEmailFailuresAdmin();
    setFailureLoading(false);
    if (jejak.error) {
      setFailureError(jejak.error);
      return;
    }
    setFailureError(null);
    setFailures(jejak.rows || []);
    setAntrean(jejak.antrean ?? null);
    setFailureWarning(jejak.warning || null);
  }

  /** "Coba lagi" = kembalikan baris ke antrean; "Buang" = hapus barisnya. */
  async function tanganiJejak(row, aksi) {
    setFailureBusy(row.id);
    setFailureMsg(null);
    const res =
      aksi === "retry" ? await retryAdminEmailAdmin(row.id) : await discardAdminEmailAdmin(row.id);
    setFailureBusy(null);
    if (res.error) {
      setFailureMsg({ type: "error", text: res.error });
      return;
    }
    setFailureMsg({
      type: "ok",
      text:
        aksi === "retry"
          ? `Email "${adminNotifyEventLabel(row.event)}" dikembalikan ke antrean — worker berikutnya akan mencoba mengirimnya lagi.`
          : `Jejak email "${adminNotifyEventLabel(row.event)}" dibuang.`,
    });
    muatJejak();
  }

  function setCell(adminId, event, enabled) {
    setMuted((prev) => {
      const next = new Set(prev);
      const key = cellKey(adminId, event);
      if (enabled) next.delete(key);
      else next.add(key);
      return next;
    });
    setMsg(null);
  }

  /** Semua admin sekaligus untuk satu peristiwa (kolom baris). */
  function setRow(event, enabled) {
    setMuted((prev) => {
      const next = new Set(prev);
      for (const a of admins) {
        const key = cellKey(a.id, event);
        if (enabled) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const optouts = [...muted].map((k) => {
      const [adminId, event] = k.split("::");
      return { adminId, event };
    });
    const res = await saveAdminNotificationSettingsAdmin({ optouts });
    setSaving(false);
    if (res.error) return setMsg({ type: "error", text: res.error });
    setMsg({
      type: "ok",
      text:
        res.muted === 0
          ? "Tersimpan — semua admin menerima semua notifikasi."
          : `Tersimpan — ${res.muted} kombinasi admin × peristiwa dimatikan.`,
    });
  }

  if (loading) {
    return (
      <div className="card !p-5 flex items-center gap-2 text-sm text-ink-soft">
        <Loader2 size={15} className="animate-spin" /> Memuat pengaturan penerima notifikasi...
      </div>
    );
  }

  const emailless = admins.filter((a) => !a.email);
  // Migrasi belum dijalankan → tabel setelan tidak ada; kotak dinonaktifkan
  // supaya tidak terlihat seperti perubahan yang bisa disimpan.
  const locked = Boolean(warning);

  return (
    <div className="space-y-5">
      <div className="card !p-5">
        <h3 className="font-display font-semibold text-navy flex items-center gap-2 mb-1">
          <Mail size={17} className="text-brand" /> Penerima notifikasi email admin
        </h3>
        <p className="text-xs text-ink-soft">
          Centang admin yang <strong>mau menerima</strong> email untuk tiap jenis peristiwa. Yang tidak dicentang
          tidak akan dikirimi email jenis itu — notifikasi di panel tetap tampil untuk semua admin.
          {locked && " Pengaturan belum bisa diubah sampai migrasinya dijalankan."}
        </p>

        {warning && (
          <p className="mt-3 text-xs font-medium text-amber bg-amber-tint border border-amber/30 rounded-xl px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{warning}</span>
          </p>
        )}

        {emailless.length > 0 && (
          <p className="mt-3 text-xs font-medium text-coral bg-coral-tint border border-coral/30 rounded-xl px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              {emailless.map((a) => a.name).join(", ")} belum punya alamat email di profil, jadi tidak bisa menerima
              email apa pun. Isi emailnya di profil akun tersebut.
            </span>
          </p>
        )}

        {admins.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Belum ada akun berperan admin.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left font-semibold text-navy px-3 py-2 border-b border-line">Peristiwa</th>
                  {admins.map((a) => (
                    <th key={a.id} className="px-3 py-2 border-b border-line align-bottom min-w-[130px]">
                      <span className="block font-semibold text-navy text-xs truncate max-w-[150px]" title={a.name}>
                        {a.name}
                      </span>
                      <span
                        className={`block text-[10px] font-normal truncate max-w-[150px] ${a.email ? "text-ink-soft" : "text-coral"}`}
                        title={a.email}
                      >
                        {a.email || "tanpa email"}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2 border-b border-line" />
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const mutedCount = admins.filter((a) => muted.has(cellKey(a.id, ev.key))).length;
                  const noneLeft = admins.length > 0 && mutedCount === admins.length;
                  return (
                    <tr key={ev.key} className={noneLeft ? "bg-coral-tint/40" : ""}>
                      <td className="px-3 py-2.5 border-b border-line align-top">
                        <span className="block font-semibold text-navy text-xs">{ev.label}</span>
                        <span className="block text-[11px] text-ink-soft">{ev.hint}</span>
                        {noneLeft && !locked && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-coral">
                            <AlertTriangle size={11} /> tidak dikirim ke admin mana pun
                          </span>
                        )}
                      </td>
                      {admins.map((a) => {
                        const key = cellKey(a.id, ev.key);
                        const enabled = !muted.has(key) && Boolean(a.email);
                        return (
                          <td key={a.id} className="px-3 py-2.5 border-b border-line text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-brand cursor-pointer disabled:cursor-not-allowed"
                              checked={enabled}
                              disabled={!a.email || locked}
                              aria-label={`${ev.label} → ${a.name}`}
                              title={a.email ? undefined : "Admin ini belum punya email"}
                              onChange={(e) => setCell(a.id, ev.key, e.target.checked)}
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 border-b border-line whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setRow(ev.key, true)}
                          disabled={locked}
                          className="text-[11px] font-semibold text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Semua
                        </button>
                        <span className="text-ink-soft mx-1.5">·</span>
                        <button
                          type="button"
                          onClick={() => setRow(ev.key, false)}
                          disabled={locked}
                          className="text-[11px] font-semibold text-coral hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Kosongkan
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!locked && admins.length > 0 && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Menyimpan..." : "Simpan penerima"}
            </button>
            <span className="text-xs text-ink-soft">
              {muted.size === 0
                ? "Semua notifikasi dikirim ke semua admin."
                : `${muted.size} kombinasi admin × peristiwa dimatikan.`}
            </span>
          </div>
        )}

        {msg && (
          <p className={`mt-3 text-xs font-medium ${msg.type === "ok" ? "text-mint" : "text-coral"}`}>{msg.text}</p>
        )}
      </div>

      {/* --- Jejak email yang gagal: alasan + waktu, tidak hilang sendiri --- */}
      <div className="card !p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h4 className="font-display font-semibold text-navy text-sm flex items-center gap-2">
              <MailWarning size={16} /> Email yang gagal terkirim
            </h4>
            <p className="text-xs text-ink-soft mt-1 max-w-2xl">
              Notifikasi yang tidak berhasil dikirim disimpan di sini bersama alasan dari penyedia email — mis.
              kunci Resend tidak sah atau domain pengirim belum terverifikasi. Sebelum ini, kegagalan hanya tercatat
              di log server dan barisnya hilang setelah lima percobaan, sehingga &ldquo;email tidak sampai&rdquo; tidak bisa
              ditelusuri dari panel. Jejak disimpan 30 hari.
            </p>
          </div>
          <button
            type="button"
            onClick={muatJejak}
            disabled={failureLoading}
            className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 shrink-0"
          >
            {failureLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Muat ulang
          </button>
        </div>

        {failureWarning && (
          <p className="mt-3 text-xs font-medium text-amber bg-amber-tint border border-amber/30 rounded-xl px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{failureWarning}</span>
          </p>
        )}

        {failureError && <p className="mt-3 text-sm text-coral">{failureError}</p>}

        {!failureWarning && (
          <>
            <p className="mt-3 text-xs text-ink-soft">
              {antrean === null
                ? ""
                : antrean === 0
                  ? "Antrean pengiriman sedang kosong."
                  : `${antrean} email sedang menunggu dikirim (bukan kegagalan).`}
            </p>

            {failures.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">
                Tidak ada email admin yang gagal dikirim.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {failures.map((r) => {
                  const menyerah = Boolean(r.failed_at);
                  return (
                    <div key={r.id} className="rounded-xl border border-line p-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <span
                            className={`pill text-[11px] font-bold ${
                              menyerah ? "bg-coral-tint text-coral" : "bg-amber-tint text-amber"
                            }`}
                          >
                            {menyerah ? "Menyerah" : "Sedang dicoba lagi"}
                          </span>
                          <span className="ml-2 text-sm font-semibold text-navy">
                            {adminNotifyEventLabel(r.event)}
                          </span>
                          <p className="text-[11px] text-ink-soft mt-1">
                            Percobaan {r.attempts}/{r.max_attempts} · percobaan terakhir {waktuSingkat(r.last_attempt_at)}
                            {menyerah ? ` · menyerah ${waktuSingkat(r.failed_at)}` : ""} · masuk antrean {waktuSingkat(r.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => tanganiJejak(r, "retry")}
                            disabled={failureBusy === r.id}
                            className="btn-outline !py-1.5 !px-3 text-[11px] flex items-center gap-1.5"
                          >
                            {failureBusy === r.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RotateCcw size={12} />
                            )}
                            Coba lagi
                          </button>
                          <button
                            type="button"
                            onClick={() => tanganiJejak(r, "discard")}
                            disabled={failureBusy === r.id}
                            className="btn-outline !py-1.5 !px-3 text-[11px] flex items-center gap-1.5 !border-coral !text-coral"
                          >
                            <Trash2 size={12} /> Buang
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-coral bg-coral-tint/40 rounded-lg px-3 py-2 break-words">
                        {r.last_error || "Sebab kegagalan tidak tercatat."}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {failureMsg && (
          <p className={`mt-3 text-xs font-medium ${failureMsg.type === "ok" ? "text-mint" : "text-coral"}`}>
            {failureMsg.text}
          </p>
        )}
      </div>

      <div className="card !p-5">
        <h4 className="font-display font-semibold text-navy text-sm mb-2">Catatan</h4>
        <ul className="text-xs text-ink-soft space-y-1 list-disc pl-4">
          <li>
            Email yang benar-benar terkirim hanya bisa diverifikasi bila <code>RESEND_API_KEY</code> terisi di
            deployment web; tanpa itu isi email dicetak ke log server. <code>/api/health</code> melaporkan jumlah
            email yang gagal, jadi kegagalan kunci bisa terlihat tanpa membuka log.
          </li>
          <li>
            Laporan bulanan otomatis dan email ke pelanggan/teknisi tidak terpengaruh pengaturan ini — yang diatur di
            sini hanya email ke admin.
          </li>
          <li>Pengaturan ini menggantikan daftar &quot;semua admin&quot; pada notifikasi email, bukan notifikasi push.</li>
        </ul>
      </div>
    </div>
  );
}
