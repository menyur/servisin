"use client";

import { useEffect, useState } from "react";
import {
  executeAccountDeletionAdmin,
  getAccountDeletionRequestsAdmin,
} from "@/app/actions/admin";
import {
  AlertTriangle,
  Check,
  Clock,
  Globe,
  IdCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";

/**
 * Tab "Hapus Akun": peninjauan & eksekusi permintaan penghapusan akun.
 *
 * Ini pengganti alat terminal (scripts/hapus-akun.mjs) supaya janji pemrosesan
 * yang tertulis di halaman /hapus-akun dan di surel pengguna tidak bergantung
 * pada siapa pun yang ingat menjalankan skrip. Cakupan syarat Google Play:
 * aplikasi Android & halaman web /hapus-akun keduanya bermuara ke daftar ini.
 *
 * DUA PENJAGA YANG SENGAJA TIDAK DILUNAKKAN
 *   1. Menjalankan berarti menghapus PERMANEN. Karena itu tombolnya baru aktif
 *      setelah admin mengetik kata konfirmasi — pola yang sama dengan dialog di
 *      aplikasi. Ini kenyamanan; keputusan sesungguhnya diperiksa lagi di server
 *      action (peran admin) dan di fungsi database (status permintaan).
 *   2. Bila pencabutan akses masuk gagal, hasilnya BUKAN sukses: panel menahan
 *      pesannya sebagai keadaan bahaya, karena datanya sudah dianonimkan tetapi
 *      akun masih bisa dipakai masuk.
 */

/** Kata yang harus diketik admin sebelum tombol hapus aktif. */
const KATA_KONFIRMASI = "HAPUS";

const LABEL_STATUS = {
  menunggu_konfirmasi: { text: "Menunggu konfirmasi email", cls: "bg-amber-tint text-amber" },
  diminta: { text: "Menunggu dijalankan", cls: "bg-coral-tint text-coral" },
  selesai: { text: "Selesai", cls: "bg-mint-tint text-mint" },
  ditolak: { text: "Ditolak otomatis", cls: "bg-line text-ink-soft" },
  dibatalkan: { text: "Dibatalkan pengguna", cls: "bg-line text-ink-soft" },
};

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

/** Selisih hari (dibulatkan) menuju tenggat janji pemrosesan. */
function sisaHari(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

export default function AccountDeletionAdminTab() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const [perluMigrasi, setPerluMigrasi] = useState(false);
  const [janjiHari, setJanjiHari] = useState(7);
  const [rencana, setRencana] = useState(null);
  const [filter, setFilter] = useState("diminta");
  const [openId, setOpenId] = useState(null); // baris yang sedang ditinjau
  const [ketik, setKetik] = useState({}); // id → kata konfirmasi yang diketik
  const [catatan, setCatatan] = useState({}); // id → catatan admin
  const [busyId, setBusyId] = useState(null);
  const [pesan, setPesan] = useState(null); // { tingkat, text }

  /** Muat ulang seluruh daftar (semua status; penyaringan terjadi di layar). */
  async function muat() {
    const res = await getAccountDeletionRequestsAdmin("semua");
    if (res.error) {
      setError(res.error);
      setPerluMigrasi(Boolean(res.perluMigrasi));
      return;
    }
    setError(null);
    setPerluMigrasi(false);
    setRequests(res.requests || []);
    if (res.janjiHari) setJanjiHari(res.janjiHari);
    if (res.rencana) setRencana(res.rencana);
  }

  // Muat pertama: pola yang sama dengan tab antrian lain — IIFE async dengan
  // penanda hidup, supaya tidak menyetel state setelah widget dilepas.
  useEffect(() => {
    let hidup = true;
    (async () => {
      const res = await getAccountDeletionRequestsAdmin("semua");
      if (!hidup) return;
      if (res.error) {
        setError(res.error);
        setPerluMigrasi(Boolean(res.perluMigrasi));
      } else {
        setError(null);
        setPerluMigrasi(false);
        setRequests(res.requests || []);
        if (res.janjiHari) setJanjiHari(res.janjiHari);
        if (res.rencana) setRencana(res.rencana);
      }
      setLoading(false);
    })();
    return () => {
      hidup = false;
    };
  }, []);

  async function muatUlang() {
    setLoading(true);
    await muat();
    setLoading(false);
  }

  async function jalankan(r) {
    setBusyId(r.id);
    setPesan(null);
    const res = await executeAccountDeletionAdmin(r.id, catatan[r.id] || "");
    setBusyId(null);

    if (res.error) {
      setPesan({ tingkat: "gagal", text: res.error });
      return;
    }

    const rincian = [];
    if (res.userId) rincian.push(`user_id ${res.userId}`);
    if (res.pelaksanaDicatat === false) rincian.push("catatan pelaksana gagal disimpan");
    if (res.berkasDihapus?.length) {
      const gagal = res.berkasDihapus.filter((b) => !b.ok).length;
      rincian.push(gagal ? `${gagal} berkas GAGAL dihapus` : `${res.berkasDihapus.length} berkas dihapus`);
    }
    if (res.surelTerkirim) rincian.push("surel pemberitahuan terkirim");
    else if (res.surelError) rincian.push(`surel pemberitahuan GAGAL — ${res.surelError}`);

    setPesan({
      tingkat: res.tingkat,
      text: `${res.pesan}${rincian.length ? ` (${rincian.join(" · ")})` : ""}`,
    });
    setOpenId(null);
    setKetik((prev) => ({ ...prev, [r.id]: "" }));
    setCatatan((prev) => ({ ...prev, [r.id]: "" }));
    await muat();
  }

  const jumlah = (status) => requests.filter((r) => r.status === status).length;
  const daftar = filter === "semua" ? requests : requests.filter((r) => r.status === filter);

  const FILTER = [
    { id: "diminta", label: `Menunggu dijalankan${jumlah("diminta") ? ` (${jumlah("diminta")})` : ""}` },
    { id: "menunggu_konfirmasi", label: `Belum dikonfirmasi${jumlah("menunggu_konfirmasi") ? ` (${jumlah("menunggu_konfirmasi")})` : ""}` },
    { id: "selesai", label: "Selesai" },
    { id: "ditolak", label: "Ditolak" },
    { id: "dibatalkan", label: "Dibatalkan" },
    { id: "semua", label: "Semua" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-ink-soft max-w-xl">
          Permintaan penghapusan akun dari aplikasi Android dan halaman web /hapus-akun masuk ke daftar
          yang sama. Menjalankan berarti menghapus identitas dan konten pribadi secara permanen — riwayat
          pesanan, saldo, dan penilaian tetap tersimpan tanpa nama sebagai catatan keuangan.
        </p>
        <button
          onClick={muatUlang}
          disabled={loading}
          className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 shrink-0"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Muat ulang
        </button>
      </div>

      {error && (
        <div className={`card text-sm space-y-1 ${perluMigrasi ? "text-amber" : "text-coral"}`}>
          <p className="font-semibold flex items-center gap-1.5">
            {perluMigrasi ? <AlertTriangle size={15} /> : <X size={15} />}
            {perluMigrasi ? "Jalur hapus akun belum aktif di database" : "Gagal memuat permintaan"}
          </p>
          <p>{error}</p>
        </div>
      )}

      {pesan && (
        <div
          className={`card text-sm ${
            pesan.tingkat === "bahaya" || pesan.tingkat === "gagal"
              ? "text-coral !border-coral"
              : pesan.tingkat === "sukses"
                ? "text-mint"
                : "text-ink-soft"
          }`}
        >
          <p className="flex items-start gap-1.5">
            {pesan.tingkat === "bahaya" || pesan.tingkat === "gagal" ? (
              <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            ) : pesan.tingkat === "sukses" ? (
              <Check size={15} className="mt-0.5 shrink-0" />
            ) : (
              <Clock size={15} className="mt-0.5 shrink-0" />
            )}
            <span>{pesan.text}</span>
          </p>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {FILTER.map((f) => (
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

      {loading && requests.length === 0 ? (
        <p className="card text-sm text-ink-soft flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Memuat permintaan…
        </p>
      ) : daftar.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-ink-soft">
            {filter === "diminta"
              ? "Tidak ada permintaan yang menunggu dijalankan."
              : "Tidak ada permintaan pada filter ini."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {daftar.map((r) => {
            const st = LABEL_STATUS[r.status] || { text: r.status, cls: "bg-line text-ink-soft" };
            const sisa = sisaHari(r.tenggat);
            const terlambat = r.status === "diminta" && sisa !== null && sisa < 0;
            const terbuka = openId === r.id;
            const siapKetik = (ketik[r.id] || "").trim() === KATA_KONFIRMASI;

            return (
              <div key={r.id} className="card !p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-navy">{r.email}</span>
                      <span className={`pill ${st.cls} text-xs font-bold`}>{st.text}</span>
                      <span className="pill bg-brand-tint text-brand-deep text-xs font-bold flex items-center gap-1">
                        {r.sumber === "web" ? <Globe size={11} /> : <Smartphone size={11} />}
                        {r.sumber === "web" ? "halaman web" : "aplikasi"}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft mt-1">
                      Diminta {waktuSingkat(r.createdAt)}
                      {r.sumber === "web"
                        ? ` · identitas dibuktikan lewat tautan email${r.confirmedAt ? ` (${waktuSingkat(r.confirmedAt)})` : ""}`
                        : " · identitas dibuktikan oleh sesi login"}
                      {r.userId ? ` · ${r.userId}` : " · tanpa akun terdaftar"}
                    </p>
                    {r.alasan && <p className="text-sm text-ink mt-2 italic">&ldquo;{r.alasan}&rdquo;</p>}
                    {r.status === "diminta" && sisa !== null && (
                      <p className={`text-xs mt-1 ${terlambat ? "text-coral font-semibold" : "text-ink-soft"}`}>
                        {terlambat
                          ? `Melewati janji ${janjiHari} hari — terlambat ${Math.abs(sisa)} hari.`
                          : `Sisa ${sisa} hari dari janji ${janjiHari} hari.`}
                      </p>
                    )}
                    {r.status === "diminta" && r.userId === null && (
                      <p className="text-xs text-ink-soft mt-1">
                        Surel ini tidak punya akun — menjalankan hanya menutup permintaannya.
                      </p>
                    )}
                  </div>
                  {r.status === "diminta" && (
                    <button
                      onClick={() => setOpenId(terbuka ? null : r.id)}
                      className="btn-outline !py-2 !px-3 text-xs shrink-0 flex items-center gap-1.5"
                    >
                      <Trash2 size={13} /> {terbuka ? "Tutup" : "Tinjau & jalankan"}
                    </button>
                  )}
                </div>

                {r.peringatan && (
                  <div className="mt-3 rounded-xl bg-amber-tint border border-amber/40 px-3 py-2 text-xs text-amber">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Perlu diperiksa sebelum dijalankan
                    </p>
                    <p className="mt-1">{r.peringatan}</p>
                  </div>
                )}

                {terbuka && (
                  <div className="mt-3 pt-3 border-t border-line space-y-3">
                    {rencana && (
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="rounded-xl bg-coral-tint/60 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-coral">Dihapus</p>
                          <ul className="mt-1 space-y-0.5 text-xs text-ink">
                            {rencana.dihapus.map((s) => (
                              <li key={s}>• {s}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-xl bg-mint-tint/60 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-mint">Tetap disimpan</p>
                          <ul className="mt-1 space-y-0.5 text-xs text-ink">
                            {rencana.disimpan.map((s) => (
                              <li key={s}>• {s}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                        Catatan admin (opsional, ikut tercatat)
                      </label>
                      <input
                        type="text"
                        className="input mt-1"
                        placeholder="mis. permintaan lewat email dukungan"
                        value={catatan[r.id] || ""}
                        onChange={(e) => setCatatan((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                    </div>

                    <div className="rounded-xl border-2 border-coral/40 px-3 py-2">
                      <label className="text-[11px] font-semibold text-coral uppercase tracking-wide flex items-center gap-1.5">
                        <IdCard size={12} /> Ketik {KATA_KONFIRMASI} untuk mengaktifkan tombol
                      </label>
                      <input
                        type="text"
                        className="input mt-1"
                        autoComplete="off"
                        placeholder={KATA_KONFIRMASI}
                        value={ketik[r.id] || ""}
                        onChange={(e) => setKetik((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => jalankan(r)}
                        disabled={busyId === r.id || !siapKetik}
                        className="btn-primary !py-2 !px-4 text-xs flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {busyId === r.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        Jalankan penghapusan permanen
                      </button>
                      <button
                        onClick={() => {
                          setOpenId(null);
                          setKetik((prev) => ({ ...prev, [r.id]: "" }));
                        }}
                        disabled={busyId === r.id}
                        className="btn-outline !py-2 !px-4 text-xs"
                      >
                        Batal
                      </button>
                      <span className="text-[11px] text-ink-soft">
                        Tidak bisa dibatalkan setelah dijalankan.
                      </span>
                    </div>
                  </div>
                )}

                {r.status !== "diminta" && (r.decidedAt || r.catatan) && (
                  <p className="mt-2 pt-2 border-t border-line text-xs text-ink-soft">
                    {r.decidedAt ? `Diputuskan ${waktuSingkat(r.decidedAt)}` : "Belum diputuskan"}
                    {r.catatan ? ` · catatan: ${r.catatan}` : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
