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

  // (1) Cabut akses masuk: alamat auth diganti tombstone (identitas surel hilang
  //     dari auth.users) dan akun di-banned supaya kata sandi lama tidak bisa
  //     dipakai lagi. `email_confirm: true` mencegah GoTrue menuntut verifikasi
  //     ke alamat tombstone yang memang tidak bisa menerima surat.
  let aksesDicabut = false;
  let galatAkses = null;
  try {
    const { error: errAkses } = await klien.auth.admin.updateUserById(userId, {
      email: tombstone,
      email_confirm: true,
      ban_duration: "876000h", // ~100 tahun: permanen secara praktis
    });
    if (errAkses) galatAkses = errAkses.message;
    else aksesDicabut = true;
  } catch (err) {
    galatAkses = err?.message;
  }

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
        `dipakai masuk. Ban akun itu sekarang di Supabase → Authentication. (${hasil.galatAkses || "sebab tidak diketahui"})`,
    };
  }
  return {
    tingkat: "sukses",
    pesan: "Penghapusan dijalankan dan akses masuk sudah dicabut.",
  };
}

/** Jeda antar-permintaan web untuk alamat yang sama (selaras dengan reset sandi). */
export { JEDA_PER_ALAMAT_MS };
