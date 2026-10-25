import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { notifyAdminEventFromClient } from "@/lib/admin-email";

export const dynamic = "force-dynamic";

/**
 * Aplikasi (Flutter) memberi tahu bahwa ada peristiwa yang perlu dinotifikasikan
 * ke ADMIN lewat EMAIL: pesanan baru, laporan baru, pengajuan setor saldo, atau
 * pengajuan TARIK saldo.
 *
 * Kenapa route ini ada di samping antrean `admin_email_outbox`:
 *   Aplikasi menulis langsung ke Supabase, jadi tidak ada server action yang
 *   bisa mengirim email saat itu. Bila migrasi antrean sudah dijalankan,
 *   trigger DB-lah yang memasukkan barisnya dan panggilan ini hanya menyapu
 *   antrean. Bila migrasi BELUM dijalankan, route ini mengirim emailnya
 *   langsung supaya fitur tetap berjalan (perilaku sama dengan jalur web).
 *
 * Keamanan:
 *   - Bearer token Supabase milik pemanggil; tanpa itu → 401.
 *   - Baris [refId] harus MILIK pemanggil, diperiksa lewat klien ber-JWT
 *     (RLS berjalan) — jadi tidak bisa memicu email tentang pesanan/laporan
 *     orang lain.
 *   - Isi email dibangun server dari database, bukan dari data yang dikirim
 *     klien (`event` + `refId` saja).
 *
 * Fire-and-forget di sisi klien: kegagalan kirim tidak pernah mengganggu alur
 * pembuatan pesanan/laporan/setoran di aplikasi.
 */

/** event → tabel + kolom kepemilikan yang harus sama dengan pemanggil. */
const OWNERSHIP = {
  new_booking: { table: "bookings", column: "user_id" },
  new_report: { table: "reports", column: "author_id" },
  new_deposit: { table: "balance_deposits", column: "technician_id" },
  // Pengajuan tarik saldo dari aplikasi: saldo sudah ditahan saat barisnya
  // dibuat, jadi admin harus tahu ada uang menunggu ditransfer.
  new_withdrawal: { table: "balance_withdrawals", column: "technician_id" },
};

export async function POST(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const event = typeof body.event === "string" ? body.event : null;
    const refId = typeof body.refId === "string" ? body.refId : null;
    if (!event || !refId) {
      return NextResponse.json({ error: "event & refId wajib" }, { status: 400 });
    }
    const rule = OWNERSHIP[event];
    if (!rule) return NextResponse.json({ error: "event tidak dikenal" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return NextResponse.json({ ok: false, skipped: "env-belum-lengkap" });
    }

    // Klien dengan JWT pemanggil — query di bawah berjalan atas identitasnya,
    // sehingga RLS-lah yang menegakkan kepemilikan.
    const sb = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: userErr,
    } = await sb.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: row } = await sb
      .from(rule.table)
      .select("id")
      .eq("id", refId)
      .eq(rule.column, user.id)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ ok: false, skipped: "bukan-milik-pemanggil" });
    }

    const path = await notifyAdminEventFromClient(sb, event, refId);
    return NextResponse.json({ ok: true, event, path });
  } catch (err) {
    console.error("[notify-admin-event] error:", err?.message);
    // Tetap 200 — gagal notifikasi bukan kegagalan alur di aplikasi.
    return NextResponse.json({ ok: false, error: err?.message });
  }
}

/** Preflight CORS untuk Flutter WEB (dev) — auth tetap lewat Bearer token. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
