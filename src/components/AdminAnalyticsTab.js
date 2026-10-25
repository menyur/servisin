"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Info,
  Ticket,
  UserRound,
  XCircle,
} from "lucide-react";
import { formatRupiah } from "@/lib/pricing";
import {
  ANALITIK_HARI_DEFAULT,
  ANALITIK_HARI_PILIHAN,
  formatDurasiMenit,
  ringkasAnalitikAdmin,
} from "@/lib/admin-analytics";

function Kartu({ label, nilai, catatan, icon: Icon, tone = "navy" }) {
  const warna = {
    navy: "text-navy",
    brand: "text-brand-deep",
    amber: "text-amber",
    coral: "text-coral",
    mint: "text-mint",
  }[tone];
  return (
    <div className="card !p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
        {Icon && <Icon size={13} />}
        {label}
      </div>
      <p className={`font-display text-2xl font-bold mt-1 ${warna}`}>{nilai}</p>
      {catatan && <p className="text-[11px] text-ink-soft mt-0.5">{catatan}</p>}
    </div>
  );
}

/**
 * Tab "Analitik" panel admin — ringkasan, bukan laporan penuh.
 *
 * Semua angka dihitung dari daftar pesanan yang sudah dimuat panel, jadi tidak
 * menambah query dan ikut berubah saat realtime menambah pesanan. Periode
 * dihitung dari timestamp tahap yang relevan (selesai/dibatalkan/dibuat),
 * bukan dari tanggal halaman dibuka.
 */
export default function AdminAnalyticsTab({
  bookings = [],
  initialDays = ANALITIK_HARI_DEFAULT,
}) {
  const [hari, setHari] = useState(initialDays);
  const ringkas = useMemo(
    () => ringkasAnalitikAdmin({ bookings, hari }),
    [bookings, hari]
  );
  const { waktu, voucher, pembatalan } = ringkas;
  const pakaiStempelBayar = waktu.ditugaskan.sampel > 0;
  const tahapTugaskan = pakaiStempelBayar
    ? {
        label: "Dibayar → ditugaskan",
        nilai: waktu.ditugaskan.median,
        catatan: `${waktu.ditugaskan.sampel} pesanan`,
      }
    : {
        label: "Masuk → ditugaskan",
        nilai: waktu.ditugaskanDariMasuk.median,
        catatan: waktu.ditugaskanDariMasuk.sampel
          ? `${waktu.ditugaskanDariMasuk.sampel} pesanan · perkiraan`
          : "Butuh stempel klaim",
      };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-navy">Analitik Ringkas</h2>
          <p className="text-xs text-ink-soft mt-0.5">
            Dibuat dari pesanan yang sudah dimuat panel — tidak ada query tambahan.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink-soft font-semibold">Periode</span>
          {ANALITIK_HARI_PILIHAN.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setHari(n)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                hari === n
                  ? "bg-brand text-white border-brand"
                  : "bg-white text-ink-soft border-line hover:border-brand/50"
              }`}
            >
              {n} hari
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kartu
          label="Siklus total (median)"
          nilai={formatDurasiMenit(waktu.total.median)}
          catatan={`${waktu.total.sampel} pesanan selesai`}
          icon={Clock}
          tone="brand"
        />
        <Kartu
          label="Masuk → dibayar"
          nilai={formatDurasiMenit(waktu.dibayar.median)}
          catatan={
            waktu.dibayar.sampel
              ? `${waktu.dibayar.sampel} pesanan`
              : "Terisi saat admin konfirmasi bayar"
          }
          icon={Ticket}
        />
        <Kartu
          label={tahapTugaskan.label}
          nilai={formatDurasiMenit(tahapTugaskan.nilai)}
          catatan={tahapTugaskan.catatan}
          icon={UserRound}
          tone="amber"
        />
        <Kartu
          label="Ditugaskan → selesai"
          nilai={formatDurasiMenit(waktu.dikerjakan.median)}
          catatan={
            waktu.dikerjakan.sampel
              ? `${waktu.dikerjakan.sampel} pesanan`
              : "Butuh stempel klaim & selesai"
          }
          icon={Clock}
          tone="mint"
        />
      </div>

      <p className="text-[11px] text-ink-soft flex items-start gap-1.5 -mt-2">
        <Info size={13} className="shrink-0 mt-0.5" />
        Angka adalah <strong>median</strong> dari pesanan selesai pada periode ini. Pesanan lama
        yang tidak punya stempel waktu tidak dipalsukan — tahapnya hanya punya sampel lebih
        sedikit. Bila stempel konfirmasi bayar belum ada, tahap penugasan memakai ukuran
        <strong> masuk → ditugaskan</strong> dan diberi label berbeda. Median dipilih agar satu
        pesanan yang tertahan berhari-hari tidak menutupi kondisi biasanya.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-1">
            <Ticket size={15} className="text-brand" /> Pemakaian voucher
          </p>
          <p className="text-xs text-ink-soft mb-3">
            Pesanan yang dibuat dalam {hari} hari terakhir dan memakai diskon.
          </p>
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <p className="font-display text-2xl font-bold text-navy">{voucher.dipakai}</p>
              <p className="text-[11px] text-ink-soft">pesanan memakai voucher</p>
            </div>
            <div>
              <p className="font-display text-xl font-bold text-mint">
                {formatRupiah(voucher.totalDiskon)}
              </p>
              <p className="text-[11px] text-ink-soft">total diskon</p>
            </div>
            <div>
              <p className="font-display text-xl font-bold text-brand-deep">{voucher.persen}%</p>
              <p className="text-[11px] text-ink-soft">
                dari {voucher.totalPesanan} pesanan dibuat
              </p>
            </div>
          </div>
          {voucher.sumber.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {voucher.sumber.map((s) => (
                <span
                  key={s.sumber}
                  className="pill !px-2.5 !py-1 text-[11px] bg-brand-tint text-brand-deep font-semibold"
                >
                  {s.sumber}: {s.jumlah}
                </span>
              ))}
            </div>
          )}
          {voucher.dipakai === 0 && (
            <p className="text-xs text-ink-soft mt-3">Belum ada voucher terpakai pada periode ini.</p>
          )}
        </div>

        <div className="card">
          <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-1">
            <XCircle size={15} className="text-coral" /> Pembatalan
          </p>
          <p className="text-xs text-ink-soft mb-3">
            Pesanan yang dibatalkan pada periode ini, beserta alasannya.
          </p>
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <p className="font-display text-2xl font-bold text-coral">{pembatalan.total}</p>
              <p className="text-[11px] text-ink-soft">pembatalan</p>
            </div>
            <div>
              <p className="font-display text-xl font-bold text-navy">
                {pembatalan.tanpaTeknisi}
              </p>
              <p className="text-[11px] text-ink-soft">sebelum ada teknisi</p>
            </div>
          </div>
          {pembatalan.alasanTeratas && (
            <div className="mt-3 rounded-xl bg-coral-tint/50 border border-coral/30 px-3 py-2">
              <p className="text-[11px] font-semibold text-coral flex items-center gap-1.5">
                <AlertTriangle size={12} /> Alasan terbanyak
              </p>
              <p className="text-xs text-navy mt-0.5">
                &ldquo;{pembatalan.alasanTeratas.teks}&rdquo; · {pembatalan.alasanTeratas.jumlah}{" "}
                kali
              </p>
            </div>
          )}
          {pembatalan.alasan.length > 0 && (
            <ul className="mt-2 space-y-1">
              {pembatalan.alasan.map((a) => (
                <li
                  key={a.teks}
                  className="flex items-start justify-between gap-3 text-[11px] text-ink-soft"
                >
                  <span className="min-w-0 truncate" title={a.teks}>
                    {a.teks}
                  </span>
                  <span className="font-semibold text-navy shrink-0">{a.jumlah}×</span>
                </li>
              ))}
            </ul>
          )}
          {pembatalan.total === 0 && (
            <p className="text-xs text-ink-soft mt-3">Tidak ada pembatalan pada periode ini.</p>
          )}
        </div>
      </div>

      <div className="card">
        <p className="text-sm font-semibold text-navy flex items-center gap-2 mb-1">
          <UserRound size={15} className="text-amber" /> Pembatalan per teknisi
        </p>
        <p className="text-xs text-ink-soft mb-3">
          Hanya pembatalan pesanan yang sudah punya teknisi. Pesanan yang batal sebelum
          ditugaskan tidak dibebankan ke seseorang.
        </p>
        {pembatalan.perTeknisi.length === 0 ? (
          <p className="text-xs text-ink-soft py-2">
            Tidak ada pembatalan yang terkait teknisi pada periode ini.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {pembatalan.perTeknisi.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs font-semibold text-navy">{t.name}</span>
                <span className="pill !px-2.5 !py-1 text-[11px] bg-coral-tint text-coral font-bold">
                  {t.jumlah} batal
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
