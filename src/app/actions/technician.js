"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const TECHNICIAN_ALLOWED_STATUSES = ["in_progress", "completed"];

export async function getMyAssignments() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { bookings: [], myRating: null };

  const { data } = await supabase
    .from("bookings")
    .select("*, services(name, category_id), profiles!bookings_user_id_fkey(name, phone, email)")
    .eq("technician_id", user.id)
    .order("booking_date", { ascending: true });

  // rating pribadi teknisi dari tabel reviews (kalau tabelnya sudah ada)
  let myRating = null;
  const { data: myReviews } = await supabase
    .from("reviews")
    .select("rating")
    .eq("technician_id", user.id);
  if (myReviews && myReviews.length > 0) {
    const sum = myReviews.reduce((s, r) => s + r.rating, 0);
    myRating = {
      avg: Math.round((sum / myReviews.length) * 10) / 10,
      count: myReviews.length,
    };
  }

  return { bookings: data || [], myRating };
}

export async function updateJobStatus(bookingId, status) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Belum login." };

  if (!TECHNICIAN_ALLOWED_STATUSES.includes(status)) {
    return { error: "Status tidak valid untuk diubah teknisi." };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId)
    .eq("technician_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/technician");
  return { ok: true };
}
