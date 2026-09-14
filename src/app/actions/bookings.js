"use server";

import { createClient } from "@/lib/supabase/server";
import { calculateTotal, genBookingCode } from "@/lib/pricing";
import { createPaymentTransaction } from "@/lib/payment";
import { sendBookingConfirmationEmail, sendAdminNewBookingEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";

export async function createBooking(input) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Kamu harus login terlebih dahulu untuk membuat booking." };
  }

  const { serviceId, bookingDate, bookingTime, address, notes, attachmentUrl, paymentMethod } = input;

  if (!serviceId || !bookingDate || !bookingTime || !address || !paymentMethod) {
    return { error: "Semua data booking wajib diisi." };
  }

  const { data: service, error: svcErr } = await supabase
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .single();

  if (svcErr || !service) {
    return { error: "Layanan tidak ditemukan." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { subtotal, appFee, total } = calculateTotal(service.base_price);
  const code = genBookingCode();

  const { data: booking, error: insertErr } = await supabase
    .from("bookings")
    .insert({
      code,
      user_id: user.id,
      service_id: serviceId,
      booking_date: bookingDate,
      booking_time: bookingTime,
      address,
      notes: notes || null,
      attachment_url: attachmentUrl || null,
      subtotal_price: subtotal,
      app_fee: appFee,
      total_price: total,
      status: "pending",
      payment_method: paymentMethod,
    })
    .select("*")
    .single();

  if (insertErr) {
    return { error: "Gagal menyimpan booking: " + insertErr.message };
  }

  const payment = await createPaymentTransaction({
    booking: {
      code: booking.code,
      total_price: booking.total_price,
      customer_name: profile?.name || user.email,
      customer_phone: profile?.phone || "",
    },
    method: paymentMethod,
  });

  await sendBookingConfirmationEmail({
    code: booking.code,
    customer_name: profile?.name || user.email,
    customer_email: user.email,
    service_name: service.name,
    booking_date: booking.booking_date,
    booking_time: booking.booking_time,
    address: booking.address,
    total_price: booking.total_price,
  });

  const { data: adminEmails } = await supabase.rpc("get_admin_emails");
  if (adminEmails?.length) {
    await sendAdminNewBookingEmail(adminEmails, {
      code: booking.code,
      service_name: service.name,
      customer_name: profile?.name || user.email,
      customer_phone: profile?.phone || "",
      booking_date: booking.booking_date,
      booking_time: booking.booking_time,
      address: booking.address,
      payment_method: booking.payment_method,
      total_price: booking.total_price,
    });
  }

  revalidatePath("/dashboard");

  return { booking, service, payment };
}

export async function confirmSimulatedPayment(bookingId) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Belum login." };

  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "paid" })
    .eq("id", bookingId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { booking: data };
}

export async function trackBookingByCode(code) {
  if (!code || !code.trim()) return { error: "Masukkan kode booking." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*, services(name, category_id)")
    .eq("code", code.trim().toUpperCase())
    .single();

  if (error || !data) {
    return { error: "Kode booking tidak ditemukan." };
  }
  return { booking: data };
}

export async function getMyBookings() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { bookings: [] };

  const { data } = await supabase
    .from("bookings")
    .select("*, services(name, category_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return { bookings: data || [] };
}
