/**
 * Kirim email VERIFIKASI PENDAFTARAN lewat Resend — BUKAN lewat mailer
 * bawaan Supabase.
 *
 * Kenapa ada. `supabase.auth.signUp` selalu meminta Supabase mengirim email
 * konfirmasi, dan mailer bawaan hanya melayani alamat anggota tim project
 * dibatasi 2 pesan/jam. Akibatnya pelanggan biasa tidak pernah menerima email
 * verifikasi — dan lebih buruk lagi, karena GoTrue mengirim email DI DALAM
 * transaksi, pendaftaran itu sendiri ikut GAGAL dengan 429 begitu kuota habis
 * (lihat pesan khusus di src/app/actions/auth.js). Batas itu setelan project,
 * jadi tidak bisa dibereskan dari kode selama `signUp` yang dipakai.
 *
 * Jadi akunnya dibuat lewat Admin API (`admin.generateLink`, service role) —
 * TIDAK mengirim email apa pun — lalu emailnya kita kirim sendiri lewat Resend,
 * pipa yang sama dengan seluruh email transaksional project ini. Batas
 * Supabase hilang dari alur pendaftaran.
 *
 * Semantik `generateLink({ type: 'signup' })` — terverifikasi pada project ini
 * (14 Okt 2026), ketiganya lewat satu panggilan yang sama:
 *   1. alamat BELUM ada            → akun dibuat (belum terkonfirmasi) + tautan
 *   2. alamat ada, BELUM konfirmasi → tautan BARU (jadi "kirim ulang" gratis)
 *   3. alamat ada, SUDAH konfirmasi → error 422 `email_exists`
 * Keadaan (3) dijawab seragam seperti keadaan yang berhasil, supaya endpoint
 * ini tidak bisa dipakai memeriksa alamat mana yang terdaftar.
 *
 * Kontrak keamanan (dijaga scripts/verify-signup-endpoint.mjs):
 *   1. Jawaban untuk "berhasil", "sudah terdaftar", dan "tidak ada email yang
 *      dikirim" HARUS sama — kalau dibedakan, responsnya jadi alat enumerasi.
 *   2. Sebab kegagalan hanya masuk log server.
 *   3. Jeda per alamat dicatat SEBELUM akunnya diketahui, jadi sama untuk
 *      semua alamat.
 *   4. `data` (metadata) dibentuk dari daftar bidang tetap — pemanggil tidak
 *      bisa menyelipkan bidang sembarang ke `raw_user_meta_data` yang dibaca
 *      trigger `handle_new_user`.
 *
 * Batas yang diketahui, dan ini penting: karena akun dibuat lewat Admin API,
 * maka BATAS PENDAFTARAN BAWAAN SUPABASE (per IP, anti-penyalahgunaan) TIDAK
 * berlaku lagi. Penggantinya dua lapis:
 *
 *   1. PERSISTEN (berlaku dari instance mana pun) — `public.signup_attempts` +
 *      RPC `pendaftaran_izin()`, dipakai lewat src/lib/signup-guard.js. Ini
 *      penahan yang sebenarnya; lihat supabase/migrate-signup-guard.sql.
 *   2. MEMORI PROSES (jeda 60 detik per alamat + kuota per IP, di berkas ini) —
 *      sekarang hanya penjaga cepat supaya permintaan berulang dari instance
 *      yang sama tidak menyentuh database sama sekali.
 *
 * Ditambah Turnstile di formulir web (lapisan kedua anti-bot; diverifikasi di
 * server oleh src/lib/signup-guard.js). Jeda memori sengaja TETAP ADA: ia bekerja
 * tanpa database, jadi pendaftaran tidak ikut mati bila migrasi/DB bermasalah —
 * dan keadaannya dilaporkan (`pembatasPersisten: false`), bukan disembunyikan.
 *
 * Modul ini sengaja tanpa alias `@/…` supaya bisa diimpor skrip `verify:*` yang
 * berjalan di Node polos (tanpa bundler Next) — di situlah alurnya diuji.
 */
import { createAdminClient } from "./supabase/admin.js";
import { sendSignupVerificationEmail } from "./email.js";
import {
  JEDA_PER_ALAMAT_MS,
  normalisasiEmail,
  sisaJedaDetik,
  tautanDariHasil,
} from "./password-reset.js";
import {
  periksaPembatasPersisten,
  verifikasiTurnstile,
  modeTurnstile,
  periksaSurelBekas,
} from "./signup-guard.js";

/** Jeda wajib antar-permintaan untuk alamat yang sama (selaras dengan app). */
export const JEDA_PER_ALAMAT_MS_DAFTAR = JEDA_PER_ALAMAT_MS;

/** Kuota pendaftaran per alamat IP dalam satu jendela waktu. */
export const BATAS_PER_IP = 8;

/** Panjang jendela kuota per IP. */
export const JENDELA_IP_MS = 15 * 60_000;

/** Masa berlaku tautan verifikasi — ikut setelan "Email OTP Expiration" (1 jam). */
export const BERLAKU_JAM = 1;

/** Panjang kata sandi minimum (sama dengan syarat Supabase Auth & UI). */
export const PANJANG_SANDI_MIN = 6;

/** Riwayat permintaan per alamat: email → waktu ms permintaan terakhir DITERIMA. */
const riwayatAlamat = new Map();

/** Riwayat permintaan per IP: ip → daftar waktu ms permintaan DITERIMA. */
const riwayatIp = new Map();

/**
 * Metadata yang disimpan ke `raw_user_meta_data` — dibaca trigger
 * `handle_new_user` untuk mengisi `profiles`. Bidangnya SENGAJA daftar tetap:
 * pemanggil tidak boleh bisa menulis metadata sembarang.
 *
 * Bentuknya harus sama dengan yang dulu dikirim `signUp` (`data: {...}`),
 * sebab trigger itu tidak berubah.
 */
export function metadataPendaftaran({ name, phone, address, role, skill, ktpUrl } = {}) {
  const peran = role === "technician" ? "technician" : "customer";
  const meta = {
    name: String(name || "").trim() || null,
    phone: String(phone || "").trim() || null,
    role: peran,
  };
  const alamat = String(address || "").trim();
  if (alamat) meta.address = alamat;
  const keahlian = String(skill || "").trim();
  if (peran === "technician" && keahlian) meta.skill = keahlian;
  const ktp = String(ktpUrl || "").trim();
  if (peran === "technician" && ktp) meta.ktp_url = ktp;
  return meta;
}

/**
 * Ke mana pengguna kembali setelah mengklik tautan verifikasi.
 *
 * Beda dengan jalur reset, di sini TIDAK ada path yang ditambahkan: aplikasi
 * memakai deep link (`fixify://confirm`), sedangkan web cukup Site URL begitu
 * sesinya terbentuk. Murni supaya bisa diuji tanpa jaringan.
 */
export function tujuanVerifikasi({ redirectTo, siteUrl, origin } = {}) {
  if (typeof redirectTo === "string" && redirectTo.trim()) return redirectTo.trim();
  const dasar = String(siteUrl || origin || "").trim().replace(/\/+$/, "");
  return dasar || null;
}

/**
 * Sisa waktu tunggu (detik) untuk kuota per IP. Murni.
 *
 * @param {number[]} daftarMs  waktu permintaan sebelumnya dari IP ini
 * @param {number} sekarangMs
 * @param {number} [batas]
 * @param {number} [jendelaMs]
 */
export function sisaJedaIp(daftarMs, sekarangMs, batas = BATAS_PER_IP, jendelaMs = JENDELA_IP_MS) {
  if (!Array.isArray(daftarMs) || !Number.isFinite(sekarangMs)) return 0;
  const dalamJendela = daftarMs.filter(
    (t) => Number.isFinite(t) && sekarangMs - t < jendelaMs && sekarangMs - t >= 0
  );
  if (dalamJendela.length < batas) return 0;
  const palingAwal = Math.min(...dalamJendela);
  return Math.max(1, Math.ceil((palingAwal + jendelaMs - sekarangMs) / 1000));
}

/** Catat satu permintaan untuk IP ini (hanya menyimpan yang masih relevan). */
export function catatIp(ip, sekarangMs, jendelaMs = JENDELA_IP_MS) {
  if (!ip) return;
  const daftar = (riwayatIp.get(ip) || []).filter((t) => sekarangMs - t < jendelaMs);
  daftar.push(sekarangMs);
  riwayatIp.set(ip, daftar);
}

/**
 * Batalkan catatan satu permintaan untuk IP ini — dipakai ketika kegagalannya
 * dari SISI KAMI (generateLink error, kunci Resend belum diisi/mati), bukan
 * karena pengguna mengirim berulang.
 *
 * Kenapa penting: kuota per IP dimaksudkan membatasi PENDAFTARAN, bukan
 * menghukum pengguna atas gangguan server. Kejadian nyata 16 Okt 2026 — kunci
 * Resend di produksi tidak sah sehingga SEMUA pendaftaran gagal; delapan
 * percobaan gagal (bukan pendaftaran berhasil) dari satu jaringan sudah cukup
 * memblokir seluruh pendaftaran dari jaringan itu selama 15 menit, persis saat
 * semua orang mencoba lagi setelah gangguan ditolong. Tanpa pembebasan ini,
 * pesan yang muncul adalah "Terlalu banyak pendaftaran dari jaringan ini" —
 * pesan yang menyesatkan dan membuat penolakan server terlihat seperti
 * kesalahan pengguna.
 *
 * Menghapus berdasarkan waktu (nilai yang sama dengan yang dipakai [catatIp])
 * supaya percobaan LAIN dari IP yang sama tetap terhitung.
 */
export function batalkanCatatIp(ip, sekarangMs, jendelaMs = JENDELA_IP_MS) {
  if (!ip) return false;
  const daftar = (riwayatIp.get(ip) || []).filter(
    (t) => t !== sekarangMs && sekarangMs - t < jendelaMs
  );
  if (daftar.length) riwayatIp.set(ip, daftar);
  else riwayatIp.delete(ip);
  return true;
}

/** Ambil alamat IP pemanggil dari header proxy (Vercel/Next). Murni. */
export function ipDariHeader(headers) {
  const awal = (nilai) => String(nilai || "").split(",")[0].trim();
  const ambil = (nama) => {
    if (!headers) return "";
    return typeof headers.get === "function" ? headers.get(nama) || "" : headers[nama] || "";
  };
  return awal(ambil("x-forwarded-for")) || awal(ambil("x-real-ip")) || "";
}

/**
 * Buat tautan verifikasi lalu kirim emailnya.
 *
 * Selalu mengembalikan objek; TIDAK PERNAH melempar. Pemanggil (route/action)
 * yang memutuskan kode HTTP — dan wajib menjawab seragam untuk "akun dibuat",
 * "sudah terdaftar", maupun "email tidak dikirim".
 *
 * @param {object} o
 * @param {string} o.email       alamat tujuan
 * @param {string} o.password    kata sandi akun (WAJIB: `generateLink` tipe
 *                               signup memerlukannya)
 * @param {object} [o.data]      metadata (lihat [metadataPendaftaran])
 * @param {string} [o.redirectTo] tujuan balik setelah tautan diklik
 * @param {string} [o.siteUrl]   NEXT_PUBLIC_SITE_URL (cadangan tujuan)
 * @param {string} [o.origin]    origin permintaan (cadangan terakhir)
 * @param {string} [o.ip]        alamat IP pemanggil (kuota per IP)
 * @param {string} [o.turnstileToken] token Turnstile dari formulir web
 * @param {"web"|"api"} [o.asal] asal permintaan — menentukan apakah Turnstile
 *                               diwajibkan (aplikasi Android tidak bisa
 *                               menampilkan tantangan; lihat signup-guard.js)
 * @param {number} [o.sekarangMs] untuk uji; bawaan Date.now()
 * @param {object} [o.admin]     klien admin (uji menyuntik tiruan)
 * @param {Function} [o.kirimEmail] pengirim email (uji menyuntik tiruan)
 * @param {Function} [o.cekPembatas] pembatas persisten (uji menyuntik tiruan)
 * @param {Function} [o.cekTurnstile] verifikasi Turnstile (uji menyuntik tiruan)
 * @param {Function} [o.cekBekas] pemeriksa surel bekas akun terhapus
 * @returns {Promise<{ok:boolean, terkirim?:boolean, alasan?:string, sisaDetik?:number, pesan?:string, idPesan?:string, pembatasPersisten?:boolean, ditandaiBekas?:boolean}>}
 */
export async function kirimVerifikasiPendaftaran({
  email,
  password,
  data,
  redirectTo,
  siteUrl,
  origin,
  ip,
  turnstileToken = null,
  asal = "web",
  sekarangMs = Date.now(),
  admin,
  kirimEmail = sendSignupVerificationEmail,
  cekPembatas = periksaPembatasPersisten,
  cekTurnstile = verifikasiTurnstile,
  cekBekas = periksaSurelBekas,
} = {}) {
  const alamat = normalisasiEmail(email);
  if (!alamat) return { ok: false, alasan: "email_tidak_valid" };

  // Kata sandi diperiksa di sini, bukan hanya di UI: `generateLink` tipe signup
  // menolak permintaan tanpa kata sandi, dan kegagalan itu akan terlihat
  // sebagai "gagal kirim email" — pesan yang menyesatkan.
  if (typeof password !== "string" || password.length < PANJANG_SANDI_MIN) {
    return { ok: false, alasan: "password_tidak_valid" };
  }

  const tujuan = tujuanVerifikasi({ redirectTo, siteUrl, origin });
  if (!tujuan) return { ok: false, alasan: "tujuan_tidak_diketahui" };

  // (1) PEMBATAS PERSISTEN — dicatat SEBELUM apa pun yang bergantung pada
  //     keberadaan akun, dan berlaku untuk semua alamat. Ini penahan yang
  //     berdiri di seluruh deployment; penjaga memori di bawah hanya menambah
  //     kecepatan. Percobaan yang ditolak Turnstile pun tetap tercatat di sini,
  //     sehingga pengiriman berulang tanpa token ikut menghabiskan anggarannya.
  const pembatas = await cekPembatas({ admin, ip, email: alamat });
  if (pembatas?.ok === false) {
    return {
      ok: false,
      alasan: pembatas.kode || "jeda_ip",
      sisaDetik: pembatas.sisaDetik,
      pesan: pembatas.pesan,
    };
  }

  // (2) TURNSTILE — hanya bila diwajibkan untuk jalur ini (formulir web selalu,
  //     jalur aplikasi bila TURNSTILE_WAJIB_API dinyalakan).
  const modeTt = modeTurnstile({ asal });
  if (modeTt.aktif) {
    const tt = await cekTurnstile({ token: turnstileToken, ip });
    if (!tt?.ok) {
      console.error("[signup-verification] Turnstile menolak:", tt?.error ?? "sebab tidak diketahui");
      return { ok: false, alasan: "turnstile" };
    }
  }

  // (3) Penjaga memori (cepat, tanpa database): jeda per alamat lalu per IP.
  //     Dicatat SEBELUM akunnya diketahui — berlaku sama untuk alamat terdaftar
  //     maupun tidak, jadi jawaban 429 tidak pernah membocorkan keberadaan akun.
  const sisaDetik = sisaJedaDetik(riwayatAlamat.get(alamat), sekarangMs);
  if (sisaDetik > 0) return { ok: false, alasan: "jeda", sisaDetik };

  if (ip) {
    const sisaIp = sisaJedaIp(riwayatIp.get(ip), sekarangMs);
    if (sisaIp > 0) return { ok: false, alasan: "jeda_ip", sisaDetik: sisaIp };
  }

  // Service role WAJIB: `generateLink` adalah endpoint admin. Tanpa kunci ini
  // createAdminClient diam-diam jatuh ke anon key dan panggilannya ditolak —
  // lebih baik berhenti di sini dengan sebab yang jelas daripada melaporkan
  // "email sudah dikirim" padahal tidak ada yang dikirim.
  if (!admin && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, alasan: "env", pesan: "SUPABASE_SERVICE_ROLE_KEY belum terbaca" };
  }

  let klien = admin;
  if (!klien) {
    try {
      klien = createAdminClient();
    } catch (err) {
      return { ok: false, alasan: "env", pesan: err?.message };
    }
  }

  riwayatAlamat.set(alamat, sekarangMs);
  catatIp(ip, sekarangMs);

  // Satu panggilan menangani tiga keadaan sekaligus: membuat akun, mengirim
  // ulang tautan untuk akun yang belum terverifikasi, atau menolak akun yang
  // sudah terverifikasi (lihat catatan semantik di kepala berkas).
  const { data: hasil, error } = await klien.auth.admin.generateLink({
    type: "signup",
    email: alamat,
    password,
    options: { data: data || {}, redirectTo: tujuan },
  });

  const tautan = tautanDariHasil(hasil);
  if (error || !tautan) {
    const sudahTerkonfirmasi =
      error?.code === "email_exists" ||
      error?.status === 422 ||
      /already (been )?registered|already exists/i.test(error?.message || "");

    if (sudahTerkonfirmasi) {
      // Alamatnya punya akun yang sudah terverifikasi. Jangan kirim apa pun,
      // tetapi jawab seperti berhasil — membedakannya berarti membocorkan
      // alamat mana yang terdaftar.
      return { ok: true, terkirim: false, alasan: "sudah_terdaftar" };
    }

    console.error(
      "[signup-verification] generateLink gagal:",
      error?.status ?? "-",
      error?.code ?? "-",
      error?.message ?? "tanpa action_link"
    );
    // Bebaskan jeda & kuota IP: ini kegagalan server, bukan permintaan berulang
    // pengguna — kalau tidak dibebaskan, pengguna tak bisa mencoba lagi persis
    // saat penyebabnya baru diperbaiki.
    riwayatAlamat.delete(alamat);
    batalkanCatatIp(ip, sekarangMs);
    return { ok: false, alasan: "akun_gagal_dibuat", pesan: error?.message };
  }

  const kirim = await kirimEmail({
    to: alamat,
    actionLink: tautan,
    siteUrl: siteUrl || origin || null,
    berlakuJam: BERLAKU_JAM,
  });

  if (kirim?.simulated) {
    // Tanpa RESEND_API_KEY isinya hanya masuk log — bukan terkirim. Jeda
    // dibebaskan supaya percobaan berikutnya (setelah env diisi) tidak tertahan.
    riwayatAlamat.delete(alamat);
    batalkanCatatIp(ip, sekarangMs);
    return { ok: false, alasan: "env", pesan: "RESEND_API_KEY belum terbaca" };
  }
  if (kirim?.error) {
    riwayatAlamat.delete(alamat);
    batalkanCatatIp(ip, sekarangMs);
    return { ok: false, alasan: "gagal_kirim", pesan: kirim.error };
  }

  // Surel ini bekas akun yang sudah DIHAPUS? Tandai untuk admin.
  //
  // Sengaja dilakukan SETELAH email dikirim dan TIDAK mengubah jawaban ke
  // pendaftar: fungsinya menutup celah "hapus akun lalu daftar ulang" sebagai
  // cara mereset riwayat penilaian dari pandangan operator — bukan menolak
  // pendaftaran (privasi memang membebaskan alamatnya).
  const tanda = await tandaiBekasAkun({ admin: klien, email: alamat, userId: hasil?.user?.id, cekBekas });

  return {
    ok: true,
    terkirim: true,
    idPesan: kirim?.id ?? null,
    pembatasPersisten: pembatas?.tersedia !== false,
    ditandaiBekas: Boolean(tanda?.ditandai),
  };
}

/**
 * KIRIM ULANG tautan verifikasi untuk akun yang SUDAH dibuat tetapi belum
 * pernah dikonfirmasi — dipakai admin dari tab "Pendaftar Teknisi".
 *
 * Kenapa terpisah dari [kirimVerifikasiPendaftaran]: fungsi itu WAJIB menerima
 * kata sandi (dipakai `generateLink` saat akunnya belum ada), sedangkan admin
 * tidak pernah tahu kata sandi pendaftar. Terverifikasi pada project ini
 * (18 Okt 2026): untuk akun yang SUDAH ada dan BELUM terkonfirmasi,
 * `generateLink({ type: 'signup' })` tetap mengembalikan tautan baru walau
 * `password` tidak dikirim — kata sandinya tidak berubah, hanya tautannya yang
 * diperbarui. Jadi fungsi ini sengaja TIDAK menyentuh kata sandi siapa pun.
 *
 * Akun yang SUDAH terkonfirmasi tidak dikirimi apa pun (`alasan:
 * "sudah_terkonfirmasi"`): tautan verifikasi untuk akun terkonfirmasi tidak
 * berguna, dan mengirimkannya berarti mengirim email yang membingungkan.
 *
 * @returns {Promise<{ok:boolean, terkirim?:boolean, alasan?:string, sisaDetik?:number, pesan?:string, idPesan?:string, sudahTerkonfirmasi?:boolean}>}
 */
export async function kirimUlangVerifikasiPendaftaran({
  email,
  redirectTo,
  siteUrl,
  origin,
  sekarangMs = Date.now(),
  admin,
  kirimEmail = sendSignupVerificationEmail,
} = {}) {
  const alamat = normalisasiEmail(email);
  if (!alamat) return { ok: false, alasan: "email_tidak_valid" };

  const tujuan = tujuanVerifikasi({ redirectTo, siteUrl, origin });
  if (!tujuan) return { ok: false, alasan: "tujuan_tidak_diketahui" };

  // Penjaga cepat yang sama dengan jalur pendaftaran: klik ganda admin tidak
  // mengirim dua email. Bukan batas keamanan — batas sebenarnya ada di
  // `public.signup_attempts` untuk jalur publik.
  const sisaDetik = sisaJedaDetik(riwayatAlamat.get(alamat), sekarangMs);
  if (sisaDetik > 0) return { ok: false, alasan: "jeda", sisaDetik };

  let klien = admin;
  if (!klien) {
    try {
      klien = createAdminClient();
    } catch (err) {
      return { ok: false, alasan: "env", pesan: err?.message };
    }
  }

  const { data: hasil, error } = await klien.auth.admin.generateLink({
    type: "signup",
    email: alamat,
    options: { redirectTo: tujuan },
  });

  const tautan = tautanDariHasil(hasil);
  if (error || !tautan) {
    const sudahTerkonfirmasi =
      error?.code === "email_exists" ||
      error?.status === 422 ||
      /already (been )?registered|already exists/i.test(error?.message || "");
    if (sudahTerkonfirmasi) return { ok: true, terkirim: false, alasan: "sudah_terkonfirmasi", sudahTerkonfirmasi: true };
    console.error(
      "[signup-verification] generateLink (kirim ulang) gagal:",
      error?.status ?? "-",
      error?.code ?? "-",
      error?.message ?? "tanpa action_link"
    );
    return { ok: false, alasan: "akun_gagal_disiapkan", pesan: error?.message };
  }

  const kirim = await kirimEmail({
    to: alamat,
    actionLink: tautan,
    siteUrl: siteUrl || origin || null,
    berlakuJam: BERLAKU_JAM,
  });

  if (kirim?.simulated) return { ok: false, alasan: "env", pesan: "RESEND_API_KEY belum terbaca" };
  if (kirim?.error) return { ok: false, alasan: "gagal_kirim", pesan: kirim.error };

  riwayatAlamat.set(alamat, sekarangMs);
  return { ok: true, terkirim: true, idPesan: kirim?.id ?? null };
}

/**
 * Tulis penanda "surel bekas akun terhapus" pada baris profil pendaftar baru.
 * Best-effort: kegagalannya dicatat, tidak pernah menggagalkan pendaftaran.
 */
async function tandaiBekasAkun({ admin, email, userId, cekBekas }) {
  if (!admin || !userId) return { ditandai: false, alasan: "tanpa_konteks" };
  try {
    const bekas = await cekBekas({ admin, email });
    if (!bekas?.pernah) return { ditandai: false, alasan: bekas?.error ?? "bukan_bekas" };
    const { error } = await admin
      .from("profiles")
      .update({ bekas_akun_terhapus_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) {
      console.error("[signup-verification] gagal menandai surel bekas akun:", error.message);
      return { ditandai: false, error: error.message };
    }
    return { ditandai: true, sejak: bekas.sejak ?? null };
  } catch (err) {
    console.error("[signup-verification] gagal menandai surel bekas akun:", err?.message);
    return { ditandai: false, error: err?.message ?? "gagal" };
  }
}

/** Buang riwayat jeda — dipakai uji supaya kasus tidak saling mempengaruhi. */
export function lupakanRiwayatPendaftaran(email) {
  if (email === undefined) {
    riwayatAlamat.clear();
    riwayatIp.clear();
    return;
  }
  riwayatAlamat.delete(normalisasiEmail(email) || email);
}
