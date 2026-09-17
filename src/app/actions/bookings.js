"use server";

import { createClient } from "@/lib/supabase/server";
import { calculateTotal, genBookingCode } from "@/lib/pricing";
import { createPaymentTransaction } from "@/lib/payment";
import { sendBookingConfirmationEmail, sendAdminNewBookingEmail, sendAdminPaymentProofEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";

export async function createBooking(input) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Kamu harus login terlebih dahulu untuk membuat booking." };
  }

  const { serviceId, bookingDate, bookingTime, address, notes, attachmentUrl, paymentMethod, voucherId } = input;

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

  // ---- Voucher (opsional): validasi milik + aktif, lalu hitung diskon ----
  let voucher = null;
  if (voucherId) {
    const { data: v } = await supabase
      .from("vouchers")
      .select("id, code, amount, used_at, expires_at")
      .eq("id", voucherId)
      .eq("user_id", user.id)
      .single();

    if (!v) {
      return { error: "Voucher tidak ditemukan atau bukan milikmu." };
    }
    if (v.used_at) {
      return { error: "Voucher ini sudah pernah dipakai." };
    }
    if (new Date(v.expires_at) < new Date()) {
      return { error: "Voucher sudah kedaluwarsa." };
    }
    voucher = v;
  }

  const { subtotal, appFee, total } = calculateTotal(
    service.base_price,
    voucher?.amount || 0
  );
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
      discount_amount: voucher?.amount || 0,
      status: "pending",
      payment_method: paymentMethod,
    })
    .select("*")
    .single();

  if (insertErr) {
    // kolom discount_amount belum ada di DB → ulangi tanpa diskon agar booking tetap jalan
    if (/discount_amount/.test(insertErr.message)) {
      const retry = await supabase
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
          total_price: subtotal + appFee, // tanpa diskon
          status: "pending",
          payment_method: paymentMethod,
        })
        .select("*")
        .single();
      if (retry.error) return { error: "Gagal menyimpan booking: " + retry.error.message };
      return finishBookingCreation(supabase, {
        booking: retry.data,
        service,
        profile,
        user,
        paymentMethod,
        voucher: null,
        voucherWarning: "Voucher gagal diterapkan (kolom diskon belum ada) — booking dibuat tanpa diskon.",
      });
    }
    return { error: "Gagal menyimpan booking: " + insertErr.message };
  }

  return finishBookingCreation(supabase, {
    booking,
    service,
    profile,
    user,
    paymentMethod,
    voucher,
  });
}

/**
 * Lanjutan createBooking setelah baris booking tersimpan:
 * tandai voucher terpakai, kirim email, payment gateway.
 */
async function finishBookingCreation(supabase, { booking, service, profile, user, paymentMethod, voucher, voucherWarning }) {
  // Tandai voucher terpakai (best-effort — kalau gagal, voucher tetap bisa dipakai lagi)
  if (voucher) {
    const { error: useErr } = await supabase
      .from("vouchers")
      .update({ used_at: new Date().toISOString(), used_booking_id: booking.id })
      .eq("id", voucher.id)
      .eq("user_id", user.id)
      .is("used_at", null); // guard: jangan dobel
    if (useErr) console.warn("[voucher] gagal menandai terpakai:", useErr.message);
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

  return { booking, service, payment, voucherWarning: voucherWarning || null };
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

/**
 * Simpan bukti pembayaran pelanggan: foto bukti transfer + jumlah dibayar.
 * Dipanggil dari PaymentConfirmModal setelah gambar diunggah ke Storage.
 * Status TIDAK berubah paid otomatis — menunggu verifikasi admin
 * (kalau policy admin belum memungkinkan, alur lama konfirmasi-langsung tetap jalan).
 */
export async function submitPaymentProof({ bookingId, proofUrl, amount }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Belum login." };

  if (!proofUrl) return { error: "Unggah gambar bukti pembayaran dulu." };
  const amt = Number(amount);
  if (!amt || amt <= 0) return { error: "Isi jumlah pembayaran yang kamu transfer." };

  // pastikan booking milik user & masih menunggu pembayaran
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, code, status, user_id, total_price, payment_method")
    .eq("id", bookingId)
    .eq("user_id", user.id)
    .single();

  if (!booking) return { error: "Pesanan tidak ditemukan atau bukan milikmu." };
  if (booking.status !== "pending") {
    return { error: "Pembayaran pesanan ini sudah dikonfirmasi / tidak bisa diubah lagi." };
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({
      payment_proof_url: proofUrl,
      payment_amount: Math.round(amt),
    })
    .eq("id", bookingId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    if (/payment_proof_url|payment_amount/.test(error.message || "")) {
      return {
        error:
          "Kolom bukti pembayaran belum ada di database — jalankan supabase/migrate-payment-proofs.sql di SQL Editor (atau tambahkan lewat Table Editor), lalu coba lagi.",
      };
    }
    return { error: error.message };
  }

  // email ke semua admin: bukti menunggu verifikasi (fire-and-forget)
  try {
    const [{ data: profile }, { data: adminEmails }] = await Promise.all([
      supabase.from("profiles").select("name, phone").eq("id", user.id).single(),
      supabase.rpc("get_admin_emails"),
    ]);
    if (adminEmails?.length) {
      sendAdminPaymentProofEmail(adminEmails, {
        code: booking.code,
        customer_name: profile?.name || user.email,
        customer_phone: profile?.phone || "",
        method: booking.payment_method,
        amount: amt,
        total: booking.total_price,
        proofUrl,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn("[bukti bayar] email admin gagal:", e?.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { booking: data, code: booking.code, total: booking.total_price, method: booking.payment_method };
}

/**
 * Bersihkan penolakan bukti lama saat pelanggan mengirim ulang.
 * Taxatan: submitPaymentProof sudah menimpa bukti; aksi ini me-reset
 * flag penolakan sehingga kartu kembali "menunggu verifikasi".
 */
export async function resetPaymentRejection(bookingId) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Belum login." };

  const { data, error } = await supabase
    .from("bookings")
    .update({ payment_rejected: false, payment_rejection_reason: null })
    .eq("id", bookingId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("*")
    .single();

  if (error) {
    if (/payment_rejected/.test(error.message || "")) {
      return { error: "Kolom penolakan belum ada di database — jalankan supabase/migrate-payment-rejection.sql dulu." };
    }
    return { error: error.message };
  }
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

  const [bookingsRes, reviewsRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "*, services(name, category_id), technician:profiles!bookings_technician_id_fkey(id, name, phone)"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    // rating milik user untuk tiap booking — dipakai tombol "Nilai/Ubah Penilaian" di kartu.
    // Promise.allSettled-like: reviewsRes.error diabaikan (tabel reviews mungkin belum ada).
    supabase.from("reviews").select("booking_id, rating").eq("user_id", user.id),
  ]);

  const bookings = bookingsRes.data || [];
  const ratingByBooking = {};
  if (!reviewsRes.error) {
    for (const r of reviewsRes.data || []) ratingByBooking[r.booking_id] = r.rating;
  }
  for (const b of bookings) b.myRating = ratingByBooking[b.id] || null;

  return { bookings };
}

/**
 * Unduh PDF struk milik sendiri.
 * PDF dibuat di server (pdfkit) — identik dengan yang dikirim ke email —
 * jadi client tidak perlu memuat library PDF berat (html2pdf/jsPDF ~900 KB).
 * Return base64; komponen client yang mengubahnya menjadi berkas unduhan.
 */
export async function downloadMyReceiptPdf(bookingId) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Harus masuk dulu." };

  const { data: b, error } = await supabase
    .from("bookings")
    .select(
      "*, services(name), profiles!bookings_user_id_fkey(name, email, phone), technician:profiles!bookings_technician_id_fkey(name, phone)"
    )
    .eq("id", bookingId)
    .eq("user_id", user.id) // hanya pesanan milik sendiri
    .single();
  if (error || !b) return { error: "Pesanan tidak ditemukan." };

  const { buildReceiptPdf } = await import("@/lib/receipt-pdf");
  const pdfBuffer = await buildReceiptPdf({
    booking: b,
    customerName: b.profiles?.name || user.email,
    customerPhone: b.profiles?.phone || "",
  });

  return { base64: pdfBuffer.toString("base64"), filename: `struk-${b.code}.pdf` };
}
