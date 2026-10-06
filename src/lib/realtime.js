"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Langganan Supabase Realtime (postgres_changes INSERT) untuk panel admin.
 *
 * Event menghormati RLS — hanya baris yang boleh dibaca admin yang
 * terkirim. Publication wajib memuat tabel (migrate-realtime-admin.sql);
 * bila belum, channel tetap ter-subscribe tapi TIDAK pernah menerima
 * event — aman, indikator tetap menampilkan koneksi.
 *
 * Fallback hardening: bila WS tidak tersambung (jaringan/restriksi),
 * interval ringan memanggil router.refresh() agar antrian tetap segar —
 * memenuhi tujuan "antrian muncul sendiri" tanpa bergantung WS.
 */
export function useAdminRealtime({ onNewBooking, onNewReport }) {
  const [live, setLive] = useState(false);
  const router = useRouter();
  const cbBooking = useRef(onNewBooking);
  const cbReport = useRef(onNewReport);
  cbBooking.current = onNewBooking;
  cbReport.current = onNewReport;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("admin-panel-live");

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bookings" },
        (payload) => cbBooking.current?.(payload.new)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reports" },
        (payload) => cbReport.current?.(payload.new)
      )
      .subscribe((status) => {
        // SUBSCRIBED = WS siap; CHANNEL_ERROR/TIMED_OUT/CLOSED = putus.
        setLive(status === "SUBSCRIBED");
      });

    // Fallback refresh berkala hanya saat WS belum tersambung.
    const fallback = setInterval(() => {
      setLive((isLive) => {
        if (!isLive) router.refresh();
        return isLive;
      });
    }, 60_000);

    return () => {
      clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return live;
}

/** Format "x detik lalu" untuk indikator — di-render ringan tiap detik. */
export function useAgoLabel(timestamp) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timestamp) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [timestamp]);
  if (!timestamp) return null;
  const s = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return s < 60 ? `${s} detik lalu` : `${Math.round(s / 60)} menit lalu`;
}
