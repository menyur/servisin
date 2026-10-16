"use server";

import { headers } from "next/headers";
import {
  mintaHapusAkunWeb,
  konfirmasiHapusAkun as konfirmasiPermintaan,
  PESAN_BLOKIR,
  JANJI_HARI,
} from "@/lib/account-deletion";

/**
 * Server action jalur WEB penghapusan akun (halaman /hapus-akun).
 *
 * Halaman ini publik — pengguna mungkin sudah tidak bisa masuk ke akunnya, jadi
 * satu-satunya pembuktian kepemilikan adalah tautan konfirmasi yang dikirim ke
 * surelnya (lihat src/lib/account-deletion.js).
 *
 * Dua aturan yang sengaja dipegang di sini:
 *   1. Jawaban sukses TIDAK membedakan "surel terdaftar" dari "tidak" — kalau
 *      dibedakan, halaman ini jadi alat menebak siapa yang punya akun Fixify.
 *   2. Kegagalan teknis (layanan surel belum siap) DIBEDAKAN, sebab "gagal di
 *      server" tidak boleh menyamar jadi "tautan sudah dikirim" — persis bug
 *      yang pernah membuat reset sandi tampak bekerja padahal tidak.
 */

/** Origin permintaan — cadangan terakhir bila NEXT_PUBLIC_SITE_URL kosong. */
async function dasarSitus() {
  const dariEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (dariEnv) return dariEnv;
  try {
    const h = await headers();
    return h.get("origin") || null;
  } catch {
    return null;
  }
}

export async function mintaHapusAkun(prevState, formData) {
  const email = String(formData.get("email") || "").trim();
  const alasan = String(formData.get("alasan") || "").trim();
  const dasar = await dasarSitus();

  const hasil = await mintaHapusAkunWeb({ email, alasan, siteUrl: dasar, origin: dasar });

  if (hasil.ok) {
    // Alamat yang ditampilkan kembali di layar sukses — bentuknya sudah
    // dinormalisasi oleh lib, dan tetap aman walau surelnya tidak terdaftar.
    return { success: true, email, janjiHari: JANJI_HARI };
  }

  // Nilai form dikembalikan bersama galat: React me-reset form setelah action
  // selesai, sehingga tanpa ini pengguna harus mengetik ulang alamatnya hanya
  // karena kegagalan sementara di server.
  switch (hasil.alasan) {
    case "email_tidak_valid":
      return { error: "Masukkan alamat email yang benar.", email, alasan };
    case "jeda":
      return {
        error: `Permintaan untuk alamat itu baru saja dikirim. Tunggu ${hasil.sisaDetik} detik sebelum meminta lagi.`,
        email,
        alasan,
      };
    case "env":
      return {
        error:
          "Layanan email sedang belum siap di server, jadi tautan konfirmasi tidak bisa dikirim. Coba lagi nanti atau hubungi halo@fixify.id.",
        email,
        alasan,
      };
    default:
      return { error: "Gagal mengirim tautan konfirmasi. Coba lagi sebentar lagi.", email, alasan };
  }
}

// PESAN_BLOKIR (alasan penolakan dari fungsi DB → kalimat manusiawi) sengaja
// TIDAK didefinisikan di sini, melainkan diimpor dari lib: panel admin memakai
// daftar yang sama, jadi penjelasan yang diterima pengguna dan yang dibaca admin
// tidak bisa menyimpang. Kelengkapannya dijaga uji offline.

export async function konfirmasiHapusAkun(prevState, formData) {
  const id = String(formData.get("id") || "");
  const token = String(formData.get("token") || "");

  const hasil = await konfirmasiPermintaan({ id, token });

  if (hasil.ok) {
    return {
      success: true,
      sudah: Boolean(hasil.sudah),
      email: hasil.email ?? null,
      janjiHari: JANJI_HARI,
    };
  }

  switch (hasil.alasan) {
    case "token_tidak_berlaku":
      return {
        error:
          "Tautan ini sudah tidak berlaku (kedaluwarsa atau sudah dipakai). Ajukan permintaan baru dari halaman Hapus Akun.",
      };
    case "permintaan_tidak_ada":
      return { error: "Permintaan tidak ditemukan. Ajukan ulang dari halaman Hapus Akun." };
    case "sudah_ditutup":
      return {
        error:
          hasil.status === "dibatalkan"
            ? "Permintaan ini sudah dibatalkan. Ajukan ulang bila memang ingin menghapus akun."
            : "Permintaan ini sudah tidak aktif. Ajukan ulang dari halaman Hapus Akun.",
      };
    case "env":
      return { error: "Server belum siap memproses permintaan. Coba lagi sebentar lagi." };
    default:
      if (PESAN_BLOKIR[hasil.alasan]) return { error: PESAN_BLOKIR[hasil.alasan] };
      return { error: "Permintaan tidak bisa dikonfirmasi sekarang. Hubungi halo@fixify.id." };
  }
}
