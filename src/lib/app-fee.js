/**
 * Pembacaan BIAYA APLIKASI (biaya layanan platform) dari setelan admin.
 *
 * SATU pintu untuk jalur server: harga booking web, halaman panduan, dan panel
 * admin — supaya angka yang ditampilkan ke pelanggan, yang ditagihkan, dan yang
 * dilaporkan tidak pernah berbeda. Setelan ini hidup di `app_settings.app_fee`
 * (satu baris, id = 1) dan diubah admin di panel → tab "Biaya Aplikasi"
 * (src/components/AppFeeSettingsTab.js). Jalur aplikasi Flutter & RPC database
 * membaca nilai yang sama lewat `public.app_fee_efektif()`
 * (supabase/migrate-app-fee-setting.sql) — dua pembacaan, satu angka.
 *
 * KENAPA TIDAK DI-CACHE: nilainya hanya satu baris berdasarkan primary key,
 * sementara admin yang baru menyimpan mengharapkan pesanan berikutnya langsung
 * memakai tarif baru. Cache per-proses akan membuat perubahan itu terlihat
 * "tidak jalan" di sebagian instance server sampai prosesnya di-restart ulang.
 *
 * KENAPA GAGAL → BAWAAN (fail-open): gangguan pembacaan tidak boleh membuat
 * pesanan gagal dibuat atau biaya app hilang senyap menjadi 0. Nilai bawaan
 * adalah tarif yang sama dengan bawaan migrasi (APP_FEE), jadi yang terjadi saat
 * pembacaan gagal hanyalah "tarif kembali ke angka lama" — bukan tagihan tanpa
 * biaya aplikasi.
 */
import { APP_FEE, normalisasiAppFee } from "./pricing.js";

/**
 * Tarif biaya aplikasi yang SEDANG berlaku, hasil pembacaan setelan admin.
 *
 * @param {{from: Function}} supabase klien Supabase (server action / RSC)
 * @returns {Promise<number>} bilangan bulat 0..APP_FEE_MAKS (rupiah)
 */
export async function bacaAppFee(supabase) {
  const rinci = await bacaAppFeeRinci(supabase);
  return rinci.fee;
}

/**
 * Versi rinci — dipakai panel admin supaya bisa membedakan "tarif memang sekian"
 * dari "tarif bawaan karena setelannya belum ada/gagal dibaca". Menyembunyikan
 * perbedaan itu membuat admin mengira setelannya tersimpan padahal tidak.
 *
 * @returns {Promise<{fee: number, sumber: "setelan"|"bawaan", alasan: string|null}>}
 */
export async function bacaAppFeeRinci(supabase) {
  if (!supabase) return { fee: APP_FEE, sumber: "bawaan", alasan: "klien Supabase tidak tersedia" };
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("app_fee")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      // Tabel/kolom belum ada (migrasi belum dijalankan) → bawaan, tanpa log
      // berisik: ini keadaan yang wajar di lingkungan baru.
      if (/relation|does not exist|Could not find the table|schema cache|column/i.test(error.message || "")) {
        return { fee: APP_FEE, sumber: "bawaan", alasan: "setelan belum ada (migrasi belum dijalankan)" };
      }
      console.warn("[app-fee] gagal membaca setelan, memakai tarif bawaan:", error.message);
      return { fee: APP_FEE, sumber: "bawaan", alasan: error.message };
    }
    if (data?.app_fee == null) {
      return { fee: APP_FEE, sumber: "bawaan", alasan: "kolom app_fee masih kosong" };
    }
    return { fee: normalisasiAppFee(data.app_fee), sumber: "setelan", alasan: null };
  } catch (err) {
    console.warn("[app-fee] gagal membaca setelan, memakai tarif bawaan:", err?.message);
    return { fee: APP_FEE, sumber: "bawaan", alasan: err?.message || "galat tak dikenal" };
  }
}
