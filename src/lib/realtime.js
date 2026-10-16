"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * Dua lapis yang saling melengkapi:
 *
 *   1. EVENT WS → callback pemanggil (baris baru masuk daftar seketika).
 *   2. EVENT WS / tab kembali dilihat → router.refresh() (tertunda singkat).
 *
 * Lapis kedua itu bukan hiasan. Payload postgres_changes hanya berisi BARIS
 * MENTAH: tanpa join `services(name)`/`profiles(name)`, dan tanpa hitungan
 * server (papan harian "Hari Ini", lencana tab, antrean setor/penarikan) —
 * semuanya prop server yang dulu hanya berubah kalau admin menekan refresh.
 * Karena itu setiap event memicu satu refresh server, bukan hanya menambah
 * baris ke state klien.
 *
 * Fallback hardening: bila WS tidak tersambung (jaringan/restriksi),
 * interval ringan memanggil router.refresh() agar antrian tetap segar —
 * memenuhi tujuan "antrian muncul sendiri" tanpa bergantung WS. Refresh yang
 * sama juga dijalankan saat tab kembali dilihat, sebab browser menahan koneksi
 * WS di tab tersembunyi.
 */
/** Jeda sebelum refresh server setelah event realtime (ms). */
const REFRESH_TERTUNDA_MS = 800;

export function useAdminRealtime({ onNewBooking, onNewReport }) {
  const [live, setLive] = useState(false);
  const router = useRouter();
  // Callback terbaru disimpan lewat ref, tapi ditulis di dalam effect — bukan
  // saat render (menulis ref saat render dilarang React dan ditandai
  // react-hooks/refs). Handler WS selalu membaca `.current`, jadi tidak ada
  // closure basi meski langganannya hanya dibuat sekali.
  const cbBooking = useRef(onNewBooking);
  const cbReport = useRef(onNewReport);
  useEffect(() => {
    cbBooking.current = onNewBooking;
    cbReport.current = onNewReport;
  });

  // Satu refresh per GELOMBANG event: beberapa INSERT bisa datang hampir
  // bersamaan, dan refresh per event berarti render server beruntun.
  const timerRefresh = useRef(null);
  const segarkanServer = useCallback(() => {
    if (timerRefresh.current) clearTimeout(timerRefresh.current);
    timerRefresh.current = setTimeout(() => {
      timerRefresh.current = null;
      router.refresh();
    }, REFRESH_TERTUNDA_MS);
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    let channel = null;
    let dibatalkan = false;

    const bukaKanal = async () => {
      // ===== WAJIB: token pengguna dipasang SEBELUM kanal join =====
      // Inilah bug yang membuat antrian pesanan baru tidak muncul sampai admin
      // me-refresh halaman. Bila `subscribe()` dipanggil lebih dulu, join-nya
      // berangkat TANPA `access_token`: server menilai RLS sebagai anon,
      // kanal tetap melaporkan SUBSCRIBED (badge "Live" hijau) tetapi postgres
      // CHANGE-nya disaring habis — pelanggan/teknisi pemilik pesanan malah
      // tidak terpengaruh karena aplikasi Flutter memasang sesi lebih dulu.
      // Diukur langsung di browser: join tanpa access_token = 0 event INSERT.
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) {
        await supabase.realtime.setAuth(token);
      } else {
        // Tanpa sesi, event apa pun memang tidak akan lolos RLS — biarkan
        // kanal tetap dibuat supaya status koneksi jujur (Live/Offline).
        console.warn("[realtime] tidak ada sesi: kanal admin akan berjalan sebagai anon");
      }
      if (dibatalkan) return;

      channel = supabase.channel("admin-panel-live");
      channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "bookings" },
          (payload) => {
            // Dua-duanya: baris tampil seketika (tanpa join), lalu data server
            // menyusul lengkap dengan nama layanan/pelanggan & hitungan papan.
            cbBooking.current?.(payload.new);
            segarkanServer();
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "reports" },
          (payload) => {
            cbReport.current?.(payload.new);
            segarkanServer();
          }
        )
        .subscribe((status) => {
          // SUBSCRIBED = WS siap; CHANNEL_ERROR/TIMED_OUT/CLOSED = putus.
          setLive(status === "SUBSCRIBED");
        });
    };
    bukaKanal();

    // Token Supabase berumur ±1 jam. Tanpa ini, kanal yang sudah join akan
    // memakai token kedaluwarsa dan berhenti menerima event di tengah shift
    // admin — jenis kerusakan senyap yang sama dengan di atas.
    const { data: langgananAuth } = supabase.auth.onAuthStateChange((_peristiwa, session) => {
      const token = session?.access_token;
      if (token) supabase.realtime.setAuth(token);
    });

    // Fallback refresh berkala hanya saat WS belum tersambung.
    const fallback = setInterval(() => {
      setLive((isLive) => {
        if (!isLive) router.refresh();
        return isLive;
      });
    }, 60_000);

    // Tab tersembunyi: browser boleh menahan koneksi WS, dan event yang lewat
    // saat itu tidak diputar ulang. Sekali refresh saat tab kembali dilihat
    // menutup celah itu — tanpa perlu admin menekan apa pun.
    const saatKembaliTerlihat = () => {
      if (document.visibilityState === "visible") segarkanServer();
    };
    document.addEventListener("visibilitychange", saatKembaliTerlihat);

    return () => {
      dibatalkan = true;
      clearInterval(fallback);
      clearTimeout(timerRefresh.current);
      timerRefresh.current = null;
      document.removeEventListener("visibilitychange", saatKembaliTerlihat);
      langgananAuth?.subscription?.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [router, segarkanServer]);

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
