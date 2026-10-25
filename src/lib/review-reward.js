/**
 * Pembacaan INSENTIF VOUCHER PENILAIAN dari setelan admin.
 *
 * SATU pintu untuk jalur server (Server Action penilaian, banner dashboard,
 * panduan pelanggan, syarat & ketentuan, tab Voucher Saya) — supaya nominal
 * yang dijanjikan ke pelanggan sama dengan nominal voucher yang benar-benar
 * diterbitkan. Setelan hidup di `app_settings` (satu baris, id = 1), diubah
 * admin di panel → tab "Voucher Penilaian"
 * (src/components/ReviewRewardSettingsTab.js). Jalur aplikasi Flutter membaca
 * nilai yang sama lewat `public.review_reward_efektif()`
 * (supabase/migrate-review-reward.sql) — dua pembacaan, satu angka.
 *
 * KENAPA TIDAK DI-CACHE: hanya satu baris berdasarkan primary key, sementara
 * admin yang baru menyimpan mengharapkan penilaian berikutnya langsung memakai
 * nominal baru. Cache per-proses membuat perubahan terlihat "tidak jalan" di
 * sebagian instance sampai prosesnya di-restart.
 *
 * KENAPA GAGAL → BAWAAN (fail-open): gangguan pembacaan tidak boleh membuat
 * penilaian pelanggan gagal tersimpan. Nilai bawaan sama dengan bawaan migrasi
 * (REVIEW_INCENTIVE_* di pricing.js), jadi yang terjadi saat pembacaan gagal
 * hanyalah "insentif kembali ke angka lama" — bukan voucher tanpa nominal.
 */
import {
  REVIEW_INCENTIVE_AMOUNT,
  REVIEW_INCENTIVE_DAYS,
  VOUCHER_VALIDITY_DAYS,
} from "./pricing.js";

/** Batas yang sama dijaga di migrasi (constraint) & tab admin. */
export const REVIEW_REWARD_AMOUNT_MAKS = 100000;
export const REVIEW_REWARD_VALID_DAYS_MIN = 1;
export const REVIEW_REWARD_VALID_DAYS_MAKS = 365;
export const REVIEW_REWARD_DELAY_DAYS_MAKS = 30;

/** Nilai yang berlaku bila setelan belum ada / gagal dibaca. */
export const REVIEW_REWARD_BAWAAN = Object.freeze({
  amount: REVIEW_INCENTIVE_AMOUNT,
  validDays: VOUCHER_VALIDITY_DAYS,
  delayDays: REVIEW_INCENTIVE_DAYS,
});

function bulat(nilai, bawaan) {
  const n = Number(nilai);
  if (!Number.isFinite(n)) return bawaan;
  return Math.round(n);
}

/**
 * Jepit setelan ke rentang yang sah. Dipakai saat membaca dari database DAN
 * saat admin menyimpan, jadi angka di luar batas tidak bisa "lolos" hanya
 * karena satu jalur lupa memeriksa.
 *
 * `amount = 0` sah dan berarti insentif DIMATIKAN (penilaian tetap tersimpan).
 */
export function normalisasiReviewReward({ amount, validDays, delayDays } = {}) {
  const a = bulat(amount, REVIEW_REWARD_BAWAAN.amount);
  const v = bulat(validDays, REVIEW_REWARD_BAWAAN.validDays);
  const d = bulat(delayDays, REVIEW_REWARD_BAWAAN.delayDays);
  return {
    amount: Math.min(REVIEW_REWARD_AMOUNT_MAKS, Math.max(0, a)),
    validDays: Math.min(REVIEW_REWARD_VALID_DAYS_MAKS, Math.max(REVIEW_REWARD_VALID_DAYS_MIN, v)),
    delayDays: Math.min(REVIEW_REWARD_DELAY_DAYS_MAKS, Math.max(0, d)),
  };
}

/**
 * Insentif yang SEDANG berlaku, beserta asal nilainya.
 *
 * `sumber` dibedakan dengan sengaja: "setelan" berarti angka ini datang dari
 * database, "bawaan" berarti kolomnya belum ada/kosong sehingga yang berlaku
 * adalah angka bawaan kode. Tanpa pembedaan itu, admin bisa mengira setelannya
 * tersimpan padahal migrasinya belum dijalankan.
 *
 * @param {{from: Function}} supabase klien Supabase (server action / RSC)
 * @returns {Promise<{amount: number, validDays: number, delayDays: number, sumber: "setelan"|"bawaan", alasan: string|null}>}
 */
export async function bacaReviewReward(supabase) {
  const bawaan = { ...REVIEW_REWARD_BAWAAN, sumber: "bawaan", alasan: null };
  if (!supabase) return { ...bawaan, alasan: "klien Supabase tidak tersedia" };
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("review_reward_amount, review_reward_valid_days, review_reward_delay_days")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      // Tabel/kolom belum ada (migrasi belum dijalankan) → bawaan, tanpa log
      // berisik: ini keadaan yang wajar di lingkungan baru.
      if (/relation|does not exist|Could not find the table|schema cache|column/i.test(error.message || "")) {
        return { ...bawaan, alasan: "setelan belum ada (migrasi belum dijalankan)" };
      }
      console.warn("[review-reward] gagal membaca setelan, memakai nilai bawaan:", error.message);
      return { ...bawaan, alasan: error.message };
    }
    if (data?.review_reward_amount == null) {
      return { ...bawaan, alasan: "kolom review_reward_amount masih kosong" };
    }
    const n = normalisasiReviewReward({
      amount: data.review_reward_amount,
      validDays: data.review_reward_valid_days,
      delayDays: data.review_reward_delay_days,
    });
    return { ...n, sumber: "setelan", alasan: null };
  } catch (err) {
    console.warn("[review-reward] gagal membaca setelan, memakai nilai bawaan:", err?.message);
    return { ...bawaan, alasan: err?.message || "galat tak dikenal" };
  }
}
