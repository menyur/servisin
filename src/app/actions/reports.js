"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendAdminNewReportEmail } from "@/lib/email";

/**
 * Laporan dari pelanggan: bebas (umum) atau terkait satu pesanan.
 * `bookingId` opsional; kalau diisi, diverifikasi milik user.
 */
export async function createCustomerReport(input) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Kamu harus masuk untuk membuat laporan." };

  const { bookingId, title, content } = input || {};
  if (!title?.trim() || !content?.trim()) {
    return { error: "Judul dan isi laporan wajib diisi." };
  }
  if (title.length > 120) {
    return { error: "Judul laporan maksimal 120 karakter." };
  }

  // verifikasi booking milik user (RLS juga menjaga, ini pesan errornya lebih ramah)
  let bookingCode = null;
  if (bookingId) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, code")
      .eq("id", bookingId)
      .eq("user_id", user.id)
      .single();
    if (!booking) {
      return { error: "Pesanan tidak ditemukan atau bukan milikmu." };
    }
    bookingCode = booking.code;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const { error } = await supabase
    .from("reports")
    .insert({
      author_id: user.id,
      author_role: "customer",
      booking_id: bookingId || null,
      title: title.trim(),
      content: content.trim(),
    });

  if (error) return { error: "Gagal mengirim laporan: " + error.message };

  // notifikasi email ke semua admin (fire-and-forget; gagal email tidak menggagalkan laporan)
  notifyAdminsNewReport(supabase, {
    author_role: "customer",
    title: title.trim(),
    content: content.trim(),
    author_name: profile?.name || user.email,
    author_email: user.email,
    booking_code: bookingCode,
  }).catch(() => {});

  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Laporan hasil pekerjaan dari teknisi untuk satu booking yang ditugaskan ke dia.
 */
export async function submitTechnicianReport({ bookingId, title, content }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Belum login." };

  if (!bookingId) return { error: "Pekerjaan tidak valid." };
  if (!title?.trim() || !content?.trim()) {
    return { error: "Judul dan isi laporan wajib diisi." };
  }
  if (title.length > 120) {
    return { error: "Judul laporan maksimal 120 karakter." };
  }

  // booking harus benar-benar ditugaskan ke teknisi ini
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, code, technician_id, services(name)")
    .eq("id", bookingId)
    .eq("technician_id", user.id)
    .single();
  if (!booking) {
    return { error: "Pekerjaan tidak ditemukan atau bukan tugasanmu." };
  }

  // satu laporan per pekerjaan per teknisi (idempoten)
  const { data: existing } = await supabase
    .from("reports")
    .select("id")
    .eq("author_id", user.id)
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (existing) {
    return { error: "Kamu sudah membuat laporan untuk pekerjaan ini." };
  }

  const { error } = await supabase.from("reports").insert({
    author_id: user.id,
    author_role: "technician",
    booking_id: bookingId,
    title: title.trim(),
    content: content.trim(),
  });

  if (error) return { error: "Gagal mengirim laporan: " + error.message };

  const { data: techProfile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  // notifikasi email ke semua admin (fire-and-forget)
  notifyAdminsNewReport(supabase, {
    author_role: "technician",
    title: title.trim(),
    content: content.trim(),
    author_name: techProfile?.name || user.email,
    author_email: user.email,
    booking_code: booking.code,
  }).catch(() => {});

  revalidatePath("/technician");
  return { ok: true };
}

/**
 * Kirim email notifikasi ke semua admin. Tidak melempar error —
 * kegagalan email tidak boleh menggagalkan laporan yang sudah tersimpan.
 */
async function notifyAdminsNewReport(supabase, payload) {
  try {
    const { data: adminEmails } = await supabase.rpc("get_admin_emails");
    if (!adminEmails?.length) return;
    await sendAdminNewReportEmail(adminEmails, payload);
  } catch (err) {
    console.error("Gagal notifikasi laporan ke admin:", err.message);
  }
}

/**
 * Daftar laporan milik user yang sedang login (pelanggan maupun teknisi).
 */
export async function getMyReports() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { reports: [] };

  const { data } = await supabase
    .from("reports")
    .select("*, bookings(code, services(name))")
    .eq("author_id", user.id)
    .order("created_at", { ascending: false });

  return { reports: data || [] };
}
