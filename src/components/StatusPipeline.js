"use client";

import { Check } from "lucide-react";

export const STATUS_STEPS = ["pending", "paid", "in_progress", "completed"];

export const STATUS_LABELS = {
  pending: "Menunggu Pembayaran",
  paid: "Dibayar",
  in_progress: "Dikerjakan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export function StatusPill({ status }) {
  const tones = {
    pending: "bg-amber-tint text-amber",
    paid: "bg-brand-tint text-brand-deep",
    in_progress: "bg-brand-tint text-brand-deep",
    completed: "bg-mint-tint text-mint",
    cancelled: "bg-coral-tint text-coral",
  };
  return <span className={`pill ${tones[status] || tones.pending}`}>{STATUS_LABELS[status] || status}</span>;
}

export function StatusPipeline({ current }) {
  if (current === "cancelled") {
    return (
      <div className="my-6 text-center">
        <StatusPill status="cancelled" />
        <p className="text-xs text-ink-soft mt-2">Pesanan ini telah dibatalkan.</p>
      </div>
    );
  }

  const idx = STATUS_STEPS.indexOf(current);
  return (
    <div className="flex items-center my-6">
      {STATUS_STEPS.map((step, i) => {
        const done = i <= idx;
        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center min-w-[60px]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${done ? "bg-brand border-brand text-white" : "border-line text-ink-soft bg-white"}`}>
                {done ? <Check size={14} /> : i + 1}
              </div>
              <span className={`mt-1.5 text-[11px] font-semibold text-center ${done ? "text-navy" : "text-ink-soft"}`}>
                {STATUS_LABELS[step]}
              </span>
            </div>
            {i < STATUS_STEPS.length - 1 && <div className={`flex-1 h-1 rounded mx-1 mb-5 ${i < idx ? "bg-brand" : "bg-line"}`} />}
          </div>
        );
      })}
    </div>
  );
}
