"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { bacaReviewReward } from "@/lib/review-reward";

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
      // Kosong → string kosong, JANGAN null: di produksi kolom
      // `reviews.comment` NOT NULL (dibuat lewat Table Editor) sehingga
      // penilaian tanpa ulasan gagal tersimpan bila dikirim null.
      comment: (comment || "").trim(),
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

  // ---- Insentif: penilaian BARU → voucher diskon otomatis.
  //      Nominal, masa berlaku, dan jeda terbit dibaca dari setelan admin
  //      (tab "Voucher Penilaian", supabase/migrate-review-reward.sql) —
  //      paritas dengan aplikasi Flutter lewat review_reward_efektif().
  //      Gagal baca → nilai bawaan; penilaian tidak pernah ikut gagal.
  let voucher = null;
  try {
    const reward = await bacaReviewReward(supabase);
    const isNewReview = !booking.myRatingBefore;
    // amount 0 = admin sengaja mematikan insentif; penilaian tetap sah.
    if (isNewReview && reward.amount > 0) {
      const days = booking.completed_at
        ? (Date.now() - new Date(booking.completed_at).getTime()) / 86_400_000
        : 0;
      if (days >= reward.delayDays) {
        voucher = await grantReviewVoucher(supabase, user.id, bookingId, reward);
      }
    }
  } catch (e) {
    // voucher gagal → penilaian tetap valid, insentif dilewati
    console.warn("[review] voucher gagal dibuat:", e?.message);
  }

  revalidatePath("/dashboard");
  // rating tampil publik di /teknisi (cache unstable_cache bertag)
  revalidateTag("reviews");
  return { ok: true, voucher };
}

/**
 * Buat voucher unik untuk insentif penilaian (idempoten per booking).
 * source = review_incentive, booking_id = pemicu — kalau sudah pernah diberi, tidak dobel.
 */
async function grantReviewVoucher(supabase, userId, bookingId, reward) {
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
  // Nominal & masa berlaku DIBEKUKAN di baris voucher: mengubah setelan nanti
  // tidak boleh mengubah janji yang sudah dilihat pelanggan di tab Voucher Saya.
  const expires = new Date(Date.now() + reward.validDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("vouchers")
    .insert({
      user_id: userId,
      code,
      amount: reward.amount,
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
