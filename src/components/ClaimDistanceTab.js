"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Gauge,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  Ruler,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  decideClaimPermitAdmin,
  getClaimDistanceReportAdmin,
  getClaimPermitsAdmin,
  updateClaimDistanceLimitAdmin,
} from "@/app/actions/admin";
import {
  BATAS_JARAK_KM_MAKS,
  BATAS_JARAK_KM_MIN,
  JARAK_HARI_DEFAULT,
  JARAK_HARI_PILIHAN,
  formatJarakMeter,
  formatPersen,
  ringkasSebaranJarak,
} from "@/lib/claim-distance";

/**
 * Tab "Jarak Klaim" — sebaran jarak teknisi → pesanan saat pekerjaan diambil,
 * plus batas lunaknya.
 *
 * Kenapa ada: `bookings.claim_distance_m` sudah mencatat jarak setiap klaim,
 * tetapi angkanya hanya bisa dibaca dengan SQL manual. Padahal keputusan
 * "perlukah radius layanan dibatasi?" hanya masuk akal bila tahu berapa banyak
 * klaim yang datang dari teknisi jauh.
 *
 * Batasnya LUNAK: begitu diaktifkan, klaim di atas batas ditolak di aplikasi
 * teknisi dengan kode `terlalu_jauh`, teknisi meminta izin, dan admin
 * memutuskan di bagian bawah tab ini. Bawaannya (dan bila migrasi belum jalan)
 * fitur ini NONAKTIF — tidak boleh tiba-tiba memblokir klaim di produksi.
 */

const TONE = {
  navy: "text-navy",
  brand: "text-brand-deep",
  amber: "text-amber",
  coral: "text-coral",
  mint: "text-mint",
};

function Kartu({ label, nilai, catatan, icon: Icon, tone = "navy" }) {
  return (
    <div className="card !p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
        {Icon && <Icon size={13} />}
        {label}
      </div>
      <p className={`font-display text-2xl font-bold mt-1 ${TONE[tone] || TONE.navy}`}>{nilai}</p>
      {catatan && <p className="text-[11px] text-ink-soft mt-0.5">{catatan}</p>}
    </div>
  );
}

/**
 * Ambil antrean izin dari server. Dipisah dari komponen supaya efek hanya
 * menerapkan hasilnya lewat callback (bukan setState langsung di badan efek).
 */
async function ambilIzinServer() {
  try {
    const res = await getClaimPermitsAdmin();
    if (res.error) return { error: res.error, pending: [], riwayat: [] };
    return { error: null, pending: res.pending || [], riwayat: res.riwayat || [] };
  } catch (e) {
    return {
      error: e?.message || "Gagal memuat permintaan izin.",
      pending: [],
      riwayat: [],
    };
  }
}

function waktu(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ClaimDistanceTab() {
  const [hari, setHari] = useState(JARAK_HARI_DEFAULT);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ terukurTotal: 0, tanpaJarak: 0, terpotong: false });
  const [batas, setBatas] = useState({ enabled: false, km: 20, sumber: "bawaan" });
  const [draftBatas, setDraftBatas] = useState({ enabled: false, km: 20 });
  const [pesanBatas, setPesanBatas] = useState(null);
  const [menyimpan, setMenyimpan] = useState(false);

  const [izin, setIzin] = useState({ pending: [], riwayat: [] });
  const [catatan, setCatatan] = useState({});
  const [memutuskan, setMemutuskan] = useState(null);
  const [izinError, setIzinError] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [reloadIzin, setReloadIzin] = useState(0);

  useEffect(() => {
    let hidup = true;
    ambilIzinServer().then((res) => {
      if (!hidup) return;
      setIzinError(res.error);
      setIzin({ pending: res.pending, riwayat: res.riwayat });
    });
    return () => {
      hidup = false;
    };
  }, [reloadIzin]);

  const muatIzin = () => {
    ambilIzinServer().then((res) => {
      setIzinError(res.error);
      setIzin({ pending: res.pending, riwayat: res.riwayat });
    });
  };

  useEffect(() => {
    let hidup = true;
    (async () => {
      setLoading(true);
      try {
        const res = await getClaimDistanceReportAdmin({ hari });
        if (!hidup) return;
        if (res.error) {
          setError(res.error);
          setRows([]);
          setMeta({ terukurTotal: 0, tanpaJarak: 0, terpotong: false });
        } else {
          setError(null);
          setRows(res.rows || []);
          setMeta({
            terukurTotal: res.terukurTotal ?? (res.rows || []).length,
            tanpaJarak: res.tanpaJarak ?? 0,
            terpotong: Boolean(res.terpotong),
          });
          if (res.batas) {
            setBatas(res.batas);
            setDraftBatas({ enabled: Boolean(res.batas.enabled), km: Number(res.batas.km) || 20 });
          }
        }
      } catch (e) {
        if (hidup) setError(e?.message || "Gagal memuat sebaran jarak klaim.");
      } finally {
        if (hidup) setLoading(false);
      }
    })();
    return () => {
      hidup = false;
    };
  }, [hari, reload]);

  const ringkas = ringkasSebaranJarak(rows, { totalTanpaJarak: meta.tanpaJarak });
  const maksBucket = Math.max(1, ...ringkas.buckets.map((b) => b.jumlah));
  const jauh = ringkas.ambang.find((a) => a.km === 20) || { jumlah: 0, persen: 0 };
  const sangatJauh = ringkas.ambang.find((a) => a.km === 30) || { jumlah: 0, persen: 0 };
  const tanpaJarak = meta.tanpaJarak;

  const baca = useCallback(() => {
    if (ringkas.terukur === 0) {
      return "Belum ada klaim yang membawa jarak pada periode ini. Angka mulai terisi setelah teknisi memakai aplikasi versi yang mengirim posisi saat menekan Ambil Pekerjaan.";
    }
    if (jauh.persen >= 30) {
      return `Sebagian besar klaim datang dari teknisi jauh (${formatPersen(jauh.persen)}% lebih dari 20 km). Ini kondisi yang paling layak ditangani radius: pertimbangkan batas 20–25 km dengan tombol izin admin untuk kasus langka, lalu lihat lagi sebarannya setelah dua minggu.`;
    }
    if (jauh.persen <= 10) {
      return `Hampir semua klaim dekat (${formatPersen(ringkas.ambang.find((a) => a.km === 10)?.persen ?? 0)}% dalam 10 km, hanya ${formatPersen(jauh.persen)}% lebih dari 20 km). Jarak bukan masalah di sini — menambah radius justru akan mengurangi pilihan kerja teknisi tanpa manfaat.`;
    }
    return `Sebaran campuran: ${formatPersen(jauh.persen)}% klaim lebih dari 20 km, ${formatPersen(sangatJauh.persen)}% lebih dari 30 km. Periksa area mana yang menumpuk di ember terakhir sebelum memutuskan batas — sering penyebabnya satu wilayah tanpa teknisi, bukan radius yang terlalu longgar.`;
  }, [ringkas, jauh.persen, sangatJauh.persen]);

  async function simpanBatas() {
    setMenyimpan(true);
    setPesanBatas(null);
    try {
      const res = await updateClaimDistanceLimitAdmin(draftBatas);
      if (res.error) {
        setPesanBatas({ ok: false, teks: res.error });
      } else {
        setBatas({ ...res.batas, sumber: "setelan" });
        setDraftBatas(res.batas);
        setPesanBatas({
          ok: true,
          teks: res.batas.enabled
            ? `Batas ${res.batas.km} km berlaku untuk klaim berikutnya. Teknisi di luar batas harus meminta izin.`
            : "Batas dimatikan — semua klaim kembali seperti sebelum batas dipasang.",
        });
      }
    } catch (e) {
      setPesanBatas({ ok: false, teks: e?.message || "Gagal menyimpan batas." });
    } finally {
      setMenyimpan(false);
    }
  }

  async function putuskan(id, setuju) {
    setMemutuskan(id);
    setIzinError(null);
    try {
      const res = await decideClaimPermitAdmin({ id, setuju, catatan: catatan[id] || null });
      if (res.error) {
        setIzinError(res.error);
      } else {
        setCatatan((c) => ({ ...c, [id]: "" }));
        setReload((n) => n + 1);
        setReloadIzin((n) => n + 1);
      }
    } catch (e) {
      setIzinError(e?.message || "Gagal memutuskan izin.");
    } finally {
      setMemutuskan(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-navy">Sebaran Jarak Klaim</h2>
          <p className="text-xs text-ink-soft mt-0.5">
            Jarak lurus teknisi → pin pesanan, diukur saat pekerjaan diambil.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {JARAK_HARI_PILIHAN.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setHari(n)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                hari === n ? "bg-brand text-white border-brand" : "bg-white text-ink-soft border-line"
              }`}
            >
              {n} hari
            </button>
          ))}
          <button
            type="button"
            onClick={() => setReload((x) => x + 1)}
            className="btn-outline !px-4 !py-2 text-sm inline-flex items-center gap-1.5"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Muat ulang
          </button>
        </div>
      </div>

      {error && (
        <div className="card !p-4 flex items-start gap-2">
          <AlertTriangle size={15} className="text-coral mt-0.5 shrink-0" />
          <p className="text-xs text-coral leading-relaxed">{error}</p>
        </div>
      )}

      {loading && !error && (
        <div className="card !p-6 flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 size={15} className="animate-spin" /> Menghitung sebaran jarak…
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kartu
              label="Klaim terukur"
              nilai={ringkas.terukur.toLocaleString("id-ID")}
              catatan={
                meta.terpotong
                  ? `dari ${meta.terukurTotal.toLocaleString("id-ID")} klaim — 5.000 terbaru dihitung`
                  : `${hari} hari terakhir`
              }
              icon={MapPin}
              tone="brand"
            />
            <Kartu
              label="Rata-rata jarak"
              nilai={ringkas.rataRata === null ? "—" : formatJarakMeter(ringkas.rataRata)}
              catatan={ringkas.median === null ? "butuh data" : `median ${formatJarakMeter(ringkas.median)}`}
              icon={Gauge}
            />
            <Kartu
              label="Lebih dari 20 km"
              nilai={`${formatPersen(jauh.persen)}%`}
              catatan={`${jauh.jumlah} klaim${ringkas.terjauh !== null ? ` · terjauh ${formatJarakMeter(ringkas.terjauh)}` : ""}`}
              icon={Ruler}
              tone={jauh.persen >= 30 ? "coral" : jauh.persen >= 15 ? "amber" : "mint"}
            />
            <Kartu
              label="Tanpa jarak"
              nilai={tanpaJarak.toLocaleString("id-ID")}
              catatan="GPS mati / aplikasi lama"
              icon={Info}
              tone={tanpaJarak > ringkas.terukur ? "amber" : "navy"}
            />
          </div>

          <div className="card !p-4">
            <p className="text-xs font-semibold text-navy mb-3">
              Sebaran per 5 km{ringkas.terukur > 0 ? ` — persentase dari ${ringkas.terukur} klaim terukur` : ""}
            </p>
            <div className="space-y-2">
              {ringkas.buckets.map((b) => (
                <div key={b.indeks} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-[11px] text-ink-soft tabular-nums">{b.label}</span>
                  <div className="flex-1 h-3 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${b.indeks >= 4 ? "bg-coral" : "bg-brand"}`}
                      style={{ width: `${Math.round((b.jumlah / maksBucket) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-[11px] text-right tabular-nums text-navy">
                    {b.jumlah} · {formatPersen(b.persen)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card !p-4 flex items-start gap-2">
            <Info size={15} className="text-brand mt-0.5 shrink-0" />
            <div className="text-xs text-ink-soft leading-relaxed space-y-2">
              <p>{baca()}</p>
              <p>
                Ember terakhir (<span className="font-semibold text-navy">≥50 km</span>) dikumpulkan jadi satu karena
                jarak ekstrem tidak boleh hilang dari grafik. Klaim{" "}
                <span className="font-semibold text-navy">tanpa jarak</span> tidak dihitung sebagai 0 km — GPS mati
                bukan berarti teknisi berada di lokasi.
              </p>
            </div>
          </div>

          {/* ---- Batas lunak: setelan + penjelasan aturan ---- */}
          <div className="card !p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2">
                <ShieldCheck size={16} className="text-brand mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-navy">Batas lunak jarak klaim</p>
                  <p className="text-xs text-ink-soft mt-0.5 max-w-xl leading-relaxed">
                    Klaim di atas batas ditolak dengan pesan berisi jarak & batasnya, lalu teknisi bisa{" "}
                    <span className="font-semibold">meminta izin</span> untuk pesanan itu saja. Jarak yang tidak
                    terukur (GPS mati) tidak diblokir — kalau diblokir, mematikan GPS justru menjadi jalan pintas.
                  </p>
                </div>
              </div>
              <span
                className={`pill text-[10px] font-semibold ${
                  batas.enabled ? "bg-mint-tint text-mint" : "bg-surface-2 text-ink-soft"
                }`}
              >
                {batas.enabled ? `AKTIF · ${batas.km} km` : "BELUM AKTIF"}
              </span>
            </div>

            <div className="mt-3 flex items-end gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-navy">
                <input
                  type="checkbox"
                  checked={draftBatas.enabled}
                  onChange={(e) => setDraftBatas((d) => ({ ...d, enabled: e.target.checked }))}
                />
                Aktifkan batas
              </label>
              <div>
                <label className="label !mb-1 text-[11px]">Batas (km)</label>
                <input
                  type="number"
                  className="input !w-28"
                  min={BATAS_JARAK_KM_MIN}
                  max={BATAS_JARAK_KM_MAKS}
                  value={draftBatas.km}
                  onChange={(e) => setDraftBatas((d) => ({ ...d, km: e.target.value }))}
                  disabled={!draftBatas.enabled}
                />
              </div>
              <button
                type="button"
                onClick={simpanBatas}
                disabled={menyimpan}
                className="btn-brand !px-4 !py-2 text-sm inline-flex items-center gap-1.5"
              >
                {menyimpan ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Simpan batas
              </button>
              {batas.sumber === "bawaan" && (
                <p className="text-[11px] text-ink-soft">
                  Setelan belum terbaca{batas.alasan ? ` (${batas.alasan})` : ""} — yang berlaku: nonaktif.
                </p>
              )}
            </div>

            {pesanBatas && (
              <p className={`mt-2 text-xs ${pesanBatas.ok ? "text-mint" : "text-coral"}`}>{pesanBatas.teks}</p>
            )}
          </div>

          {/* ---- Antrean izin ---- */}
          <div className="card !p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-navy">
                Menunggu izin{izin.pending.length ? ` (${izin.pending.length})` : ""}
              </p>
              <button
                type="button"
                onClick={muatIzin}
                className="text-xs text-brand-deep font-semibold inline-flex items-center gap-1"
              >
                <RefreshCw size={12} /> Muat ulang
              </button>
            </div>

            {izinError && <p className="mt-2 text-xs text-coral">{izinError}</p>}

            {!izinError && izin.pending.length === 0 && (
              <p className="mt-2 text-xs text-ink-soft">
                Tidak ada permintaan. Teknisi yang mencoba mengambil pekerjaan di luar batas akan muncul di sini
                beserta jaraknya.
              </p>
            )}

            <div className="mt-2 space-y-2">
              {izin.pending.map((r) => (
                <div key={r.id} className="rounded-xl border border-line px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy">
                        #{r.code} · {r.technician_name}
                      </p>
                      <p className="text-[11px] text-ink-soft mt-0.5">
                        {formatJarakMeter(r.distance_m)} (batas {r.limit_km} km) · {r.jadwal || "-"} · diminta{" "}
                        {waktu(r.created_at)}
                      </p>
                      {r.address && <p className="text-[11px] text-ink-soft mt-0.5 truncate">{r.address}</p>}
                      {r.note && <p className="text-[11px] text-navy mt-1">“{r.note}”</p>}
                    </div>
                    <div className="flex items-end gap-2 flex-wrap">
                      <input
                        className="input !w-44 !py-1.5 text-xs"
                        placeholder="Catatan (opsional)"
                        value={catatan[r.id] || ""}
                        onChange={(e) => setCatatan((c) => ({ ...c, [r.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        onClick={() => putuskan(r.id, true)}
                        disabled={memutuskan === r.id}
                        className="btn-brand !px-3 !py-1.5 text-xs inline-flex items-center gap-1"
                      >
                        {memutuskan === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}{" "}
                        Setujui
                      </button>
                      <button
                        type="button"
                        onClick={() => putuskan(r.id, false)}
                        disabled={memutuskan === r.id}
                        className="btn-outline !px-3 !py-1.5 text-xs inline-flex items-center gap-1"
                      >
                        <X size={12} /> Tolak
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {izin.riwayat.length > 0 && (
              <details className="mt-3">
                <summary className="text-[11px] text-brand-deep cursor-pointer select-none">
                  Keputusan terakhir ({izin.riwayat.length})
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {izin.riwayat.map((r) => (
                    <li key={r.id} className="text-[11px] text-ink-soft flex flex-wrap items-center gap-2">
                      <span
                        className={`pill text-[10px] font-semibold ${
                          r.status === "approved" ? "bg-mint-tint text-mint" : "bg-coral-tint text-coral"
                        }`}
                      >
                        {r.status === "approved" ? "Disetujui" : "Ditolak"}
                      </span>
                      <span className="text-navy font-medium">#{r.code}</span>
                      <span>{r.technician_name}</span>
                      <span>· {formatJarakMeter(r.distance_m)}</span>
                      <span>· {waktu(r.decided_at)}</span>
                      {r.used_at && <span className="text-mint">· sudah dipakai</span>}
                      {r.decision_note && <span>· “{r.decision_note}”</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </>
      )}
    </div>
  );
}
