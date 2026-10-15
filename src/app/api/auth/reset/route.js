import { NextResponse } from "next/server";
import { kirimTautanReset } from "@/lib/password-reset";

export const dynamic = "force-dynamic";

/**
 * Minta email tautan reset kata sandi.
 *
 * Dipakai APLIKASI FLUTTER (POST JSON dari `Api.sendPasswordReset`) dan tidak
 * dipakai jalur web — server action web memanggil src/lib/password-reset.js
 * langsung, tanpa perjalanan HTTP.
 *
 * Kenapa endpoint ini ada: mailer bawaan Supabase Auth hanya melayani anggota
 * tim project (2 pesan/jam), sehingga akun pelanggan biasa TIDAK PERNAH
 * menerima email reset walau aplikasi sudah menampilkan "Tautan terkirim!".
 * Di sini tautannya dibuat sendiri (service role) lalu dikirim Resend.
 *
 * Kontrak:
 *   - Sukses            → 200 `{ok:true}` — SELALU bentuk ini, baik alamatnya
 *     punya akun maupun tidak (perlindungan enumerasi; alasannya cuma masuk
 *     log server).
 *   - Bentuk email salah → 400 `{ok:false, error:"email_tidak_valid"}`
 *   - Diminta terlalu cepat untuk alamat yang sama → 429 (+`sisaDetik`).
 *     Jeda berlaku untuk semua alamat, jadi tidak membocorkan keberadaan akun.
 *   - Layanan email belum siap (env/kunci) → 503. Ini SENGAJA berbeda: "gagal
 *     karena server" tidak boleh menyamar jadi "email sudah dikirim" — persis
 *     bug yang membuat fitur ini tampak bekerja padahal tidak.
 *
 * Keamanan: endpoint publik tanpa token (pengguna lupa sandi sedang tidak punya
 * sesi). Penahan penyalahgunaan yang ada: jeda 60 detik per alamat. Kalau nanti
 * perlu lebih kuat, pasang CAPTCHA/Turnstile di depan — jangan menambah
 * pembatasan per-IP yang bisa mengunci pengguna satu kantor/WiFi.
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  // Site URL dipakai bila klien tidak menyebut tujuan balik (jalur web/curl).
  const hasil = await kirimTautanReset({
    email: body?.email,
    redirectTo: body?.redirectTo,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    origin: originDari(request),
  });

  if (hasil.ok) {
    // Bentuk respons TIDAK boleh menandai apakah akunnya ada / emailnya
    // berangkat: itu satu-satunya informasi yang tak boleh dibocorkan di sini.
    return NextResponse.json({ ok: true });
  }

  switch (hasil.alasan) {
    case "email_tidak_valid":
      return NextResponse.json(
        { ok: false, error: "email_tidak_valid", pesan: "Masukkan alamat email yang benar." },
        { status: 400 }
      );
    case "jeda":
      return NextResponse.json(
        {
          ok: false,
          error: "jeda_per_alamat",
          sisaDetik: hasil.sisaDetik,
          pesan: "Permintaan tautan baru saja dikirim. Tunggu sebentar sebelum meminta lagi.",
        },
        { status: 429 }
      );
    case "env":
      console.error("[api/auth/reset] lingkungan email belum siap:", hasil.pesan);
      return NextResponse.json(
        {
          ok: false,
          error: "email_belum_siap",
          pesan: "Layanan email belum siap di server. Hubungi admin.",
        },
        { status: 503 }
      );
    default:
      console.error("[api/auth/reset] gagal:", hasil.alasan, hasil.pesan);
      return NextResponse.json(
        {
          ok: false,
          error: "gagal_kirim_email",
          pesan: "Gagal mengirim email reset. Coba lagi nanti.",
        },
        { status: 502 }
      );
  }
}

/** Origin permintaan — cadangan terakhir bila NEXT_PUBLIC_SITE_URL kosong. */
function originDari(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

/** Preflight CORS untuk Flutter WEB (dev) — jalur aslinya aplikasi Android. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
