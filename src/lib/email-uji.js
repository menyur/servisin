/**
 * Akun & alamat UJI — email yang TIDAK punya inbox nyata (akun/probe buatan
 * skrip). Sebagian besar MURNI: tanpa jaringan dan tanpa database, supaya bisa
 * dipakai di mana saja (termasuk skrip `node` biasa) dan diuji langsung.
 *
 * KENAPA ADA (kejadian 16 Okt 2026): kuota harian Resend habis dan notifikasi
 * admin berhenti terkirim. Setelah ditelusuri ke daftar kiriman akun Resend,
 * yang menghabiskan kuota bukan pelanggan, melainkan SKRIP UJI: setiap probe
 * membuat pesanan/laporan/pendaftaran dengan akun sementara, dan trigger antrean
 * lalu mengirim email NYATA ke inbox admin — belasan email dalam beberapa detik
 * (13:46:2x–13:46:5x) untuk data `Probe …`, `RT-RLS-…`, `RT-CHAT-…`.
 * Pemeriksaan lanjutan 17 Okt 2026 (376 email di akun Resend): pada 16 Okt
 * terkirim 195 email — **149 di antaranya (76%) jelas berasal dari data uji**,
 * dan kuota harian habis sekitar pukul 14:36 UTC; SEMUA kiriman sesudahnya
 * berakhir `failed` dengan `message_id` kosong (tidak pernah diserahkan ke
 * penyedia pengiriman). Jadi kuota yang terbuang data uji = email nyata yang
 * tidak sampai.
 *
 * Karena akun uji sudah punya konvensi email tanpa inbox (`@example.invalid`,
 * lihat scripts/lib/probe-env.mjs: "email @example.invalid → tidak pernah
 * terkirim ke mana pun"), aturan yang sama dipakai di SELURUH jalur notifikasi:
 *
 *   1. PENERIMA email  — src/lib/email.js (`sendMail`) membuang alamat uji dari
 *      daftar penerima, jadi tidak ada satu pun panggilan Resend untuk akun uji
 *      (konfirmasi pesanan, penugasan teknisi, struk, pengingat saldo, dll).
 *   2. AKUN tujuan push — src/lib/notify.js, push.js, dan fcm.js melewati akun
 *      uji sebelum menyentuh web-push/FCM (lihat `akunUji`).
 *   3. SUMBER peristiwa — peristiwa yang SUMBER-nya akun uji tidak dikirim ke
 *      admin sama sekali (antrean admin_email_outbox di src/lib/admin-email.js
 *      DAN jalur langsung di src/app/actions/*). Penerimanya admin asli, jadi
 *      menyaring penerima saja tidak cukup: yang diperiksa adalah asal datanya.
 *
 * Satu aturan, banyak pemakai — kalau polanya berbeda, "alamat uji" bisa berarti
 * dua hal yang bertentangan antara pemeriksa dan pengirim.
 */

/** Domain yang dianggap TIDAK punya inbox nyata. */
export const POLA_ALAMAT_UJI =
  /@(example\.(com|org|net|invalid)|resend\.dev|test\.com|fixify\.test)$/i;

/** Apakah alamat ini alamat uji (tanpa inbox nyata)? */
export function alamatUji(email) {
  return POLA_ALAMAT_UJI.test(String(email ?? "").trim());
}

/**
 * Daftar penerima TANPA alamat uji — dipakai gerbang pengiriman email.
 * Menerima satu alamat (`"a@b.id"`) maupun daftar, mengembalikan array
 * (bisa kosong bila semuanya alamat uji).
 */
export function saringAlamatUji(to) {
  const daftar = (Array.isArray(to) ? to : [to])
    .map((a) => String(a ?? "").trim())
    .filter(Boolean);
  return daftar.filter((a) => !alamatUji(a));
}

/**
 * Apakah pengiriman ke alamat uji DIIZINKAN di proses ini?
 *
 * Hanya skrip diagnostik yang membutuhkannya: `verify:email-send` /
 * `verify:email-doctor` sengaja mengirim ke `delivered@resend.dev` (alamat uji
 * resmi Resend), dan `verify:e2e-push-notify` mengirim push ke endpoint TIRUAN di
 * localhost, untuk membuktikan jalur kirim produksi bekerja TANPA menghubungi
 * inbox atau perangkat siapa pun. Di produksi variabel ini tidak pernah diisi,
 * jadi gerbangnya selalu aktif. Nilai apa pun selain 1/true/ya/yes dianggap tidak
 * diizinkan — salah ketik tidak membuka gerbang.
 */
export function alamatUjiDiizinkan() {
  return /^(1|true|ya|yes)$/i.test(String(process.env.EMAIL_UJI_DIIZINKAN ?? "").trim());
}

/**
 * Apakah AKUN (baris `profiles`) ini akun uji?
 *
 * Klien Supabase disuntikkan pemanggil supaya modul ini tetap tanpa impor
 * Supabase (bisa diuji dengan klien tiruan). Hasilnya di-cache per proses —
 * email sebuah akun tidak berubah, sedangkan gerbang ini dipanggil untuk setiap
 * notifikasi push. Gagal membaca = TIDAK diblokir (fail-open): gangguan
 * sementara pada database tidak boleh mematikan semua notifikasi.
 *
 * @returns {Promise<string|null>} email akun bila akun uji, selain itu null.
 */
const cacheAkunUji = new Map();
const BATAS_CACHE_AKUN = 500;

export async function akunUji(admin, userId) {
  if (!userId || !admin) return null;
  const kunci = String(userId);
  if (cacheAkunUji.has(kunci)) return cacheAkunUji.get(kunci);

  let email = null;
  try {
    const { data } = await admin.from("profiles").select("email").eq("id", kunci).maybeSingle();
    email = data?.email ?? null;
  } catch {
    return null; // tak terbaca → jangan blokir, dan jangan di-cache
  }

  const hasil = alamatUji(email) ? String(email) : null;
  if (cacheAkunUji.size >= BATAS_CACHE_AKUN) cacheAkunUji.clear();
  cacheAkunUji.set(kunci, hasil);
  return hasil;
}

/** Kosongkan cache akun uji (dipakai uji otomatis supaya tiap kasus bersih). */
export function lupakanAkunUji() {
  cacheAkunUji.clear();
}
