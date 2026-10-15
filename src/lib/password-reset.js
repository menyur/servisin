/**
 * Kirim tautan reset kata sandi lewat Resend — BUKAN lewat mailer Supabase.
 *
 * Kenapa ada. `resetPasswordForEmail` (mailer bawaan Supabase Auth) menolak
 * mengirim ke alamat yang bukan anggota tim project dan membatasi 2 pesan per
 * jam; kalau batas itu kena, jawabannya `429 over_email_send_rate_limit` dan
 * email reset TIDAK PERNAH ada — sementara aplikasi menampilkan "Tautan
 * terkirim!". Batas itu tidak bisa dinaikkan dari kode; ia setelan project.
 *
 * Jadi tautannya dibuat di sini (`admin.generateLink`, service role) lalu
 * emailnya dikirim lewat Resend yang sudah aktif dan domainnya terverifikasi —
 * sama seperti email notifikasi lain (src/lib/email.js). Batas Supabase hilang
 * dari alur, dan isi emailnya bisa kita jamin.
 *
 * Kontrak keamanan (dijaga scripts/verify-reset-endpoint.mjs):
 *   1. Alamat tidak terdaftar → hasil yang SAMA seperti alamat terdaftar
 *      (`{ok:true, terkirim:false}`), jadi tidak bisa dipakai enumerasi akun.
 *      Ini juga alasan setiap kegagalan `generateLink` dilaporkan seragam ke
 *      pemanggil — sebabnya cukup masuk log server.
 *   2. Jeda per alamat 60 detik berlaku untuk SEMUA alamat (dicatat sebelum
 *      akunnya diketahui), jadi 429 pun tidak membocorkan keberadaan akun.
 *   3. Hanya alamat yang bentuknya tidak valid yang dijawab berbeda — itu tidak
 *      bergantung pada ada/tidaknya akun.
 *
 * Batas yang diketahui: riwayat jeda disimpan di memori proses. Di serverless
 * (Vercel) setiap instance punya peta sendiri, jadi jeda ini penjaga praktis,
 * bukan penegak kuota; penahan penyalahgunaan sungguhan perlu CAPTCHA/Turnstile
 * di depan endpoint. Beda dengan menyimpan di database, tidak ada migrasi yang
 * perlu dijalankan sebelum fitur ini berfungsi — itu disengaja.
 *
 * Modul ini sengaja tanpa alias `@/…` supaya bisa diimpor skrip `verify:*` yang
 * berjalan di Node polos (tanpa bundler Next) — di situlah alurnya diuji.
 */
import { createAdminClient } from "./supabase/admin.js";
import { sendPasswordResetEmail } from "./email.js";

/** Jeda wajib antar-permintaan untuk alamat yang sama (selaras dengan app). */
export const JEDA_PER_ALAMAT_MS = 60_000;

/** Masa berlaku tautan — ikut setelan "Email OTP Expiration" project (1 jam). */
export const BERLAKU_JAM = 1;

/** Riwayat permintaan per alamat: email → waktu ms permintaan terakhir DITERIMA. */
const riwayat = new Map();

/**
 * Rapikan & sahkan alamat email. `null` bila bentuknya tidak masuk akal.
 * Dipakai jalur API maupun server action web supaya aturannya satu.
 */
export function normalisasiEmail(nilai) {
  if (typeof nilai !== "string") return null;
  const email = nilai.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

/**
 * Sisa waktu tunggu (detik) untuk alamat ini. Murni supaya bisa diuji tanpa jam
 * sistem dan tanpa jaringan.
 *
 * @param {number} terakhirMs waktu permintaan terakhir (NaN/undefined = belum pernah)
 * @param {number} sekarangMs  waktu sekarang
 * @param {number} [jedaMs]
 */
export function sisaJedaDetik(terakhirMs, sekarangMs, jedaMs = JEDA_PER_ALAMAT_MS) {
  if (!Number.isFinite(terakhirMs) || !Number.isFinite(sekarangMs)) return 0;
  const sisa = jedaMs - (sekarangMs - terakhirMs);
  return sisa > 0 ? Math.ceil(sisa / 1000) : 0;
}

/**
 * Ke mana pengguna kembali setelah mengklik tautan.
 *
 * Prioritas: `redirectTo` dari pemanggil (aplikasi Android → deep link
 * `fixify://reset-password`) → Site URL → origin permintaan (dev). Murni.
 */
export function tujuanReset({ redirectTo, siteUrl, origin } = {}) {
  if (typeof redirectTo === "string" && redirectTo.trim()) return redirectTo.trim();
  const dasar = String(siteUrl || origin || "").replace(/\/+$/, "");
  return dasar ? `${dasar}/reset-password` : null;
}

/** Ambil `action_link` dari hasil `admin.generateLink`. Murni. */
export function tautanDariHasil(data) {
  const link = data?.properties?.action_link;
  return typeof link === "string" && link.startsWith("http") ? link : null;
}

/**
 * Buat tautan reset lalu kirim emailnya.
 *
 * Selalu mengembalikan objek; TIDAK PERNAH melempar. Pemanggil (route/action)
 * yang memutuskan kode HTTP — dan wajib menjawab seragam untuk alamat terdaftar
 * maupun tidak.
 *
 * @param {object} o
 * @param {string} o.email      alamat tujuan
 * @param {string} [o.redirectTo] tujuan balik setelah tautan diklik
 * @param {string} [o.siteUrl]  NEXT_PUBLIC_SITE_URL (cadangan tujuan)
 * @param {string} [o.origin]   origin permintaan (cadangan terakhir)
 * @param {number} [o.sekarangMs] untuk uji; bawaan Date.now()
 * @param {object} [o.admin]    klien admin (uji menyuntik tiruan)
 * @param {Function} [o.kirimEmail] pengirim email (uji menyuntik tiruan)
 * @returns {Promise<{ok:boolean, terkirim?:boolean, alasan?:string, sisaDetik?:number, pesan?:string, idPesan?:string}>}
 */
export async function kirimTautanReset({
  email,
  redirectTo,
  siteUrl,
  origin,
  sekarangMs = Date.now(),
  admin,
  kirimEmail = sendPasswordResetEmail,
} = {}) {
  const alamat = normalisasiEmail(email);
  if (!alamat) return { ok: false, alasan: "email_tidak_valid" };

  const tujuan = tujuanReset({ redirectTo, siteUrl, origin });
  if (!tujuan) return { ok: false, alasan: "tujuan_tidak_diketahui" };

  // Jeda dicatat SEBELUM akunnya diketahui: berlaku sama untuk alamat terdaftar
  // maupun tidak, jadi jawaban 429 tidak pernah membocorkan keberadaan akun.
  const sisaDetik = sisaJedaDetik(riwayat.get(alamat), sekarangMs);
  if (sisaDetik > 0) return { ok: false, alasan: "jeda", sisaDetik };
  riwayat.set(alamat, sekarangMs);

  let klien = admin;
  if (!klien) {
    try {
      klien = createAdminClient();
    } catch (err) {
      // Env server belum lengkap → jangan diam-diam melaporkan sukses.
      riwayat.delete(alamat);
      return { ok: false, alasan: "env", pesan: err?.message };
    }
  }

  const { data, error } = await klien.auth.admin.generateLink({
    type: "recovery",
    email: alamat,
    options: { redirectTo: tujuan },
  });

  const tautan = tautanDariHasil(data);
  if (error || !tautan) {
    // Alamat tanpa akun: GoTrue menolak, dan itu jawaban yang memang diharapkan
    // (perlindungan enumerasi). Kegagalan lain dicatat di log server, tetapi
    // jawaban ke pemanggil tetap seragam — membedakannya akan membocorkan
    // keberadaan akun.
    const memangTidakAdaAkun =
      error?.status === 404 ||
      error?.code === "user_not_found" ||
      /user not found/i.test(error?.message || "");
    if (!memangTidakAdaAkun) {
      console.error(
        "[password-reset] generateLink gagal:",
        error?.status ?? "-",
        error?.code ?? "-",
        error?.message ?? "tanpa action_link"
      );
    }
    return {
      ok: true,
      terkirim: false,
      alasan: memangTidakAdaAkun ? "akun_tidak_ditemukan" : "tautan_gagal_dibuat",
    };
  }

  const hasil = await kirimEmail({
    to: alamat,
    actionLink: tautan,
    siteUrl: siteUrl || origin || null,
    berlakuJam: BERLAKU_JAM,
  });

  if (hasil?.simulated) {
    // Tanpa RESEND_API_KEY isinya hanya masuk log — bukan terkirim. Jeda
    // dibebaskan supaya percobaan berikutnya (setelah env diisi) tidak
    // tertahan; kegagalan ini seragam untuk semua alamat.
    riwayat.delete(alamat);
    return { ok: false, alasan: "env", pesan: "RESEND_API_KEY belum terbaca" };
  }
  if (hasil?.error) {
    riwayat.delete(alamat);
    return { ok: false, alasan: "gagal_kirim", pesan: hasil.error };
  }

  return { ok: true, terkirim: true, idPesan: hasil?.id ?? null };
}

/** Buang riwayat jeda — dipakai uji supaya kasus tidak saling mempengaruhi. */
export function lupakanRiwayatJeda(email) {
  if (email === undefined) riwayat.clear();
  else riwayat.delete(normalisasiEmail(email) || email);
}
