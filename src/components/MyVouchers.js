"use client";

import { useEffect, useMemo, useState } from "react";
import { getMyVouchers } from "@/app/actions/reviews";
import { formatRupiah, VOUCHER_VALIDITY_DAYS } from "@/lib/pricing";
import { Gift, Copy, Check, Ticket } from "lucide-react";

/**
 * Tab "Voucher Saya" di dashboard pelanggan:
 * daftar voucher aktif (insentif penilaian) + cara pakai.
 */
export default function MyVouchers() {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    let alive = true;
    getMyVouchers().then(({ vouchers: data }) => {
      if (!alive) return;
      setVouchers(data || []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 86_400_000));

  if (loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-ink-soft text-sm">Memuat voucher...</p>
      </div>
    );
  }

  if (vouchers.length === 0) {
    return (
      <div className="card text-center py-10 flex flex-col items-center gap-2">
        <Gift size={36} className="text-amber mx-auto mb-1" />
        <p className="text-ink-soft">Belum ada voucher aktif.</p>
        <p className="text-xs text-ink-soft max-w-sm">
          Nilai pesananmu yang selesai lebih dari {3} hari (lewat tombol{" "}
          <span className="font-semibold">Nilai Teknisi</span> di kartu pesanan) dan dapatkan voucher
          diskon {formatRupiah(10000)} untuk booking berikutnya.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <Ticket size={16} className="text-brand" />
        {vouchers.length} voucher aktif — otomatis bisa dipakai saat booking berikutnya, atau salin kodenya.
      </div>
      {vouchers.map((v) => (
        <div
          key={v.id}
          className="card !p-4 flex items-center justify-between gap-3 flex-wrap border-2 !border-mint/40"
        >
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-mint-tint text-mint flex items-center justify-center shrink-0">
              <Gift size={20} />
            </span>
            <div>
              <p className="font-display font-bold text-navy flex items-center gap-2">
                {formatRupiah(v.amount)}
                <code className="text-xs font-mono bg-brand-tint text-brand-deep px-2 py-0.5 rounded-md tracking-wide">
                  {v.code}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(v.code);
                    setCopiedId(v.id);
                    setTimeout(() => setCopiedId(null), 1500);
                  }}
                  className="text-ink-soft hover:text-navy"
                  aria-label="Salin kode voucher"
                >
                  {copiedId === v.id ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
                </button>
              </p>
              <p className="text-xs text-ink-soft mt-0.5">
                Berlaku {daysLeft(v.expires_at)} hari lagi · insentif penilaian pesanan
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-mint bg-mint-tint px-3 py-1.5 rounded-full">
            Siap dipakai
          </span>
        </div>
      ))}
      <p className="text-xs text-ink-soft">
        Cara pakai: voucher otomatis muncul sebagai opsi diskon di langkah Rincian Biaya saat membuat
        booking baru. Masa berlaku {VOUCHER_VALIDITY_DAYS} hari sejak diterbitkan.
      </p>
    </div>
  );
}
