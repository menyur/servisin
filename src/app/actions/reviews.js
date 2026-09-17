"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  REVIEW_INCENTIVE_DAYS,
  REVIEW_INCENTIVE_AMOUNT,
  VOUCHER_VALIDITY_DAYS,
} from "@/lib/pricing";

/**
 * Simpan penilaian pelanggan untuk satu pesanan selesai.
 * - booking harus milik user
 * - status harus completed
 * - harus ada teknisi yang ditugaskan
 * - satu penilaian per pesanan (dikirim ulang = memperbarui)
 * Pesan error ramah bila tabel reviews belum dibuat di database.
 */
export async function submitReview({ bookingId, rating, comment }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Kamu harus masuk untuk memberi penilaian." };

  const rate = Number(rating);
  if (!bookingId) return { error: "Pilih pesanan yang ingin dinilai." };
  if (!Number.isInteger(rate) || rate < 1 || rate > 5) {
    return { error: "Rating harus 1–5 bintang." };
  }

  // verifikasi: milik user + selesai + ada teknisinya + kapan selesai + rating lama (untuk insentif)
  let { data: booking, error: bkErr } = await supabase
    .from("bookings")
    .select("id, status, technician_id, user_id, completed_at")
    .eq("id", bookingId)
    .eq("user_id", user.id)
    .single();

  // kolom completed_at belum ada di DB (migrasi belum jalan) → ulangi tanpa itu;
  // penilaian tetap bisa dikirim, hanya insentif voucher yang dilewati
  if (bkErr && /completed_at/.test(bkErr.message || "")) {
    ({ data: booking } = await supabase
      .from("bookings")
      .select("id, status, technician_id, user_id")
      .eq("id", bookingId)
      .eq("user_id", user.id)
      .single());
  }

  if (!booking) return { error: "Pesanan tidak ditemukan atau bukan milikmu." };
  if (booking.status !== "completed") {
    return { error: "Hanya pesanan berstatus selesai yang bisa dinilai." };
  }
  if (!booking.technician_id) {
    return { error: "Pesanan ini belum punya teknisi yang bisa dinilai." };
  }

  // rating lama → membedakan penilaian baru vs update (update tidak memberi voucher)
  const { data: prevReview } = await supabase
    .from("reviews")
    .select("rating")
    .eq("booking_id", bookingId)
    .maybeSingle();
  booking.myRatingBefore = prevReview?.rating || null;

  const { error } = await supabase.from("reviews").upsert(
    {
      booking_id: bookingId,
      user_id: user.id,
      technician_id: booking.technician_id,
      rating: rate,
      comment: (comment || "").trim() || null,
    },
    { onConflict: "booking_id" }
  );

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      return { error: "Fitur penilaian belum aktif — jalankan supabase/migrate-reviews.sql (atau buat tabel lewat Table Editor) dulu." };
    }
    if (error.code === "42501" || /row-level security/i.test(error.message)) {
      return {
        error:
          "Database menolak penyimpanan penilaian (RLS). Jalankan supabase/fix-reviews-policies.sql di Supabase SQL Editor untuk memasang policy, lalu coba lagi.",
      };
    }
    return { error: "Gagal menyimpan penilaian: " + error.message };
  }

  // ---- Insentif: penilaian >REVIEW_INCENTIVE_DAYS hari setelah selesai → voucher ----
  let voucher = null;
  try {
    const isNewReview = !booking.myRatingBefore;
    if (isNewReview && booking.completed_at) {
      const days = (Date.now() - new Date(booking.completed_at).getTime()) / 86_400_000;
      if (days > REVIEW_INCENTIVE_DAYS) {
        voucher = await grantReviewVoucher(supabase, user.id, bookingId, days);
      }
    }
  } catch (e) {
    // voucher gagal → penilaian tetap valid, insentif dilewati
    console.warn("[review] voucher gagal dibuat:", e?.message);
  }

  revalidatePath("/dashboard");
  return { ok: true, voucher };
}

/**
 * Buat voucher unik untuk insentif penilaian (idempoten per booking).
 * source = review_incentive, booking_id = pemicu — kalau sudah pernah diberi, tidak dobel.
 */
async function grantReviewVoucher(supabase, userId, bookingId, daysLate) {
  const { data: existing } = await supabase
    .from("vouchers")
    .select("code, amount")
    .eq("source", "review_incentive")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (existing) return existing; // sudah pernah diberi untuk booking ini

  const code = `TERIMAKASIH-${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
  const expires = new Date(Date.now() + VOUCHER_VALIDITY_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("vouchers")
    .insert({
      user_id: userId,
      code,
      amount: REVIEW_INCENTIVE_AMOUNT,
      source: "review_incentive",
      booking_id: bookingId,
      expires_at: expires,
    })
    .select("code, amount")
    .single();

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      throw new Error("Tabel vouchers belum ada — jalankan supabase/migrate-vouchers.sql dulu.");
    }
    throw new Error(error.message);
  }
  return data;
}

/**
 * Voucher aktif milik user (belum dipakai & belum kedaluwarsa).
 */
export async function getMyVouchers() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { vouchers: [] };

  const { data, error } = await supabase
    .from("vouchers")
    .select("id, code, amount, expires_at, used_at")
    .eq("user_id", user.id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return { vouchers: [] };
    return { error: error.message };
  }
  return { vouchers: data || [] };
}

/**
 * Penilaian yang sudah dikirim user (untuk menandai pesanan yang sudah dinilai).
 */
export async function getMyReviews() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { reviews: [] };

  const { data, error } = await supabase
    .from("reviews")
    .select("booking_id, rating, comment")
    .eq("user_id", user.id);

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return { reviews: [] };
    return { error: error.message };
  }
  return { reviews: data || [] };
}
