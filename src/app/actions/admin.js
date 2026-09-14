"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireAdmin(supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return null;
  return user;
}

export async function getAllBookingsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak. Halaman ini khusus admin." };

  const { data } = await supabase
    .from("bookings")
    .select("*, services(name, category_id), profiles!bookings_user_id_fkey(name, phone, email), technician:profiles!bookings_technician_id_fkey(id, name)")
    .order("created_at", { ascending: false });

  return { bookings: data || [] };
}

export async function updateBookingStatusAdmin(bookingId, status) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const allowed = ["pending", "paid", "in_progress", "completed", "cancelled"];
  if (!allowed.includes(status)) return { error: "Status tidak valid." };

  const { error } = await supabase.from("bookings").update({ status }).eq("id", bookingId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function updateServicePriceAdmin(serviceId, basePrice) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const price = Number(basePrice);
  if (!price || price < 0) return { error: "Harga tidak valid." };

  const { error } = await supabase.from("services").update({ base_price: price }).eq("id", serviceId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function getAllServicesAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data } = await supabase.from("services").select("*, categories(name)").order("category_id");
  return { services: data || [] };
}

export async function getAllUsersAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
  return { users: data || [] };
}

export async function updateUserRoleAdmin(userId, role) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const allowed = ["customer", "technician", "admin"];
  if (!allowed.includes(role)) return { error: "Role tidak valid." };

  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function assignTechnicianAdmin(bookingId, technicianId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { error } = await supabase
    .from("bookings")
    .update({ technician_id: technicianId || null })
    .eq("id", bookingId);

  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
