/**
 * Jalur penghapusan akun — sisi server.
 *
 * Google Play mewajibkan aplikasi yang bisa membuat akun menyediakan DUA jalur
 * permintaan hapus: dari dalam aplikasi dan lewat URL web yang bisa dipakai
 * tanpa memasang aplikasi. Modul ini mengurus jalur WEB (halaman publik
 * /hapus-akun) dan EKSEKUSINYA, sementara jalur aplikasi memanggil RPC
 * `request_account_deletion` langsung dari Flutter (lihat
 * supabase/migrate-account-deletion.sql) — keduanya bermuara ke satu tabel
 * permintaan, jadi operator memprosesnya dengan satu alat (scripts/hapus-akun.mjs).
 *
 * KENAPA JALUR WEB BUTUH KONFIRMASI SUREL
 *   Halaman /hapus-akun bisa dibuka siapa saja. Tanpa pembuktian kepemilikan,
 *   satu orang bisa meminta penghapusan akun orang lain hanya dengan menebak
 *   alamatnya. Karena itu permintaan web disimpan sebagai
 *   'menunggu_konfirmasi' + token (yang disimpan hanya sebagai hash, sekali
 *   pakai, berlaku terbatas), dan baru menjadi 'diminta' setelah tautannya
 *   diklik dari kotak masuk pemilik akun. Jawaban ke peramban SELALU sama
 *   ("kalau alamatnya terdaftar, tautan sudah dikirim") supaya halaman ini
 *   tidak bisa dipakai menebak siapa yang punya akun.
 *
 * KENAPA EKSEKUSI BUKAN `delete from auth.users`
 *   Profil → pesanan → saldo/komisi/penilaian semuanya CASCADE. Menghapus baris
 *   auth akan ikut menghapus catatan keuangan yang menurut Kebijakan Privasi §5
 *   justru disimpan. Jadi penghapusan = anonimkan identitas + hapus konten
 *   pribadi + cabut akses masuk (surel auth diganti tombstone & akun di-banned).
 *
 * KENAPA PENCABUTANNYA BUTUH DUA LANGKAH (`cabutAksesPengguna`)
 *   Ban menolak MASUK dan REFRESH, tetapi access token yang sudah terbit tetap
 *   sah sampai kedaluwarsa — dan surel tombstone tidak melepas tautan identitas
 *   Google. Jadi akun "yang sudah dihapus" masih bisa dipakai (paling lama
 *   sampai token kedaluwarsa) atau hidup lagi lewat "Masuk dengan Google" bila
 *   pencabutannya pernah gagal. Karena itu sesi & identitas provider diputus
 *   lewat RPC service-role (supabase/migrate-account-revocation.sql), dan
 *   HASILNYA DITULIS ke baris permintaan supaya kegagalan separuh jalan bisa
 *   diperiksa dan diulang — bukan dilaporkan sekali lalu hilang.
 *
 * Modul ini sengaja ditulis TANPA alias `@/…` supaya bisa diimpor skrip
 * `verify:*`/alat operasional yang berjalan di Node polos (tanpa bundler Next).
 */
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin.js";
import { sendAccountDeletionConfirmEmail, sendAccountDeletionDoneEmail } from "./email.js";
import { normalisasiEmail, sisaJedaDetik, JEDA_PER_ALAMAT_MS } from "./password-reset.js";

/** Masa berlaku tautan konfirmasi (jam). Lebih longgar dari reset sandi karena
 *  tautan ini bisa dibuka kapan saja, bukan saat pengguna butuh segera. */
export const BERLAKU_KONFIRMASI_JAM = 24;

/** Berapa lama janji pemrosesan yang ditulis di halaman & surel. */
export const JANJI_HARI = 7;

/** Bucket & penanda URL untuk mengambil path berkas pribadi yang harus dibuang. */
const BUCKET_KTP = "ktp-documents";
const BUCKET_AVATAR = "profile-media";

/** Durasi ban akun yang sudah dihapus (~100 tahun: permanen secara praktis). */
export const BAN_DURASI = "876000h";

/** Domain surel tombstone (RFC 2606 — sengaja tidak bisa menerima surel). */
const DOMAIN_TOMBSTONE = "@fixify.invalid";

/** Riwayat jeda per alamat (email → ms permintaan web terakhir DITERIMA). */
const riwayat = new Map();

/**
 * Token konfirmasi acak (hex 64 karakter). Hanya hash-nya yang masuk database.
 * @returns {string}
 */
export function buatToken() {
  return randomBytes(32).toString("hex");
}

/** Hash token yang disimpan di database. Murni. */
export function hashToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

/**
 * Apakah (token, hash tersimpan, kedaluwarsa) cocok? Murni — diuji tanpa DB.
 * Perbandingan hash = waktu tetap, karena keduanya string hex sepanjang sama.
 */
export function tokenSah({ token, hash, expiresAt, sekarangMs = Date.now() } = {}) {
  if (!token || !hash) return false;
  const exp = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(exp) && exp < sekarangMs) return false;
  const dihitung = hashToken(token);
  if (dihitung.length !== String(hash).length) return false;
  let beda = 0;
  for (let i = 0; i < dihitung.length; i++) {
    beda |= dihitung.charCodeAt(i) ^ String(hash).charCodeAt(i);
  }
  return beda === 0;
}

/**
 * Ambil path berkas di dalam sebuah bucket dari nilai kolom (`ktp_url`,
 * `avatar_url`). Nilainya bisa berupa path langsung atau URL publik bertanda
 * `/object/public/<bucket>/…`. Nilai asing (mis. URL luar) → null, artinya
 * "tidak diketahui, jangan hapus apa pun". Murni.
 */
export function pathBerkas(nilai, bucket) {
  const s = typeof nilai === "string" ? nilai.trim() : "";
  if (!s) return null;
  const tanda = `/object/public/${bucket}/`;
  const i = s.indexOf(tanda);
  if (i >= 0) return decodeURIComponent(s.slice(i + tanda.length).split("?")[0]) || null;
  if (/^https?:\/\//i.test(s)) return null; // URL host lain — bukan milik bucket ini
  return s.replace(/^\/+/, "") || null;
}

/**
 * Tautan konfirmasi yang dikirim ke surel pemilik akun. Prioritas dasar URL:
 * `siteUrl` (NEXT_PUBLIC_SITE_URL) → `origin` permintaan. Murni.
 */
export function tautanKonfirmasi({ id, token, siteUrl, origin } = {}) {
  const dasar = String(siteUrl || origin || "").replace(/\/+$/, "");
  if (!dasar) return null;
  return `${dasar}/hapus-akun/konfirmasi?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
}

/**
 * Samarkan alamat surel untuk ditampilkan di halaman konfirmasi (halaman itu
 * bisa terbuka dari perangkat mana pun, jadi alamat utuhnya tidak perlu muncul
 * di layar). Murni.
 * contoh: 'budi.santoso@gmail.com' → 'bu•••••••••••@gmail.com'
 */
export function maskEmail(nilai) {
  const s = String(nilai ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at <= 0) return s ? "•••" : "";
  const lokal = s.slice(0, at);
  const domain = s.slice(at);
  const tampil = lokal.slice(0, 2);
  return `${tampil}${'•'.repeat(Math.max(lokal.length - tampil.length, 1))}${domain}`;
}

/** Buang riwayat jeda — dipakai uji supaya kasus tidak saling mempengaruhi. */
export function lupakanRiwayatJeda(email) {
  if (email === undefined) riwayat.clear();
  else riwayat.delete(normalisasiEmail(email) || email);
}

/**
 * Buat permintaan penghapusan dari HALAMAN WEB (belum terverifikasi).
 *
 * Jawaban yang dikembalikan pemanggil ke peramban TIDAK boleh membedakan
 * "alamat terdaftar" dari "tidak terdaftar" — karena itu fungsi ini selalu
 * `{ok:true}` untuk bentuk surel yang sah, apa pun hasil pencarian akunnya.
 * Kegagalan yang benar-benar teknis (layanan surel belum siap) dibedakan,
 * sebab "gagal karena server" tidak boleh menyamar jadi "tautan sudah dikirim".
 *
 * @returns {Promise<{ok:boolean, alasan?:string, id?:string, terkirim?:boolean, pesan?:string}>}
 */
export async function mintaHapusAkunWeb({
  email,
  alasan,
  siteUrl,
  origin,
  sekarangMs = Date.now(),
  admin,
  kirimEmail = sendAccountDeletionConfirmEmail,
  buatTokenFn = buatToken,
} = {}) {
  const alamat = normalisasiEmail(email);
  if (!alamat) return { ok: false, alasan: "email_tidak_valid" };

  // Jeda dicatat SEBELUM akunnya dicari: berlaku sama untuk alamat terdaftar
  // maupun tidak, jadi batas ini tidak membocorkan keberadaan akun.
  const sisaDetik = sisaJedaDetik(riwayat.get(alamat), sekarangMs);
  if (sisaDetik > 0) return { ok: false, alasan: "jeda", sisaDetik };
  riwayat.set(alamat, sekarangMs);

  let klien = admin;
  if (!klien) {
    try {
      klien = createAdminClient();
    } catch (err) {
      riwayat.delete(alamat);
      return { ok: false, alasan: "env", pesan: err?.message };
    }
  }
  if (!klien) return { ok: false, alasan: "env", pesan: "klien admin tidak tersedia" };

  // Akun (bila ada) — dipakai hanya untuk mengaitkan permintaan dan mengenali
  // permintaan yang sudah berjalan; tidak pernah membocorkan hasilnya.
  const { data: profil } = await klien
    .from("profiles")
    .select("id, role")
    .ilike("email", alamat)
    .maybeSingle();

  if (profil?.id) {
    const { data: terbuka } = await klien
      .from("account_deletion_requests")
      .select("id, status")
      .eq("user_id", profil.id)
      .in("status", ["menunggu_konfirmasi", "diminta"])
      .maybeSingle();

    // HANYA 'diminta' yang berarti "sudah berjalan". Baris 'menunggu_konfirmasi'
    // adalah permintaan lama yang tautannya belum (atau tidak pernah) dibuka —
    // memperlakukannya sebagai berjalan membuat pengguna menerima email "sedang
    // diproses" padahal tidak ada apa pun yang masuk antrean operator. Untuk
    // kasus itu kita terbitkan tautan BARU (baris lamanya dibuang di bawah).
    if (terbuka && terbuka.status === "diminta") {
      const hasil = await kirimEmail({
        to: alamat,
        actionLink: null,
        siteUrl: siteUrl || origin || null,
        sudahDiminta: true,
      });
      if (hasil?.simulated) {
        riwayat.delete(alamat);
        return { ok: false, alasan: "env", pesan: "RESEND_API_KEY belum terbaca" };
      }
      if (hasil?.error) {
        riwayat.delete(alamat);
        return { ok: false, alasan: "gagal_kirim", pesan: hasil.error };
      }
      return { ok: true, terkirim: true, id: terbuka.id, sudahAda: true };
    }
  }

  // Tautan konfirmasi lama yang belum dipakai dibuang: satu alamat = satu
  // tautan hidup (indeks unik parsial account_deletion_open_per_email).
  await klien
    .from("account_deletion_requests")
    .delete()
    .ilike("email", alamat)
    .eq("status", "menunggu_konfirmasi");

  const token = buatTokenFn();
  const kedaluwarsa = new Date(sekarangMs + BERLAKU_KONFIRMASI_JAM * 3600_000).toISOString();
  const { data: baris, error } = await klien
    .from("account_deletion_requests")
    .insert({
      user_id: profil?.id ?? null,
      email: alamat,
      sumber: "web",
      alasan: String(alasan ?? "").trim() || null,
      status: "menunggu_konfirmasi",
      kode_hash: hashToken(token),
      kode_expires_at: kedaluwarsa,
    })
    .select("id")
    .single();

  if (error) {
    riwayat.delete(alamat);
    return { ok: false, alasan: "gagal_simpan", pesan: error.message };
  }

  const tautan = tautanKonfirmasi({ id: baris.id, token, siteUrl, origin });
  if (!tautan) {
    riwayat.delete(alamat);
    return { ok: false, alasan: "tujuan_tidak_diketahui" };
  }

  const hasil = await kirimEmail({
    to: alamat,
    actionLink: tautan,
    siteUrl: siteUrl || origin || null,
    berlakuJam: BERLAKU_KONFIRMASI_JAM,
  });

  if (hasil?.simulated) {
    // Tanpa RESEND_API_KEY isinya hanya masuk log — bukan terkirim. Baris
    // menunggu konfirmasi dibatalkan supaya tidak ada permintaan yatim.
    await klien.from("account_deletion_requests").delete().eq("id", baris.id);
    riwayat.delete(alamat);
    return { ok: false, alasan: "env", pesan: "RESEND_API_KEY belum terbaca" };
  }
  if (hasil?.error) {
    await klien.from("account_deletion_requests").delete().eq("id", baris.id);
    riwayat.delete(alamat);
    return { ok: false, alasan: "gagal_kirim", pesan: hasil.error };
  }

  return { ok: true, terkirim: true, id: baris.id };
}

/**
 * Periksa tautan konfirmasi TANPA mengubah apa pun (dipakai halaman GET agar
 * tautan bisa ditampilkan sebagai halaman, bukan langsung mengeksekusi).
 * @returns {Promise<{ok:boolean, alasan?:string, email?:string, id?:string, status?:string}>}
 */
export async function periksaTautanKonfirmasi({ id, token, admin, sekarangMs = Date.now() } = {}) {
  if (!id || !token) return { ok: false, alasan: "tautan_tidak_lengkap" };
  let klien = admin;
  try {
    klien = klien || createAdminClient();
  } catch {
    return { ok: false, alasan: "env" };
  }

  const { data: baris } = await klien
    .from("account_deletion_requests")
    .select("id, email, status, kode_hash, kode_expires_at")
    .eq("id", id)
    .maybeSingle();

  if (!baris) return { ok: false, alasan: "permintaan_tidak_ada" };
  if (baris.status === "diminta") return { ok: true, sudah: true, id: baris.id, email: baris.email };
  if (baris.status !== "menunggu_konfirmasi") return { ok: false, alasan: "sudah_ditutup", status: baris.status };
  if (!tokenSah({ token, hash: baris.kode_hash, expiresAt: baris.kode_expires_at, sekarangMs })) {
    return { ok: false, alasan: "token_tidak_berlaku" };
  }
  return { ok: true, id: baris.id, email: baris.email };
}

/**
 * Tandai permintaan web sebagai terverifikasi ('diminta') — dipanggil setelah
 * pemilik akun menekan tombol di halaman konfirmasi. Token langsung dimatikan
 * (sekali pakai) dan penjaga kelayakan dijalankan; bila tidak lolos,
 * permintaan ditutup sebagai 'ditolak' beserta alasannya supaya pengguna tahu
 * apa yang harus dibereskan lebih dulu.
 */
export async function konfirmasiHapusAkun({ id, token, admin, sekarangMs = Date.now() } = {}) {
  const periksa = await periksaTautanKonfirmasi({ id, token, admin, sekarangMs });
  if (!periksa.ok) return periksa;
  if (periksa.sudah) return { ok: true, sudah: true, id: periksa.id, email: periksa.email };

  let klien = admin;
  try {
    klien = klien || createAdminClient();
  } catch {
    return { ok: false, alasan: "env" };
  }

  const { data: baris } = await klien
    .from("account_deletion_requests")
    .select("id, user_id, email")
    .eq("id", id)
    .maybeSingle();
  if (!baris) return { ok: false, alasan: "permintaan_tidak_ada" };

  // Penjaga yang sama dengan jalur aplikasi (fungsi DB, satu sumber aturan).
  if (baris.user_id) {
    const { data: blokir, error } = await klien.rpc("hapus_akun_blokir", { p_user: baris.user_id });
    if (error) return { ok: false, alasan: "gagal_periksa", pesan: error.message };
    if (blokir) {
      await klien
        .from("account_deletion_requests")
        .update({
          status: "ditolak",
          catatan_admin: `Ditolak otomatis: ${blokir}`,
          updated_at: new Date(sekarangMs).toISOString(),
        })
        .eq("id", id);
      return { ok: false, alasan: blokir };
    }
  }

  const { error } = await klien
    .from("account_deletion_requests")
    .update({
      status: "diminta",
      confirmed_at: new Date(sekarangMs).toISOString(),
      updated_at: new Date(sekarangMs).toISOString(),
      kode_hash: null,        // sekali pakai: hash dimatikan begitu terpakai
      kode_expires_at: null,
    })
    .eq("id", id)
    .eq("status", "menunggu_konfirmasi");
  if (error) return { ok: false, alasan: "gagal_konfirmasi", pesan: error.message };

  return { ok: true, id, email: baris.email };
}

/**
 * Daftar permintaan untuk alat operasional (scripts/hapus-akun.mjs).
 * Dibaca dengan service role; tidak pernah dipakai klien.
 */
export async function daftarPermintaanHapus({ admin, status = "diminta", limit = 50 } = {}) {
  const klien = admin || createAdminClient();
  const kueri = klien
    .from("account_deletion_requests")
    .select("id, user_id, email, sumber, alasan, status, created_at, confirmed_at, decided_at, catatan_admin")
    .order("created_at", { ascending: true })
    .limit(limit);
  const { data, error } = status ? await kueri.eq("status", status) : await kueri;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * JALANKAN penghapusan: anonimkan di database (RPC), lalu cabut akses masuk dan
 * bersihkan berkas pribadi di lapisan ini (keduanya butuh Admin/Storage API).
 *
 * Urutannya penting: identitas di database dibereskan lebih dulu, baru akses
 * dicabut. Bila pencabutan akses gagal, hasilnya dilaporkan `aksesDicabut:false`
 * — jangan pernah menutupi kegagalan ini, karena berarti akun masih bisa dipakai
 * masuk padahal datanya sudah dianonimkan.
 */
/**
 * Nama surel tombstone untuk sebuah akun — deterministik, jadi bisa dipakai
 * jalur pencabutan ULANG yang tidak memegang nilai balikan SQL. Murni.
 * Bentuknya harus sama dengan `v_tombstone` di migrate-account-deletion.sql.
 */
export function tombstoneUntuk(userId) {
  const bersih = String(userId ?? "").replace(/-/g, "").slice(0, 12);
  if (bersih.length !== 12) return null;
  return `dihapus+${bersih}${DOMAIN_TOMBSTONE}`;
}

/**
 * Lepaskan sesi yang sedang berjalan & identitas provider NON-surel.
 *
 * Kenapa lewat RPC: menghapus baris `auth.sessions`/`auth.identities` hanya bisa
 * lewat SQL (skema `auth` tidak diekspos PostgREST), dan `auth.admin.signOut()`
 * bukan penggantinya karena parameternya JWT sesi pengguna — bukan user id.
 * Tidak pernah melempar; kegagalannya dilaporkan apa adanya.
 *
 * @returns {Promise<{ok:boolean, sesi?:number, identitas?:number, error?:string, perluMigrasi?:boolean}>}
 */
export async function cabutSesiDanIdentitas({ userId, admin } = {}) {
  if (!userId) return { ok: false, error: "pengguna_kosong" };
  let klien = admin;
  try {
    klien = klien || createAdminClient();
  } catch (err) {
    return { ok: false, error: err?.message ?? "env" };
  }

  try {
    const { data, error } = await klien.rpc("cabut_akses_pengguna", { p_user: userId });
    if (error) {
      const migrasi = /does not exist|schema cache|could not find the function|permission denied/i.test(
        error.message || ""
      );
      return { ok: false, error: error.message, perluMigrasi: migrasi };
    }
    if (!data?.ok) return { ok: false, error: data?.error || "gagal" };
    return { ok: true, sesi: data.sesi ?? 0, identitas: data.identitas ?? 0 };
  } catch (err) {
    return { ok: false, error: err?.message ?? "gagal" };
  }
}

/**
 * Cabut SEMUA jalan masuk sebuah akun: (a) jalur masuk ditutup dengan surel
 * tombstone + ban, (b) sesi berjalan & identitas provider diputus.
 *
 * Dipakai jalur eksekusi MAUPUN pencabutan ulang supaya keduanya tidak pernah
 * berbeda perlakukan. Tidak pernah melempar.
 */
export async function cabutAksesPengguna({ userId, tombstone = null, akunAda = true, admin } = {}) {
  const klien = admin || createAdminClient();

  let aksesDicabut = false;
  let galatAkses = null;
  if (!akunAda) {
    // Akunnya sudah tidak ada (mis. dihapus langsung di dashboard): tidak ada
    // yang perlu dicabut, dan itu bukan kegagalan.
    aksesDicabut = true;
  } else {
    try {
      const { error } = await klien.auth.admin.updateUserById(userId, {
        email: tombstone || tombstoneUntuk(userId),
        // `email_confirm: true` mencegah GoTrue menuntut verifikasi ke alamat
        // tombstone yang memang tidak bisa menerima surat.
        email_confirm: true,
        ban_duration: BAN_DURASI,
      });
      if (error) galatAkses = error.message;
      else aksesDicabut = true;
    } catch (err) {
      galatAkses = err?.message ?? "gagal";
    }
  }

  // Dipanggil walau ban gagal: memutuskan sesi tetap berguna justru saat jalur
  // masuk belum berhasil ditutup.
  const sesi = akunAda ? await cabutSesiDanIdentitas({ userId, admin: klien }) : { ok: true, sesi: 0, identitas: 0 };

  return {
    aksesDicabut,
    galatAkses,
    sesiDicabut: sesi.ok === true,
    identitasDilepas: sesi.ok ? sesi.identitas ?? 0 : null,
    galatPemutusan: sesi.ok ? null : sesi.error ?? "gagal",
    perluMigrasi: Boolean(sesi.perluMigrasi),
  };
}

/**
 * Tulis jejak pencabutan ke baris permintaan.
 *
 * `dicabut_pada` diisi HANYA bila keduanya berhasil — kolom itu berarti
 * "selesai dicabut", bukan "pernah dicoba".
 */
export async function catatPencabutan({
  requestId,
  aksesDicabut,
  sesiDicabut,
  catatan = null,
  admin,
  sekarangMs = Date.now(),
} = {}) {
  if (!requestId) return { ok: false, error: "permintaan_kosong" };
  let klien = admin;
  try {
    klien = klien || createAdminClient();
  } catch (err) {
    return { ok: false, error: err?.message ?? "env" };
  }

  const sukses = Boolean(aksesDicabut && sesiDicabut);
  const { error } = await klien
    .from("account_deletion_requests")
    .update({
      akses_dicabut: Boolean(aksesDicabut),
      sesi_dicabut: Boolean(sesiDicabut),
      dicabut_pada: sukses ? new Date(sekarangMs).toISOString() : null,
      catatan_pencabutan: String(catatan ?? "").trim() || null,
      updated_at: new Date(sekarangMs).toISOString(),
    })
    .eq("id", requestId);

  if (error) {
    return {
      ok: false,
      error: error.message,
      perluMigrasi: /does not exist|schema cache|find the column|column .* does not exist/i.test(error.message || ""),
    };
  }
  return { ok: true };
}

/**
 * Kelas keadaan pencabutan satu baris permintaan. Murni (tanpa database) supaya
 * panel, alat operasional, dan probe memakai penilaian yang sama persis.
 *
 * "Tidak ada catatan" SENGAJA dibedakan dari "aman": permintaan yang dijalankan
 * sebelum kolom jejaknya ada tidak bisa dianggap beres hanya karena tidak ada
 * galat yang tercatat.
 */
export function kelasPencabutan(baris = {}) {
  if (baris.status && baris.status !== "selesai") return "bukan_selesai";
  if (baris.user_id === null) return "tiada_akun"; // tidak ada yang perlu dicabut
  if (baris.akses_dicabut === false) return "akses_gagal";
  if (baris.akses_dicabut == null) return "belum_dicatat";
  if (baris.sesi_dicabut !== true) return "sesi_gagal";
  return "aman";
}

/** Kalimat untuk tiap kelas pencabutan; null bila tidak ada yang perlu dikatakan. */
export const PESAN_PENCABUTAN = {
  belum_dicatat: "Tidak ada catatan pencabutan — permintaan ini dijalankan sebelum jejaknya dicatat; periksa keadaan akunnya.",
  akses_gagal: "Akses masuk TIDAK tercabut — akun ini masih bisa masuk dengan surel & kata sandi lamanya.",
  sesi_gagal: "Akses masuk sudah dicabut, tetapi sesi yang sedang berjalan belum diputus (berlaku paling lama sampai access token-nya kedaluwarsa).",
};

export function pesanPencabutan(kode) {
  return PESAN_PENCABUTAN[kode] || null;
}

/**
 * Permintaan 'selesai' yang pencabutannya belum tercatat atau gagal sebagian.
 * Melempar galat yang jelas bila migrasi jejak pencabutan belum dijalankan.
 */
export async function daftarPencabutanGagal({ admin, limit = 200 } = {}) {
  const klien = admin || createAdminClient();
  const { data, error } = await klien
    .from("account_deletion_requests")
    .select(
      "id, user_id, email, sumber, status, decided_at, akses_dicabut, sesi_dicabut, dicabut_pada, catatan_pencabutan"
    )
    .eq("status", "selesai")
    .order("decided_at", { ascending: true })
    .limit(limit);

  if (error) {
    const migrasi = /does not exist|schema cache|column .* does not exist|find the column/i.test(error.message || "");
    const err = new Error(
      migrasi
        ? "Migrasi jejak pencabutan belum dijalankan: supabase/migrate-account-revocation.sql"
        : error.message
    );
    err.perluMigrasi = migrasi;
    throw err;
  }

  return (data ?? []).filter((r) => !["aman", "tiada_akun", "bukan_selesai"].includes(kelasPencabutan(r)));
}

/**
 * CABUT ULANG akses sebuah permintaan yang sudah 'selesai'.
 *
 * Hanya menyentuh pencabutan (surel tombstone + ban + sesi/identitas) — data
 * yang sudah dianonimkan TIDAK diubah lagi, jadi aman dijalankan berkali-kali.
 */
export async function cobaUlangPencabutan({ requestId, admin } = {}) {
  const klien = admin || createAdminClient();

  const { data: baris, error } = await klien
    .from("account_deletion_requests")
    .select("id, user_id, email, status")
    .eq("id", requestId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!baris) return { ok: false, error: "permintaan_tidak_ada" };
  if (baris.status !== "selesai") {
    return { ok: false, error: "status_bukan_selesai", status: baris.status };
  }
  if (!baris.user_id) return { ok: false, error: "permintaan_tanpa_akun" };

  // Akunnya mungkin sudah tidak ada (dihapus langsung di dashboard) — itu bukan
  // kegagalan, tetapi harus dibedakan di laporan.
  let akunAda = true;
  try {
    const { data: detail } = await klien.auth.admin.getUserById(baris.user_id);
    akunAda = Boolean(detail?.user);
  } catch {
    akunAda = true; // ragu = perlakukan sebagai ada, supaya pencabutannya dicoba
  }

  const hasil = await cabutAksesPengguna({
    userId: baris.user_id,
    tombstone: tombstoneUntuk(baris.user_id),
    akunAda,
    admin: klien,
  });

  const jejak = await catatPencabutan({
    requestId: baris.id,
    aksesDicabut: hasil.aksesDicabut,
    sesiDicabut: hasil.sesiDicabut,
    catatan: [
      hasil.galatAkses && `akses masuk: ${hasil.galatAkses}`,
      hasil.galatPemutusan && `sesi/identitas: ${hasil.galatPemutusan}`,
      !akunAda && "akun sudah tidak ada — tidak ada yang perlu dicabut",
    ]
      .filter(Boolean)
      .join(" · ") || null,
    admin: klien,
  });

  return {
    ok: true,
    requestId: baris.id,
    userId: baris.user_id,
    akunAda,
    ...hasil,
    jejakDicatat: jejak.ok,
    galatJejak: jejak.error ?? null,
  };
}

export async function eksekusiHapusAkun({ requestId, catatan = null, admin, kirimEmail = sendAccountDeletionDoneEmail } = {}) {
  const klien = admin || createAdminClient();

  const { data: hasil, error } = await klien.rpc("eksekusi_hapus_akun", {
    p_request: requestId,
    p_catatan: catatan,
  });
  if (error) return { ok: false, error: error.message };
  if (!hasil?.ok) return { ok: false, error: hasil?.error || "gagal_eksekusi", status: hasil?.status };
  if (hasil.tiada_akun) return { ok: true, tiadaAkun: true, requestId };

  const userId = hasil.user_id;
  const surelAsli = hasil.surel_asli || null;
  const tombstone = hasil.tombstone;

  // (1) Cabut akses masuk DAN putuskan sesi yang sudah terbit.
  //
  //     `aksesDicabut` menutup JALUR MASUK (surel tombstone + ban), tetapi ia
  //     TIDAK mematikan sesi yang sedang berjalan: access token yang sudah
  //     terbit tetap sah sampai kedaluwarsa, dan tautan identitas Google tetap
  //     menunjuk user yang sama. Keduanya ditutup `cabutAksesPengguna`.
  const cabut = await cabutAksesPengguna({ userId, tombstone, admin: klien });
  const { aksesDicabut, galatAkses, sesiDicabut, identitasDilepas, galatPemutusan } = cabut;

  // (1b) Jejaknya ditulis ke baris permintaan. Tanpa ini, kegagalan pencabutan
  //      hanya terlihat sekali di layar admin saat itu juga — padahal
  //      permintaannya sudah ditutup 'selesai', jadi tidak ada lagi yang
  //      menunggu diperiksa (dan akunnya tetap bisa masuk dengan sandi lama).
  const jejak = await catatPencabutan({
    requestId,
    aksesDicabut,
    sesiDicabut,
    catatan:
      [
        galatAkses && `akses masuk: ${galatAkses}`,
        galatPemutusan && `sesi/identitas: ${galatPemutusan}`,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    admin: klien,
  });

  // (2) Berkas pribadi (KTP & foto profil) — best-effort, dilaporkan apa adanya.
  const berkasDihapus = [];
  const daftar = Array.isArray(hasil.berkas) ? hasil.berkas : [];
  const [ktp, avatar] = daftar;
  for (const [nilai, bucket] of [
    [ktp, BUCKET_KTP],
    [avatar, BUCKET_AVATAR],
  ]) {
    const jalur = pathBerkas(nilai, bucket);
    if (!jalur) continue;
    try {
      const { error: errHapus } = await klien.storage.from(bucket).remove([jalur]);
      berkasDihapus.push({ bucket, jalur, ok: !errHapus, error: errHapus?.message ?? null });
    } catch (err) {
      berkasDihapus.push({ bucket, jalur, ok: false, error: err?.message ?? "gagal" });
    }
  }

  // (3) Surel pemberitahuan ke alamat ASLI (sebelum tombstone): pengguna berhak
  //     tahu permintaannya sudah dijalankan dan data apa yang masih disimpan.
  let surel = null;
  if (surelAsli) {
    try {
      surel = await kirimEmail({ to: surelAsli, siteUrl: process.env.NEXT_PUBLIC_SITE_URL || null });
    } catch (err) {
      surel = { error: err?.message };
    }
  }

  return {
    ok: true,
    requestId,
    userId,
    aksesDicabut,
    galatAkses,
    sesiDicabut,
    identitasDilepas,
    galatPemutusan,
    jejakDicatat: jejak.ok,
    galatJejak: jejak.error ?? null,
    perluMigrasiPencabutan: Boolean(cabut.perluMigrasi || jejak.perluMigrasi),
    berkasDihapus,
    terhapus: hasil.terhapus ?? {},
    surel,
    surelAsli,
  };
}

// ---------------------------------------------------------------------------
// Aturan yang DIBAGI halaman web, panel admin, dan alat operasional.
//
// Semuanya murni (tanpa database) supaya bisa diuji offline, dan supaya kalimat
// yang dibaca pengguna maupun admin berasal dari satu tempat — bukan disalin ke
// tiap permukaan lalu menyimpang satu sama lain.
// ---------------------------------------------------------------------------

/**
 * Kode blokir buatan LAPISAN APLIKASI (bukan fungsi SQL): dipakai panel ketika
 * fungsi penjaga belum ada di database, sehingga kelayakan belum bisa dipastikan
 * — yang berarti "periksa dulu", bukan "aman". Dideklarasikan lebih dulu karena
 * dipakai sebagai kunci pada objek di bawah.
 */
export const KODE_KELAYAKAN_RAGU = "kelayakan_tidak_terbaca";

/**
 * Seluruh kode buatan aplikasi (bukan dari SQL). Dipakai uji offline untuk
 * memastikan setiap kunci PESAN_BLOKIR benar-benar berasal dari fungsi
 * `hapus_akun_blokir` — kunci basi berarti kalimat yang tidak pernah muncul.
 */
export const KODE_BLOKIR_INTERNAL = [KODE_KELAYAKAN_RAGU];

/**
 * Alasan penolakan dari fungsi DB `hapus_akun_blokir` → kalimat untuk manusia.
 * Satu kode baru di SQL WAJIB ditambahkan di sini (dijaga uji offline), karena
 * kode yang tidak dikenal akan tampil sebagai "alasan teknis" di mata pengguna.
 */
export const PESAN_BLOKIR = {
  belum_masuk: "Sesi tidak dikenal. Buka halaman ini lagi dari tautan di emailmu.",
  profil_tidak_ada: "Akun dengan alamat itu sudah tidak ada.",
  akun_admin: "Akun admin tidak bisa dihapus sendiri lewat halaman ini — hubungi admin lain.",
  pesanan_aktif:
    "Masih ada pesanan yang belum selesai. Selesaikan atau batalkan dulu pesanan itu, lalu ajukan lagi.",
  tugas_aktif:
    "Masih ada pekerjaan yang sedang kamu kerjakan. Selesaikan atau lepaskan tugas itu dulu, lalu ajukan lagi.",
  saldo_belum_nol: "Saldo akunmu belum nol (ada komisi yang belum disetor). Bereskan saldo dulu.",
  penarikan_menunggu: "Masih ada pengajuan penarikan saldo yang menunggu persetujuan admin.",
  setoran_menunggu: "Masih ada pengajuan setor saldo yang menunggu verifikasi admin.",
  [KODE_KELAYAKAN_RAGU]:
    "Kelayakan permintaan ini belum bisa dipastikan karena fungsi penjaga belum ada di database — periksa manual sebelum menjalankan.",
};

/** Kalimat untuk sebuah kode blokir; null bila tidak ada blokir. Murni. */
export function pesanBlokir(kode) {
  if (!kode) return null;
  return PESAN_BLOKIR[kode] || `Permintaan belum bisa dijalankan (alasan dari server: ${kode}).`;
}

/**
 * Ringkasan apa yang DIHAPUS dan apa yang DISIMPAN — ditampilkan sebelum admin
 * menekan tombol. Panjangnya sengaja sama dengan penjelasan di
 * scripts/hapus-akun.mjs (versi konsol) supaya kedua alat tidak berbeda cerita.
 */
export const RENCANA_HAPUS = {
  dihapus: [
    "Nama, surel, telepon, alamat, foto profil, dan dokumen KTP pada profil",
    "Percakapan, lampiran obrolan, laporan yang pernah dibuat, dan token notifikasi perangkat",
    "Isi bebas-teks dan lampiran pada riwayat pesanan",
    "Berkas KTP & foto profil di penyimpanan",
  ],
  disimpan: [
    "Riwayat pesanan beserta nilai dan statusnya (catatan audit)",
    "Catatan saldo, komisi, dan penilaian teknisi (pembukuan)",
    "Baris permintaan ini sebagai jejak audit, tanpa identitas",
  ],
};

/**
 * Boleh tidaknya sebuah permintaan ditampilkan sebagai "siap dijalankan".
 *
 * `blokir` adalah jawaban fungsi DB yang sama dengan yang dipakai jalur
 * pengguna. Ia muncul lagi di sini bila keadaan akun BERUBAH setelah permintaan
 * dibuat (mis. saldo kembali terisi) — karena itu ia ditampilkan sebagai
 * peringatan yang harus dibaca admin, bukan disembunyikan.
 */
export function ringkasKelayakan({ status, blokir } = {}) {
  if (status !== "diminta") {
    return {
      boleh: false,
      kode: "status_bukan_diminta",
      pesan: `Permintaan berstatus "${status ?? "tidak diketahui"}" — hanya yang berstatus "diminta" yang menunggu dijalankan.`,
      peringatan: null,
    };
  }
  if (blokir) {
    return {
      boleh: true,
      kode: blokir,
      pesan: "Siap dijalankan, tetapi ada hal yang perlu diperiksa lebih dulu — lihat peringatan di bawah.",
      peringatan: pesanBlokir(blokir),
    };
  }
  return { boleh: true, kode: null, pesan: "Siap dijalankan.", peringatan: null };
}

/**
 * Terjemahkan hasil eksekusi menjadi satu kalimat + tingkat keparahan untuk UI.
 *
 * Aturan yang tidak boleh dilunakkan: `aksesDicabut === false` adalah KEADAAN
 * BAHAYA, bukan sukses sebagian — data sudah dianonimkan tetapi akun masih bisa
 * dipakai masuk (kata sandi lama belum mati). Tingkat "bahaya" itulah yang
 * membuat panel menahan pesannya di layar, bukan lewat begitu saja.
 */
export function ringkasEksekusi(hasil = {}) {
  if (!hasil.ok) {
    return {
      tingkat: "gagal",
      pesan:
        hasil.error === "bukan_admin"
          ? "Akses ditolak."
          : `Penghapusan gagal: ${hasil.error || "sebab tidak diketahui"}.`,
    };
  }
  if (hasil.tiadaAkun) {
    return {
      tingkat: "info",
      pesan: "Tidak ada akun dengan surel itu — permintaan ditutup tanpa mengubah data apa pun.",
    };
  }
  if (!hasil.aksesDicabut) {
    return {
      tingkat: "bahaya",
      pesan:
        "Data sudah dianonimkan, TETAPI akses masuk belum berhasil dicabut — akun masih bisa " +
        `dipakai masuk. Coba ulang sekarang: npm run hapus-akun -- --cabut=<id> --ya, atau ban ` +
        `akunnya manual di Supabase → Authentication. (${hasil.galatAkses || "sebab tidak diketahui"})`,
    };
  }
  // Akses masuk sudah ditutup, tetapi sesi/identitas belum: pengguna itu masih
  // bisa memakai sesi lamanya paling lama sampai access token kedaluwarsa.
  // Dibedakan dari "bahaya" karena jalur masuknya SUDAH tertutup, tetapi tetap
  // tidak boleh lewat begitu saja. `undefined` (pemanggil lama) = tidak diperiksa.
  if (hasil.sesiDicabut === false) {
    return {
      tingkat: "perhatian",
      pesan:
        "Penghapusan dijalankan dan akses masuk sudah dicabut, TETAPI sesi yang sedang berjalan " +
        `belum diputus — sesi lama masih bisa dipakai sampai tokennya kedaluwarsa. ` +
        `Coba ulang: npm run hapus-akun -- --belum-dicabut (${hasil.galatPemutusan || "sebab tidak diketahui"})`,
    };
  }
  if (hasil.jejakDicatat === false) {
    return {
      tingkat: "perhatian",
      pesan:
        "Penghapusan dijalankan dan akses sudah dicabut, TETAPI jejaknya gagal dicatat — " +
        `periksa kolom pencabutan (jalankan supabase/migrate-account-revocation.sql). (${hasil.galatJejak || "sebab tidak diketahui"})`,
    };
  }
  return {
    tingkat: "sukses",
    pesan: "Penghapusan dijalankan: akses masuk dicabut dan sesi yang berjalan sudah diputus.",
  };
}

/** Jeda antar-permintaan web untuk alamat yang sama (selaras dengan reset sandi). */
export { JEDA_PER_ALAMAT_MS };
