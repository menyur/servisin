/**
 * Penjaga jalur PENDAFTARAN: pembatas laju PERSISTEN + verifikasi Turnstile.
 *
 * KENAPA ADA. Jeda yang lama disimpan di memori proses (lihat
 * src/lib/signup-verification.js). Di serverless itu bukan batas: setiap instance
 * Vercel punya petanya sendiri dan instance datang-pergi, sedangkan jalur
 * pendaftaran memakai Admin API (`admin.generateLink`) sehingga BATAS PENDAFTARAN
 * BAWAAN SUPABASE TIDAK IKUT BERLAKU. Artinya sebelum modul ini, tidak ada satu
 * pun penahan pendaftaran yang berdiri di seluruh deployment. Sekarang batasnya
 * ada di database (`public.signup_attempts` + RPC `pendaftaran_izin()`), jadi
 * berlaku dari instance mana pun.
 *
 * TIGA ATURAN YANG TIDAK BOLEH DILUNAKKAN
 *
 *   1. Jawaban TIDAK boleh bergantung pada ada/tidaknya akun. Seluruh fungsi di
 *      sini memeriksa pemakaian, bukan keberadaan akun — sama seperti kontrak
 *      anti-enumerasi di src/lib/signup-verification.js dan password-reset.js.
 *   2. Degradasi harus TERLIHAT, bukan diam. Kalau tabel/RPC-nya belum ada
 *      (migrasi belum dijalankan) atau database bermasalah, pendaftaran TIDAK
 *      diblokir (mengunci semua pendaftaran karena gangguan DB jauh lebih buruk),
 *      tetapi hasilnya menyebut `tersedia: false` supaya pemanggil bisa
 *      melaporkannya. Pola yang sama dipakai src/lib/email-uji.js untuk gerbang
 *      notifikasi.
 *   3. Turnstile adalah LAPISAN KEDUA, bukan pengganti pembatas. Token yang sah
 *      masih bisa dikirim berkali-kali dalam masa berlakunya, jadi batas per IP &
 *      per alamat tetap diperlukan. Sebaliknya, pembatas saja tidak menahan bot
 *      terdistribusi yang datang dari banyak IP — karena itu keduanya dipakai.
 *
 * Modul ini sengaja TANPA alias `@/…` supaya bisa diimpor skrip `verify:*` yang
 * berjalan di Node polos (tanpa bundler Next).
 */
import { createAdminClient } from "./supabase/admin.js";

/** Batas per IP dalam satu jendela (selaras dengan penjaga memori lama). */
export const BATAS_PER_IP = 8;
export const JENDELA_IP_DETIK = 15 * 60;

/** Jaring pengaman jangka panjang per IP — pola pendaftaran massal terlihat di sini. */
export const BATAS_HARIAN_IP = 25;
export const JENDELA_HARIAN_DETIK = 24 * 3600;

/** Batas per ALAMAT: lebih ketat, karena satu alamat memang hanya perlu sekali. */
export const BATAS_PER_ALAMAT = 5;
export const JENDELA_ALAMAT_DETIK = 3600;

/** Nama RPC di database (supabase/migrate-signup-guard.sql). */
export const RPC_PEMBATAS = "pendaftaran_izin";

/** Kunci untuk tabel pencatatan; bentuknya dipakai juga saat memeriksa manual. */
export function kunciIp(ip) {
  const s = String(ip ?? "").trim();
  return s ? `ip:${s}` : null;
}

export function kunciAlamat(email) {
  const s = String(email ?? "").trim().toLowerCase();
  return s ? `email:${s}` : null;
}

/**
 * Daftar aturan yang berlaku untuk satu permintaan. Murni — diuji tanpa DB.
 * Urutannya penting: yang paling murah/deterministik lebih dulu, dan yang
 * pertama memblokir langsung menghentikan pemeriksaan (tidak perlu menambah
 * catatan pemakaian di kunci lain saat permintaan sudah ditolak).
 */
export function aturanPembatas({ ip, email } = {}) {
  const aturan = [];
  const kIp = kunciIp(ip);
  if (kIp) {
    aturan.push({
      kode: "jeda_ip",
      kunci: kIp,
      batas: BATAS_PER_IP,
      jendelaDetik: JENDELA_IP_DETIK,
      pesan: (sisaDetik) =>
        `Terlalu banyak pendaftaran dari jaringan ini — coba lagi dalam ${Math.max(1, Math.ceil(sisaDetik / 60))} menit.`,
    });
    aturan.push({
      kode: "batas_harian",
      kunci: kIp,
      batas: BATAS_HARIAN_IP,
      jendelaDetik: JENDELA_HARIAN_DETIK,
      pesan: (sisaDetik) =>
        `Batas pendaftaran harian dari jaringan ini tercapai — coba lagi dalam ${Math.max(1, Math.ceil(sisaDetik / 3600))} jam.`,
    });
  }
  const kAlamat = kunciAlamat(email);
  if (kAlamat) {
    aturan.push({
      kode: "jeda_alamat",
      kunci: kAlamat,
      batas: BATAS_PER_ALAMAT,
      jendelaDetik: JENDELA_ALAMAT_DETIK,
      pesan: (sisaDetik) =>
        `Email verifikasi baru saja diminta untuk alamat ini — tunggu ${Math.max(1, Math.ceil(sisaDetik / 60))} menit lagi.`,
    });
  }
  return aturan;
}

/**
 * Periksa & catat satu percobaan pendaftaran di database.
 *
 * @returns {Promise<{ok:boolean, tersedia:boolean, terblokir?:boolean, kode?:string, pesan?:string, sisaDetik?:number, alasan?:string, perluMigrasi?:boolean}>}
 *   `ok: false` HANYA untuk penolakan yang disengaja (batas tercapai).
 *   `tersedia: false` = pembatas tak bisa dipakai; pemanggil boleh lanjut dan
 *   WAJIB melaporkannya.
 */
export async function periksaPembatasPersisten({ admin, ip, email } = {}) {
  const aturan = aturanPembatas({ ip, email });
  if (!aturan.length) return { ok: true, tersedia: true, diperiksa: 0 };

  let klien = admin;
  if (!klien) {
    try {
      klien = createAdminClient();
    } catch (err) {
      return { ok: true, tersedia: false, alasan: err?.message ?? "env" };
    }
  }

  for (const a of aturan) {
    let hasil;
    try {
      hasil = await klien.rpc(RPC_PEMBATAS, {
        p_kunci: a.kunci,
        p_batas: a.batas,
        p_jendela_detik: a.jendelaDetik,
      });
    } catch (err) {
      return { ok: true, tersedia: false, alasan: err?.message ?? "gagal" };
    }

    const { data, error } = hasil || {};
    if (error) {
      const perluMigrasi = /does not exist|schema cache|could not find the function/i.test(error.message || "");
      console.error("[signup-guard] pembatas persisten tidak bisa dipakai:", error.message);
      return { ok: true, tersedia: false, alasan: error.message, perluMigrasi };
    }
    if (!data?.ok) {
      if (data?.error === "batas_tercapai") {
        const sisaDetik = Math.max(1, Number(data.sisa_detik) || 60);
        return {
          ok: false,
          tersedia: true,
          terblokir: true,
          kode: a.kode,
          sisaDetik,
          pesan: a.pesan(sisaDetik),
        };
      }
      console.error("[signup-guard] jawaban pembatas tidak dikenal:", data?.error);
      return { ok: true, tersedia: false, alasan: data?.error ?? "jawaban_tidak_dikenal" };
    }
  }

  return { ok: true, tersedia: true, diperiksa: aturan.length };
}

/** URL verifikasi Turnstile (server-side, kunci rahasia tidak pernah ke klien). */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Apakah Turnstile diwajibkan untuk asal permintaan ini? Murni (env disuntikkan
 * supaya bisa diuji).
 *
 * `asal: "web"` = formulir pendaftaran di situs (selalu dijaga bila kuncinya ada).
 * `asal: "api"` = jalur JSON yang dipakai aplikasi Android. APLIKASI TIDAK BISA
 *   menampilkan tantangan Turnstile, jadi jalur itu hanya dijaga bila
 *   `TURNSTILE_WAJIB_API` dinyalakan secara sadar (artinya aplikasi harus punya
 *   solusinya lebih dulu, mis. Play Integrity). Selama belum, yang menjaga jalur
 *   aplikasi adalah pembatas persisten per IP & per alamat.
 */
export function modeTurnstile({
  asal = "web",
  secret = process.env.TURNSTILE_SECRET_KEY,
  siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  wajibApi = process.env.TURNSTILE_WAJIB_API,
} = {}) {
  if (!String(secret ?? "").trim()) return { aktif: false, sebab: "kunci_belum_ada" };
  if (asal === "web") {
    // Konfigurasi separuh: kunci rahasia ada tetapi kunci publik tidak, sehingga
    // formulirnya TIDAK BISA menghasilkan token. Menolak semua pendaftaran web
    // karena itu bukan keamanan, melainkan mematikan fitur — jadi keadaannya
    // dinyatakan terus-terang dan perubahan konfigurasinya ada di dokumentasi.
    if (!String(siteKey ?? "").trim()) {
      console.error(
        "[signup-guard] TURNSTILE_SECRET_KEY terisi tetapi NEXT_PUBLIC_TURNSTILE_SITE_KEY kosong — " +
          "widget tidak bisa dirender, jadi Turnstile dilewati untuk formulir web. Isi keduanya (atau kosongkan keduanya)."
      );
      return { aktif: false, sebab: "situs_belum_punya_site_key" };
    }
    return { aktif: true, sebab: "formulir_web" };
  }
  const wajib = /^(1|true|ya|yes)$/i.test(String(wajibApi ?? "").trim());
  return wajib ? { aktif: true, sebab: "api_diwajibkan" } : { aktif: false, sebab: "api_dikecualikan" };
}

/**
 * Verifikasi token Turnstile ke Cloudflare. TIDAK PERNAH melempar, dan tokennya
 * tidak pernah ikut ke pesan galat/log (token itu kredensial sekali pakai).
 *
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function verifikasiTurnstile({
  token,
  ip,
  secret = process.env.TURNSTILE_SECRET_KEY,
  fetchFn = fetch,
  timeoutMs = 6000,
} = {}) {
  const kunci = String(secret ?? "").trim();
  if (!kunci) return { ok: false, error: "kunci_belum_ada" };
  if (typeof token !== "string" || !token.trim()) return { ok: false, error: "token_kosong" };
  if (token.length > 4096) return { ok: false, error: "token_terlalu_panjang" };

  const body = new URLSearchParams({ secret: kunci, response: token.trim() });
  if (ip) body.set("remoteip", String(ip));

  const batal = new AbortController();
  const timer = setTimeout(() => batal.abort(), timeoutMs);
  try {
    const res = await fetchFn(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: batal.signal });
    if (!res?.ok) return { ok: false, error: `http_${res?.status ?? "?"}` };
    const data = await res.json().catch(() => null);
    if (data?.success) return { ok: true };
    const kode = Array.isArray(data?.["error-codes"]) ? data["error-codes"].join(",") : "";
    return { ok: false, error: kode || "ditolak" };
  } catch (err) {
    const sebab = err?.name === "AbortError" ? "timeout" : err?.message || "gagal";
    return { ok: false, error: sebab };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Apakah surel ini pernah dipakai akun yang SUDAH DIHAPUS?
 *
 * Dibaca dari tabel permintaan hapus (snapshot alamat asli — baris profilnya
 * sudah dianonimkan, jadi alamat aslinya hanya ada di sana). Dipakai untuk
 * menandai pendaftar BARU bagi admin; hasilnya TIDAK memengaruhi jawaban ke
 * pendaftar. TIDAK PERNAH melempar: gagal membaca = tidak ada tanda.
 *
 * @returns {Promise<{pernah:boolean, sejak?:string|null, error?:string}>}
 */
export async function periksaSurelBekas({ admin, email, kiniMs = Date.now(), jendelaHari = 90 } = {}) {
  const alamat = String(email ?? "").trim().toLowerCase();
  if (!alamat) return { pernah: false };
  let klien = admin;
  if (!klien) {
    try {
      klien = createAdminClient();
    } catch {
      return { pernah: false, error: "env" };
    }
  }

  const batas = new Date(kiniMs - jendelaHari * 86400_000).toISOString();
  try {
    const { data, error } = await klien
      .from("account_deletion_requests")
      .select("id, decided_at")
      .ilike("email", alamat)
      .eq("status", "selesai")
      .gte("decided_at", batas)
      .order("decided_at", { ascending: false })
      .limit(1);

    // Tabelnya belum ada (migrasi hapus akun belum dijalankan) = tidak ada yang
    // perlu ditandai; jangan sampai membuat pendaftaran gagal.
    if (error) return { pernah: false, error: error.message };
    const baris = (data || [])[0];
    return baris ? { pernah: true, sejak: baris.decided_at ?? null, permintaan: baris.id } : { pernah: false };
  } catch (err) {
    return { pernah: false, error: err?.message ?? "gagal" };
  }
}
