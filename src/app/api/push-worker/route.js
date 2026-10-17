import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/notify";
import { fcmReadiness, sendFcmSelfTest } from "@/lib/fcm";
import { opsiPushDariAntrean } from "@/lib/push-payload";

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Worker antrean push: ambil batch push_outbox (security definer di DB,
 * FOR UPDATE SKIP LOCKED = aman multi-konsumen, maks 3 percobaan), kirim via
 * sendPushToUser (web-push + FCM sekaligus, menghormati notification_prefs per
 * peristiwa), lalu hapus barisnya HANYA bila ada perangkat yang benar-benar
 * menerima.
 *
 * Kenapa dicek: sendPushToUser tidak melempar error (fire-and-forget). Dulu
 * baris selalu dihapus setelah pemanggilan, sehingga kegagalan senyap — mis.
 * firebase-admin gagal init setelah upgrade v14 — membuat antrean terlihat
 * "berhasil terkirim" padahal tidak ada notifikasi yang sampai ke perangkat.
 * Sekarang `delivered == 0` → baris dibiarkan (attempts naik) untuk dicoba
 * ulang, dan jumlahnya dilaporkan di respons agar kelihatan dari luar.
 */
/**
 * GET /api/push-worker?selftest=1 — UJI SIAP KIRIM FCM (tanpa mengirim
 * notifikasi ke siapa pun): kirim ke token palsu dan nilai jawaban Google.
 * Dipakai gate go-live (npm run verify:notif-env) di CI/penjadwal.
 *
 * Hasilnya di-cache 60 detik per instance supaya pemanggil luar tidak bisa
 * memaksa server memanggil FCM berulang-ulang. Tanpa `?selftest=1` → 405
 * (jalur drain tetap POST saja).
 */
let selftestCache = { at: 0, hasil: null };
const SELFTEST_TTL_MS = 60_000;

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("selftest") !== "1") {
    return NextResponse.json(
      { error: "Method Not Allowed", pakai: "POST untuk menyapu antrean, GET ?selftest=1 untuk uji kirim FCM" },
      { status: 405 }
    );
  }
  const now = Date.now();
  if (selftestCache.hasil && now - selftestCache.at < SELFTEST_TTL_MS) {
    return NextResponse.json(
      { ok: selftestCache.hasil.ok, fcm: selftestCache.hasil, cache: true, umurDetik: Math.round((now - selftestCache.at) / 1000) },
      { status: 200 }
    );
  }
  try {
    const [kesiapan, kirim] = [await fcmReadiness(), await sendFcmSelfTest()];
    const hasil = {
      ready: kesiapan.ready,
      initError: kesiapan.error,
      lastSendError: kesiapan.lastSendError,
      selftest: kirim,
      ok: Boolean(kesiapan.ready && kirim.ok),
    };
    selftestCache = { at: now, hasil };
    return NextResponse.json({ ok: hasil.ok, fcm: hasil, cache: false }, { status: 200 });
  } catch (err) {
    console.error("[push-worker] selftest fatal:", err?.message);
    return NextResponse.json({ ok: false, error: "selftest-gagal" }, { status: 500 });
  }
}

export async function POST() {
  try {
    if (!SERVICE_URL || !SERVICE_KEY) {
      return NextResponse.json({ ok: false, skipped: "env-service-role-tidak-lengkap" });
    }
    const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: batch, error } = await admin.rpc("take_push_batch", { p_limit: 20 });
    if (error) {
      return NextResponse.json({ ok: false, error: "take_push_batch" }, { status: 500 });
    }
    if (!batch || batch.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let pending = 0;
    let dilewati = 0;
    await Promise.all(
      batch.map(async (item) => {
        try {
          // `data` (mis. bookingId notifikasi chat) HARUS ikut: tanpa itu app
          // hanya tahu rute tab, bukan percakapan mana yang harus dibuka.
          const hasil = await sendPushToUser(
            item.user_id,
            opsiPushDariAntrean(item)
          );
          // Tujuan akun uji (probe): barisnya DIBERESKAN tanpa kiriman. Kalau
          // dibiarkan, percobaannya terpakai habis untuk notifikasi yang tidak
          // pernah punya perangkat — dan muncul sebagai "tak ada perangkat
          // tujuan" seolah ada gangguan. Sama seperti jalur email admin.
          if (hasil?.skipped === "sumber-uji") {
            dilewati += 1;
            console.warn(`[push-worker] dilewati (akun uji): event=${item.event}`);
            await admin.rpc("complete_push", { p_id: item.id });
            return;
          }
          const delivered = Number(hasil?.total) || 0;
          if (delivered > 0) {
            await admin.rpc("complete_push", { p_id: item.id });
            sent += 1;
          } else {
            // Tidak ada perangkat tujuan (env FCM mati, token kosong, atau
            // prefs dimatikan) → jangan tandai terkirim; baris dicoba lagi
            // sampai max_attempts lalu dibuang DB.
            pending += 1;
            console.warn(
              `[push-worker] tak ada perangkat tujuan: event=${item.event} percobaan=${item.attempts}`
            );
          }
        } catch (err) {
          pending += 1;
          console.warn("[push-worker] gagal kirim:", err?.message);
          // biarkan baris tetap di outbox (attempts < max) → retry otomatis
        }
      })
    );

    return NextResponse.json({ ok: true, sent, pending, dilewati });
  } catch (err) {
    console.error("[push-worker] fatal:", err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
