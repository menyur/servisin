import { NextResponse } from "next/server";
import { kirimVerifikasiPendaftaran, metadataPendaftaran, ipDariHeader } from "@/lib/signup-verification";

export const dynamic = "force-dynamic";

/**
 * Daftar akun baru + kirim email verifikasinya.
 *
 * Dipakai APLIKASI FLUTTER (POST JSON dari `Api.daftarAkun`) dan server action
 * web memanggil src/lib/signup-verification.js langsung, tanpa perjalanan HTTP.
 *
 * Kenapa endpoint ini ada. `supabase.auth.signUp` selalu meminta Supabase
 * mengirim email konfirmasi, dan mailer bawaannya hanya melayani anggota tim
 * project (2 pesan/jam) — pelanggan biasa tidak pernah menerima emailnya.
 * Lebih buruk: GoTrue mengirim email di dalam transaksi, jadi begitu kuota
 * habis PENDAFTARANNYA SENDIRI gagal dengan 429. Di sini akunnya dibuat lewat
 * Admin API (yang tidak mengirim email) lalu emailnya dikirim Resend.
 *
 * Kontrak:
 *   - Sukses             → 200 `{ok:true}` — SELALU bentuk ini, baik akunnya
 *     baru dibuat, sudah ada tapi belum terverifikasi (tautan dikirim ulang),
 *     maupun sudah terverifikasi (tidak ada email yang dikirim). Membedakannya
 *     akan menjadikan endpoint ini alat pemeriksa alamat terdaftar.
 *   - Bentuk email/sandi salah → 400. Tidak bergantung pada ada/tidaknya akun.
 *   - Diminta terlalu cepat   → 429 (+`sisaDetik`): jeda 60 detik per alamat,
 *     dan kuota per IP. Keduanya berlaku untuk semua alamat.
 *   - Layanan email belum siap (env/kunci) → 503. SENGAJA berbeda: "gagal
 *     karena server" tidak boleh menyamar jadi "email sudah dikirim".
 *
 * Keamanan: endpoint publik (pendaftar belum punya sesi). Akun dibuat lewat
 * Admin API, jadi batas pendaftaran bawaan Supabase TIDAK berlaku — penggantinya
 * jeda per alamat + kuota per IP di src/lib/signup-verification.js. Kalau nanti
 * perlu lebih kuat, pasang CAPTCHA/Turnstile di depan — jangan menambah
 * pembatasan per-IP yang lebih ketat tanpa itu, karena bisa mengunci pengguna
 * satu kantor/WiFi.
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  // Metadata dibentuk dari daftar bidang tetap: jangan teruskan `body` mentah,
  // sebab isinya berakhir di raw_user_meta_data yang dibaca trigger DB.
  const data = metadataPendaftaran({
    name: body?.name,
    phone: body?.phone,
    address: body?.address,
    role: body?.role,
    skill: body?.skill,
    ktpUrl: body?.ktp_url,
  });

  const hasil = await kirimVerifikasiPendaftaran({
    email: body?.email,
    password: body?.password,
    data,
    redirectTo: body?.redirectTo,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    origin: originDari(request),
    ip: ipDariHeader(request.headers),
    // Jalur API = aplikasi Android. Aplikasi tidak bisa menampilkan tantangan
    // Turnstile, jadi jalur ini hanya dijaga Turnstile bila TURNSTILE_WAJIB_API
    // dinyalakan secara sadar; selama belum, yang menjaga adalah pembatas
    // persisten per IP/alamat (src/lib/signup-guard.js).
    turnstileToken: body?.turnstile_token ?? null,
    asal: "api",
  });

  if (hasil.ok) {
    // Bentuk respons TIDAK boleh menandai apakah akunnya baru, sudah ada, atau
    // emailnya benar-benar berangkat.
    return NextResponse.json({ ok: true });
  }

  switch (hasil.alasan) {
    case "email_tidak_valid":
      return NextResponse.json(
        { ok: false, error: "email_tidak_valid", pesan: "Masukkan alamat email yang benar." },
        { status: 400 }
      );
    case "password_tidak_valid":
      return NextResponse.json(
        {
          ok: false,
          error: "password_tidak_valid",
          pesan: "Kata sandi minimal 6 karakter.",
        },
        { status: 400 }
      );
    case "jeda":
    case "jeda_alamat":
      return NextResponse.json(
        {
          ok: false,
          error: "jeda_per_alamat",
          sisaDetik: hasil.sisaDetik,
          pesan:
            hasil.pesan ||
            "Email verifikasi baru saja dikirim. Tunggu sebentar sebelum mendaftar lagi.",
        },
        { status: 429 }
      );
    case "jeda_ip":
      return NextResponse.json(
        {
          ok: false,
          error: "kuota_ip",
          sisaDetik: hasil.sisaDetik,
          pesan: hasil.pesan || "Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.",
        },
        { status: 429 }
      );
    case "batas_harian":
      return NextResponse.json(
        {
          ok: false,
          error: "batas_harian",
          sisaDetik: hasil.sisaDetik,
          pesan: hasil.pesan || "Batas pendaftaran harian dari jaringan ini tercapai. Coba lagi nanti.",
        },
        { status: 429 }
      );
    // Verifikasi keamanan (Turnstile) gagal — TIDAK bergantung pada ada/tidaknya
    // akun, jadi membedakannya tidak membocorkan apa pun.
    case "turnstile":
      return NextResponse.json(
        {
          ok: false,
          error: "verifikasi_keamanan",
          pesan: "Verifikasi keamanan gagal. Muat ulang lalu coba lagi.",
        },
        { status: 400 }
      );
    case "env":
      console.error("[api/auth/register] lingkungan email belum siap:", hasil.pesan);
      return NextResponse.json(
        {
          ok: false,
          error: "email_belum_siap",
          pesan: "Pendaftaran sedang tidak bisa mengirim email. Hubungi admin.",
        },
        { status: 503 }
      );
    default:
      console.error("[api/auth/register] gagal:", hasil.alasan, hasil.pesan);
      return NextResponse.json(
        {
          ok: false,
          error: "gagal_daftar",
          pesan: "Gagal membuat akun. Coba lagi nanti.",
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
