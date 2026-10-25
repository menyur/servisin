"use client";

import { useMemo, useState } from "react";
import {
  Star,
  Search,
  Loader2,
  RefreshCw,
  Timer,
  CalendarCheck,
  ShieldAlert,
  TrendingUp,
  AlertTriangle,
  Eye,
  CircleHelp,
  Users,
  Pencil,
  CalendarOff,
  Trash2,
  X,
  Save,
} from "lucide-react";
import {
  deleteTechnicianLeaveAdmin,
  getTechnicianReadinessAdmin,
  getTechnicianScorecardAdmin,
  saveTechnicianLeaveAdmin,
  saveTechnicianSkillAreaAdmin,
} from "@/app/actions/admin";
import { formatRentangCuti } from "@/lib/technician-availability";
import {
  AMBANG,
  MIN_PEKERJAAN,
  PERIODE_HARI,
  TOLERANSI_MENIT,
  URUTAN,
  formatMenit,
  garansiPer100,
  persen,
  putusanTeknisi,
  ringkasPutusan,
  tepatWaktuPersen,
  urutkanSkor,
} from "@/lib/technician-scorecard";

/**
 * Tab "Kartu Skor Teknisi" (panel admin).
 *
 * Menjawab satu pertanyaan yang rating bintang tidak bisa jawab: teknisi mana
 * yang layak DIPERLUAS area/keahliannya, dan mana yang perlu DITEGUR. Tiga
 * sinyal ditampilkan berdampingan dengan rating — waktu tanggap, ketepatan
 * jadwal, dan garansi berulang — plus alasan berangka di balik setiap putusan.
 *
 * Aturan ambang & putusan ada di src/lib/technician-scorecard.js (diuji
 * scripts/verify-technician-scorecard.mjs), bukan di komponen ini: angka yang
 * menentukan nasib seseorang tidak boleh tersebar di JSX.
 */
export default function TechnicianScorecardTab({
  initialRows = [],
  initialDays = 90,
  initialError = null,
  initialReadiness = null,
}) {
  const [rows, setRows] = useState(initialRows || []);
  const [days, setDays] = useState(initialDays || 90);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState("perhatian");
  const [q, setQ] = useState("");

  // Keahlian/area/cuti datang dari tabel (bukan RPC skor) karena harus bisa
  // diubah. Dimuat di server; sesudah menyimpan, dimuat ulang dari action.
  const [kesiapan, setKesiapan] = useState(
    initialReadiness || { today: null, technicians: [], categories: [], leaves: [], cutiError: null }
  );
  const [atur, setAtur] = useState(null); // teknisi yang sedang diatur
  const [form, setForm] = useState({ skill: "", area: "", start: "", end: "", reason: "" });
  const [menyimpan, setMenyimpan] = useState(false);
  const [pesanAtur, setPesanAtur] = useState(null); // { jenis: "ok"|"error", teks }

  async function muatKesiapan() {
    const res = await getTechnicianReadinessAdmin();
    if (!res.error) setKesiapan(res);
    return res;
  }

  async function bukaAtur(t) {
    const res = await muatKesiapan();
    const data = res.error ? kesiapan : res;
    const segar = (data.technicians || []).find((x) => x.id === t.technicianId) || {};
    setAtur({
      id: t.technicianId,
      name: t.name,
      cutiHariIni: segar.cuti_hari_ini || null,
    });
    setForm({
      // Fallback ke nilai di kartu skor bila baris kesiapan tidak terbaca:
      // form kosong bisa menghapus keahlian/area yang sudah benar saat disimpan.
      skill: segar.skill ?? t.skill ?? "",
      area: segar.service_area ?? t.area ?? "",
      start: "",
      end: "",
      reason: "",
    });
    setPesanAtur(null);
  }

  async function simpanKeahlian() {
    if (!atur) return;
    setMenyimpan(true);
    setPesanAtur(null);
    try {
      const res = await saveTechnicianSkillAreaAdmin({
        technicianId: atur.id,
        skill: form.skill,
        serviceArea: form.area,
      });
      if (res.error) {
        setPesanAtur({ jenis: "error", teks: res.error });
      } else {
        await muatKesiapan();
        setPesanAtur({ jenis: "ok", teks: "Keahlian & area tersimpan." });
      }
    } catch (e) {
      setPesanAtur({ jenis: "error", teks: e?.message || "Gagal menyimpan." });
    } finally {
      setMenyimpan(false);
    }
  }

  async function simpanCuti() {
    if (!atur) return;
    setMenyimpan(true);
    setPesanAtur(null);
    try {
      const res = await saveTechnicianLeaveAdmin({
        technicianId: atur.id,
        startDate: form.start,
        endDate: form.end,
        reason: form.reason,
      });
      if (res.error) {
        setPesanAtur({ jenis: "error", teks: res.error });
      } else {
        await muatKesiapan();
        setForm((f) => ({ ...f, start: "", end: "", reason: "" }));
        setPesanAtur({ jenis: "ok", teks: "Cuti dicatat — teknisi ini tidak akan dipilih penugasan otomatis pada tanggal tersebut." });
      }
    } catch (e) {
      setPesanAtur({ jenis: "error", teks: e?.message || "Gagal mencatat cuti." });
    } finally {
      setMenyimpan(false);
    }
  }

  async function hapusCuti(id) {
    setMenyimpan(true);
    setPesanAtur(null);
    try {
      const res = await deleteTechnicianLeaveAdmin(id);
      if (res.error) setPesanAtur({ jenis: "error", teks: res.error });
      else {
        await muatKesiapan();
        setPesanAtur({ jenis: "ok", teks: "Catatan cuti dihapus." });
      }
    } catch (e) {
      setPesanAtur({ jenis: "error", teks: e?.message || "Gagal menghapus cuti." });
    } finally {
      setMenyimpan(false);
    }
  }

  async function muat(periode = days) {
    setLoading(true);
    try {
      const res = await getTechnicianScorecardAdmin(periode);
      if (res.error) {
        setError(res.error);
      } else {
        setRows(res.rows || []);
        setDays(res.days || periode);
        setError(null);
      }
    } catch (e) {
      setError(e?.message || "Gagal memuat kartu skor.");
    } finally {
      setLoading(false);
    }
  }

  const tersaring = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hasil = rows.filter(
      (r) =>
        !s ||
        (r.name || "").toLowerCase().includes(s) ||
        (r.email || "").toLowerCase().includes(s) ||
        (r.skill || "").toLowerCase().includes(s) ||
        (r.area || "").toLowerCase().includes(s)
    );
    return urutkanSkor(hasil, sort);
  }, [rows, q, sort]);

  const ringkas = useMemo(() => ringkasPutusan(rows), [rows]);

  /** Cuti yang masih berlaku/akan datang untuk satu teknisi (terdekat dulu). */
  const cutiTeknisi = (id) => {
    const hari = kesiapan.today;
    return (
      (kesiapan.leaves || [])
        .filter((c) => c.technician_id === id && (!hari || c.end_date >= hari))
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0] || null
    );
  };
  const jumlahCutiHariIni = (kesiapan.technicians || []).filter((t) => t.cuti_hari_ini).length;

  if (error && rows.length === 0) {
    return (
      <div className="card !p-6 text-center">
        <p className="text-coral font-medium">{error}</p>
        <button onClick={() => muat()} className="btn-outline !px-4 !py-2 text-sm mt-4 inline-flex items-center gap-1.5">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Coba muat ulang
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="card !p-4 mb-4 flex items-start gap-3">
        <CircleHelp size={16} className="text-brand mt-0.5 shrink-0" />
        <p className="text-xs text-ink-soft leading-relaxed">
          <span className="font-semibold text-navy">Cara membaca:</span> waktu tanggap = mulai bekerja setelah pekerjaan
          menjadi tanggung jawabnya; ketepatan jadwal = mulai ≤ awal slot + {TOLERANSI_MENIT} menit; garansi = klaim
          atas pekerjaannya          per 100 pekerjaan. Putusan butuh minimal {MIN_PEKERJAAN} pekerjaan selesai dan 3 sampel per
          metrik — angka kecil tidak dipakai menghukum.
          {jumlahCutiHariIni > 0 && (
            <span className="block mt-1 text-coral font-medium">
              {jumlahCutiHariIni} teknisi sedang cuti hari ini — tidak dipilih penugasan otomatis.
            </span>
          )}
        </p>
      </div>

      {/* Ringkasan putusan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="card !p-4">
          <div className="flex items-center gap-2 text-ink-soft text-xs mb-1">
            <Users size={14} /> Teknisi
          </div>
          <p className="font-display font-bold text-lg text-navy">{ringkas.total}</p>
        </div>
        <div className="card !p-4">
          <div className="flex items-center gap-2 text-ink-soft text-xs mb-1">
            <AlertTriangle size={14} /> Perlu ditinjau
          </div>
          <p className={`font-display font-bold text-lg ${ringkas.perluDitinjau ? "text-coral" : "text-navy"}`}>
            {ringkas.perluDitinjau}
          </p>
        </div>
        <div className="card !p-4">
          <div className="flex items-center gap-2 text-ink-soft text-xs mb-1">
            <TrendingUp size={14} /> Layak diperluas
          </div>
          <p className={`font-display font-bold text-lg ${ringkas.layakDiperluas ? "text-mint" : "text-navy"}`}>
            {ringkas.layakDiperluas}
          </p>
        </div>
        <div className="card !p-4">
          <div className="flex items-center gap-2 text-ink-soft text-xs mb-1">
            <Eye size={14} /> Pantau / data kurang
          </div>
          <p className="font-display font-bold text-lg text-navy">{ringkas.pantau + ringkas.dataKurang}</p>
        </div>
      </div>

      {/* Kontrol */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded-full border border-line overflow-hidden">
          {PERIODE_HARI.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => muat(n)}
              aria-pressed={days === n}
              className={`px-3 py-1.5 text-xs font-semibold ${days === n ? "bg-brand text-white" : "bg-white text-ink-soft hover:bg-brand-tint/40"}`}
            >
              {n === 30 ? "30 hari" : n === 90 ? "90 hari" : "1 tahun"}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-52">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / surel / keahlian / area..."
            className="input !pl-9 text-sm w-full"
          />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input !w-auto text-sm">
          {URUTAN.map((u) => (
            <option key={u.kunci} value={u.kunci}>
              Urut: {u.label}
            </option>
          ))}
        </select>
        <button onClick={() => muat()} className="btn-outline !px-4 !py-2 text-sm inline-flex items-center gap-1.5">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Muat ulang
        </button>
      </div>

      {error && <p className="text-xs text-coral mb-3">{error}</p>}

      {tersaring.length === 0 ? (
        <p className="text-ink-soft text-sm">
          {rows.length === 0 ? "Belum ada teknisi terdaftar." : "Tidak ada teknisi yang cocok dengan pencarian."}
        </p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {tersaring.map((t) => (
            <KartuTeknisi
              key={t.technicianId}
              t={t}
              cuti={cutiTeknisi(t.technicianId)}
              onAtur={bukaAtur}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-ink-soft mt-3">
        Periode {days} hari. Waktu tanggap & ketepatan jadwal mulai terekam sejak migrasi kartu skor dijalankan —
        pekerjaan lama tidak bisa dihitung ulang, jadi sampelnya bisa kosong walau riwayatnya panjang.
      </p>

      {atur && (
        <ModalAturTeknisi
          atur={atur}
          form={form}
          setForm={setForm}
          kesiapan={kesiapan}
          menyimpan={menyimpan}
          pesan={pesanAtur}
          onTutup={() => setAtur(null)}
          onSimpanKeahlian={simpanKeahlian}
          onSimpanCuti={simpanCuti}
          onHapusCuti={hapusCuti}
        />
      )}
    </div>
  );
}

/**
 * Modal keahlian/area + kalender cuti untuk satu teknisi.
 *
 * Ditempatkan di kartu (bukan tab terpisah) supaya keputusan "Layak diperluas"
 * langsung punya tombolnya: admin melihat alasan berangka, lalu mengubah
 * keahlian/area tanpa berpindah layar dan kehilangan konteks.
 */
function ModalAturTeknisi({ atur, form, setForm, kesiapan, menyimpan, pesan, onTutup, onSimpanKeahlian, onSimpanCuti, onHapusCuti }) {
  const cuti = (kesiapan.leaves || [])
    .filter((c) => c.technician_id === atur.id)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));

  return (
    <div className="fixed inset-0 z-50 bg-navy/40 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-line">
          <div>
            <p className="font-display font-bold text-navy">Keahlian, area & cuti</p>
            <p className="text-xs text-ink-soft">{atur.name}</p>
          </div>
          <button type="button" onClick={onTutup} className="p-1 rounded-lg hover:bg-brand-tint" aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {kesiapan.cutiError && (
            <p className="text-xs text-coral bg-coral-tint rounded-lg px-3 py-2">{kesiapan.cutiError}</p>
          )}

          <div>
            <label className="text-xs font-semibold text-navy block mb-1">Keahlian utama</label>
            <select
              value={form.skill}
              onChange={(e) => setForm((f) => ({ ...f, skill: e.target.value }))}
              className="input text-sm w-full"
            >
              <option value="">Tanpa filter keahlian (menerima semua kategori)</option>
              {(kesiapan.categories || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-ink-soft mt-1">
              Kosong = teknisi menerima semua kategori. Nilai ini juga dipakai filter pekerjaan di aplikasi & push.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-navy block mb-1">Area layanan</label>
            <input
              value={form.area}
              onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
              placeholder="mis. Serang, Cilegon"
              className="input text-sm w-full"
            />
            <p className="text-[11px] text-ink-soft mt-1">
              Beberapa area dipisah koma. Kosong = menerima semua area. Dipakai untuk pencocokan pekerjaan, bukan larangan.
            </p>
          </div>

          <button
            type="button"
            onClick={onSimpanKeahlian}
            disabled={menyimpan}
            className="btn-primary !px-4 !py-2 text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {menyimpan ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan keahlian & area
          </button>

          <div className="pt-3 border-t border-line">
            <p className="text-xs font-semibold text-navy flex items-center gap-1.5 mb-2">
              <CalendarOff size={14} /> Kalender cuti
            </p>
            {atur.cutiHariIni && (
              <p className="text-xs text-coral bg-coral-tint rounded-lg px-3 py-2 mb-2">
                Sedang cuti hari ini ({formatRentangCuti(atur.cutiHariIni.start_date, atur.cutiHariIni.end_date)}).
              </p>
            )}

            {cuti.length === 0 ? (
              <p className="text-xs text-ink-soft">Belum ada catatan cuti.</p>
            ) : (
              <ul className="space-y-1.5 mb-3">
                {cuti.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 bg-brand-tint/30 rounded-lg px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-navy">{formatRentangCuti(c.start_date, c.end_date)}</p>
                      {c.reason && <p className="text-[11px] text-ink-soft">{c.reason}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => onHapusCuti(c.id)}
                      disabled={menyimpan}
                      className="text-coral hover:bg-coral-tint rounded p-1 disabled:opacity-50"
                      aria-label={`Hapus cuti ${formatRentangCuti(c.start_date, c.end_date)}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!kesiapan.cutiError && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-ink-soft">
                  Mulai
                  <input
                    type="date"
                    value={form.start}
                    onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                    className="input text-sm w-full mt-0.5"
                  />
                </label>
                <label className="text-[11px] text-ink-soft">
                  Selesai
                  <input
                    type="date"
                    value={form.end}
                    onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                    className="input text-sm w-full mt-0.5"
                  />
                </label>
                <label className="text-[11px] text-ink-soft col-span-2">
                  Alasan (opsional)
                  <input
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="mis. cuti tahunan"
                    className="input text-sm w-full mt-0.5"
                  />
                </label>
                <button
                  type="button"
                  onClick={onSimpanCuti}
                  disabled={menyimpan || !form.start || !form.end}
                  className="btn-outline !px-4 !py-2 text-sm col-span-2 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {menyimpan ? <Loader2 size={14} className="animate-spin" /> : <CalendarOff size={14} />} Catat cuti
                </button>
              </div>
            )}
          </div>

          {pesan && (
            <p className={`text-xs rounded-lg px-3 py-2 ${pesan.jenis === "ok" ? "text-mint bg-mint-tint" : "text-coral bg-coral-tint"}`}>
              {pesan.teks}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const NADA = {
  "perlu-ditinjau": { pill: "bg-coral-tint text-coral", border: "border-coral/40", ikon: AlertTriangle },
  pantau: { pill: "bg-amber-tint text-amber", border: "border-amber/30", ikon: Eye },
  "data-kurang": { pill: "bg-brand-tint text-brand-deep", border: "border-line", ikon: CircleHelp },
  "layak-diperluas": { pill: "bg-mint-tint text-mint", border: "border-mint/40", ikon: TrendingUp },
};

function KartuTeknisi({ t, cuti = null, onAtur }) {
  const putusan = putusanTeknisi(t);
  const nada = NADA[putusan.kode] || NADA.pantau;
  const Ikon = nada.ikon;
  const tepat = tepatWaktuPersen(t);
  const telat = persen(t.lateJobs, t.punctualSamples);
  const garansi = garansiPer100(t);

  return (
    <div className={`card !p-4 border ${nada.border}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-semibold text-navy text-sm">{t.name}</p>
          <p className="text-xs text-ink-soft truncate">{t.email || "-"}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[10px]">
            <span className="pill bg-brand-tint text-brand-deep font-semibold">
              {t.skill ? `Keahlian: ${t.skill}` : "Keahlian belum diisi"}
            </span>
            <span className="pill bg-brand-tint text-brand-deep font-semibold">
              {t.area ? `Area: ${t.area}` : "Area belum diisi"}
            </span>
            {cuti && (
              <span className="pill bg-coral-tint text-coral font-semibold inline-flex items-center gap-1">
                <CalendarOff size={10} /> Cuti {formatRentangCuti(cuti.start_date, cuti.end_date)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          {t.rating !== null ? (
            <p className="text-sm font-display font-bold text-brand-deep inline-flex items-center gap-1">
              <Star size={13} className="text-amber fill-amber" /> {t.rating.toFixed(2)}
            </p>
          ) : (
            <p className="text-xs text-ink-soft">Belum ada rating</p>
          )}
          <p className="text-[10px] text-ink-soft">{t.ratingCount} ulasan</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-2 mt-3">
        <Kotak
          ikon={Timer}
          judul="Waktu tanggap"
          nilai={formatMenit(t.avgResponseMinutes)}
          sub={`${t.responseSamples} sampel`}
        />
        <Kotak
          ikon={CalendarCheck}
          judul="Ketepatan jadwal"
          nilai={tepat === null ? "—" : `${tepat}%`}
          sub={
            t.punctualSamples === 0
              ? "belum ada sampel"
              : `${t.onTimeJobs}/${t.punctualSamples} tepat · ${telat}% telat`
          }
          nilaiKelas={tepat !== null && telat >= AMBANG.telatPersenMerah ? "text-coral" : "text-navy"}
        />
        <Kotak
          ikon={ShieldAlert}
          judul="Garansi"
          nilai={`${t.warrantyClaims} klaim`}
          sub={
            garansi === null
              ? `${t.warrantyRevisits} kunjungan ulang`
              : `${garansi}/100 pekerjaan · ${t.warrantyRevisits} kunjungan ulang`
          }
          nilaiKelas={garansi !== null && garansi >= AMBANG.garansiPer100Merah ? "text-coral" : "text-navy"}
        />
      </div>

      <p className="text-[10px] text-ink-soft mt-2">
        {t.jobsCompleted} pekerjaan selesai
        {t.lastCompletedAt
          ? ` · terakhir ${new Date(t.lastCompletedAt).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}`
          : ""}
      </p>

      <div className="mt-3 pt-3 border-t border-line">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`pill text-[10px] font-bold inline-flex items-center gap-1 ${nada.pill}`}>
            <Ikon size={11} /> {putusan.label}
          </span>
          <span className="text-[11px] text-ink-soft">{putusan.ringkas}</span>
        </div>
        {putusan.alasan.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {putusan.alasan.slice(0, 4).map((a, i) => (
              <li key={i} className="text-[11px] text-ink-soft flex gap-1.5">
                <span className="text-line">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        )}
        {putusan.tindakan && <p className="text-[11px] text-navy mt-2 font-medium">{putusan.tindakan}</p>}
        {onAtur && (
          <button
            type="button"
            onClick={() => onAtur(t)}
            className="btn-outline !px-3 !py-1.5 text-[11px] mt-2.5 inline-flex items-center gap-1"
          >
            <Pencil size={11} /> Atur keahlian, area & cuti
          </button>
        )}
      </div>
    </div>
  );
}

function Kotak({ ikon: Ikon, judul, nilai, sub, nilaiKelas = "text-navy" }) {
  return (
    <div className="rounded-lg bg-brand-tint/30 px-2.5 py-2">
      <p className="text-[10px] text-ink-soft flex items-center gap-1">
        <Ikon size={11} /> {judul}
      </p>
      <p className={`text-sm font-display font-bold ${nilaiKelas}`}>{nilai}</p>
      <p className="text-[10px] text-ink-soft">{sub}</p>
    </div>
  );
}
