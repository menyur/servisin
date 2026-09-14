"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const TECHNICIAN_ALLOWED_STATUSES = ["in_progress", "completed"];

export async function getMyAssignments() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { bookings: [] };

  const { data } = await supabase
    .from("bookings")
    .select("*, services(name, category_id), profiles!bookings_user_id_fkey(name, phone, email)")
    .eq("technician_id", user.id)
    .order("booking_date", { ascending: true });

  return { bookings: data || [] };
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
