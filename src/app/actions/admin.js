"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateTag } from "next/cache";
import { sendTechnicianAssignmentEmail, sendReportResolvedEmail, sendReceiptEmail } from "@/lib/email";
import { buildReceiptPdf } from "@/lib/receipt-pdf";
import { computeSplit } from "@/lib/pricing";
import { debitTechnicianCommission, creditTechnicianBalance } from "@/lib/balance";
import { ICONS } from "@/lib/icons";
import { revalidatePath } from "next/cache";

// Nama ikon yang boleh dipakai layanan baru (validasi server-side).
const ICON_NAMES = Object.keys(ICONS);

/** Label metode pembayaran untuk email & UI. */
function payLabel(m) {
  return { qris: "QRIS", virtual_account: "Virtual Account", e_wallet: "E-Wallet", cod: "Cash on Delivery" }[m] || m || "-";
}

/**
 * Konfirmasi pembayaran pesanan dari panel admin.
 * Bedanya dengan ubah status biasa: mencatat payment_confirmed_at + admin yang mengonfirmasi.
 */
export async function confirmBookingPaymentAdmin(bookingId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: b } = await supabase
    .from("bookings")
    .select("code, status, payment_method, user_id")
    .eq("id", bookingId)
    .single();

  if (!b) return { error: "Pesanan tidak ditemukan." };
  if (b.status !== "pending") {
    return { error: `Pembayaran hanya bisa dikonfirmasi untuk pesanan yang masih menunggu bayar (status sekarang: ${b.status}).` };
  }
  if (b.payment_method === "cod") {
    return { error: "Pesanan COD tidak perlu konfirmasi pembayaran — uang diterima tunai di lokasi." };
  }

  let { error } = await supabase
    .from("bookings")
    .update({
      status: "paid",
      payment_confirmed_at: new Date().toISOString(),
      payment_confirmed_by: admin.id,
    })
    .eq("id", bookingId);

  // kolom jejak pembayaran belum ada di DB → ulangi update status saja
  if (error && /payment_confirmed/.test(error.message || "")) {
    ({ error } = await supabase.from("bookings").update({ status: "paid" }).eq("id", bookingId));
  }
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return { ok: true, code: b.code };
}

/**
 * Tolak bukti pembayaran pelanggan beserta alasannya.
 * Status booking TETAP pending — pelanggan bisa mengirim ulang bukti yang benar.
 */
export async function rejectPaymentProofAdmin(bookingId, reason) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const clean = (reason || "").trim();
  if (clean.length < 5) {
    return { error: "Tulis alasan penolakan (minimal 5 karakter) — pelanggan akan membacanya." };
  }

  const { data: b } = await supabase
    .from("bookings")
    .select("code, status, payment_method")
    .eq("id", bookingId)
    .single();
  if (!b) return { error: "Pesanan tidak ditemukan." };
  if (b.status !== "pending") {
    return { error: "Bukti hanya bisa ditolak selama pesanan masih menunggu pembayaran." };
  }
  if (b.payment_method === "cod") {
    return { error: "Pesanan COD tidak punya bukti transfer untuk ditolak." };
  }

  let { error } = await supabase
    .from("bookings")
    .update({ payment_rejected: true, payment_rejection_reason: clean })
    .eq("id", bookingId);

  // kolom belum ada di DB → arahkan ke migrasi
  if (error && /payment_rejected/.test(error.message || "")) {
    return { error: "Kolom penolakan belum ada di database — jalankan supabase/migrate-payment-rejection.sql dulu." };
  }
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return { ok: true, code: b.code };
}

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

  // catat kapan pesanan selesai (dipakai insentif penilaian & laporan)
  const payload =
    status === "completed"
      ? { status, completed_at: new Date().toISOString() }
      : { status };

  let { error } = await supabase.from("bookings").update(payload).eq("id", bookingId);
  // kolom completed_at belum ada di DB → ulangi tanpa itu agar update status tetap jalan
  if (error && /completed_at/.test(error.message)) {
    ({ error } = await supabase.from("bookings").update({ status }).eq("id", bookingId));
  }
  if (error) return { error: error.message };

  // struk PDF otomatis ke pelanggan saat pesanan ditandai selesai (fire-and-forget)
  // + potong komisi dari saldo teknisi — keduanya tak pernah menggagalkan update status
  if (status === "completed") {
    sendReceiptForBooking(supabase, bookingId).catch(() => {});
    debitTechnicianCommission(supabase, bookingId).catch(() => {});
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout"); // refresh badge navbar (jumlah booking pending)
  return { ok: true };
}

/** Bangun PDF struk + kirim ke email pelanggan + arsipkan ke Storage. Tidak melempar error. */
async function sendReceiptForBooking(supabase, bookingId) {
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select(
        "*, services(name), profiles!bookings_user_id_fkey(name, email, phone), technician:profiles!bookings_technician_id_fkey(name, phone)"
      )
      .eq("id", bookingId)
      .single();
    if (!b?.profiles?.email) return;

    const pdfBuffer = await buildReceiptPdf({
      booking: b,
      customerName: b.profiles.name,
      customerPhone: b.profiles.phone,
    });

    await sendReceiptEmail(b.profiles.email, {
      code: b.code,
      customer_name: b.profiles.name,
      service_name: b.services?.name,
      booking_date: b.booking_date,
      booking_time: b.booking_time,
      technician_name: b.technician?.name,
      payment_method: b.payment_method,
      discount_amount: b.discount_amount || 0,
      total_price: b.total_price,
      filename: `struk-${b.code}.pdf`,
      pdfBase64: pdfBuffer.toString("base64"),
    });

    // arsipkan ke Storage + catat di tabel receipt_archives (kalau tabel sudah ada)
    // path unik per regenerasi: upload ulang = INSERT objek baru (RLS-insert saja
    // cukup), bukan UPDATE objek lama yang butuh policy update tersendiri.
    const path = `${b.user_id}/${b.code}-${Date.now()}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("receipts")
      .upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("Gagal arsip struk ke Storage:", upErr.message);
      return;
    }

    const { error: arcErr } = await supabase.from("receipt_archives").upsert({
      booking_id: bookingId,
      user_id: b.user_id,
      pdf_path: path,
      file_size: pdfBuffer.length,
    }, { onConflict: "booking_id" });
    if (arcErr) {
      console.error("Gagal catat arsip struk:", arcErr.message);
    }
  } catch (err) {
    console.error("Gagal kirim struk PDF:", err.message);
  }
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
  revalidateTag("services"); // harga juga tampil di landing page
  return { ok: true };
}

/**
 * Tambah layanan baru (tab Harga Layanan).
 * Kategori wajib ada; harga ≥ 0; icon divalidasi terhadap daftar ICONS.
 */
export async function createServiceAdmin(input) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const name = (input.name || "").trim();
  const categoryId = (input.categoryId || "").trim();
  const basePrice = Number(input.basePrice);
  if (!name) return { error: "Nama layanan wajib diisi." };
  if (!categoryId) return { error: "Kategori wajib dipilih." };
  if (!Number.isFinite(basePrice) || basePrice < 0) return { error: "Harga tidak valid." };

  const icon = ICON_NAMES.includes(input.icon) ? input.icon : "wrench";
  const description = (input.description || "").trim() || null;
  const durationEstimate = (input.durationEstimate || "").trim() || null;
  const priceNote = (input.priceNote || "mulai dari").trim() || "mulai dari";

  // sort_order paling akhir dalam kategori itu
  const { data: last } = await supabase
    .from("services")
    .select("sort_order")
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const sortOrder = (last?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("services")
    .insert({ name, category_id: categoryId, base_price: basePrice, description, duration_estimate: durationEstimate, price_note: priceNote, icon, image_url: (input.imageUrl || "").trim() || null, is_active: true, sort_order: sortOrder })
    .select("*, categories(name)")
    .single();
  if (error) {
    if (/row-level security/i.test(error.message || "")) {
      return { error: "Database menolak (RLS) — jalankan supabase/fix-admin-services.sql dulu." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/"); // layanan baru langsung tampil di landing page & booking
  revalidateTag("services"); // segarkan cache landing data
  return { service: data };
}

/**
 * Update detail layanan (nama, deskripsi, catatan harga, durasi, ikon)
 * dari kartu layanan di tab Harga Layanan. Harga lewat updateServicePriceAdmin.
 */
export async function updateServiceDetailAdmin(serviceId, input) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const patch = {};
  const name = (input.name || "").trim();
  if (!name) return { error: "Nama layanan tidak boleh kosong." };
  patch.name = name;
  patch.description = (input.description || "").trim() || null;
  patch.price_note = (input.priceNote || "mulai dari").trim() || "mulai dari";
  patch.duration_estimate = (input.durationEstimate || "").trim() || null;
  if (input.icon && ICON_NAMES.includes(input.icon)) patch.icon = input.icon;
  // imageUrl: URL baru dari upload, null = hapus foto, undefined = tidak diubah
  if (input.imageUrl !== undefined) patch.image_url = (input.imageUrl || "").trim() || null;

  const { data, error } = await supabase
    .from("services")
    .update(patch)
    .eq("id", serviceId)
    .select("*, categories(name)");
  if (error) {
    if (/row-level security/i.test(error.message || "")) {
      return { error: "Database menolak (RLS) — jalankan supabase/fix-admin-services.sql dulu." };
    }
    return { error: error.message };
  }
  if (!data || data.length === 0) {
    // RLS memfilter baris (policy UPDATE admin belum ada) atau id tak ditemukan
    return { error: "Tidak ada baris yang berubah — kemungkinan policy admin belum aktif. Jalankan supabase/fix-admin-services.sql di SQL Editor." };
  }

  revalidatePath("/admin");
  revalidatePath("/"); // nama/deskripsi baru langsung tampil di landing page
  revalidateTag("services");
  return { service: data[0] };
}

/** Aktif/nonaktifkan layanan tanpa menghapusnya (pesanan lama tetap utuh). */
export async function toggleServiceActiveAdmin(serviceId, isActive) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { error } = await supabase.from("services").update({ is_active: !!isActive }).eq("id", serviceId);
  if (error) {
    if (/row-level security/i.test(error.message || "")) {
      return { error: "Database menolak (RLS) — jalankan supabase/fix-admin-services.sql dulu." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidateTag("services");
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

  // agregat rating per teknisi dari tabel reviews (kalau tabelnya sudah ada)
  const ratingMap = {};
  const { data: agg } = await supabase.from("reviews").select("technician_id, rating");
  if (agg) {
    for (const r of agg) {
      if (!ratingMap[r.technician_id]) ratingMap[r.technician_id] = { sum: 0, count: 0 };
      ratingMap[r.technician_id].sum += r.rating;
      ratingMap[r.technician_id].count += 1;
    }
  }
  const users = (data || []).map((u) => {
    const agg2 = ratingMap[u.id];
    return {
      ...u,
      rating_avg: agg2 && agg2.count ? Math.round((agg2.sum / agg2.count) * 10) / 10 : null,
      rating_count: agg2 ? agg2.count : 0,
    };
  });

  return { users };
}

export async function getAllReportsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak. Halaman ini khusus admin." };

  const { data, error } = await supabase
    .from("reports")
    .select(
      "*, author:profiles!reports_author_id_fkey(name, email, role), target:profiles!reports_target_id_fkey(name, email), bookings(code, services(name))"
    )
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };
  return { reports: data || [] };
}

export async function updateReportAdmin(reportId, status, adminNote) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  if (!["open", "reviewed", "resolved"].includes(status)) {
    return { error: "Status laporan tidak valid." };
  }

  // ambil kondisi lama untuk mendeteksi transisi ke "resolved" (untuk email ke pelapor)
  const { data: before } = await supabase
    .from("reports")
    .select("status, title, author_id, bookings(code)")
    .eq("id", reportId)
    .single();

  const { error } = await supabase
    .from("reports")
    .update({ status, admin_note: (adminNote || "").trim() || null })
    .eq("id", reportId);
  if (error) return { error: error.message };

  // email konfirmasi ke pelapor saat laporan diselesaikan (bukan saat dibuka kembali)
  if (status === "resolved" && before?.status !== "resolved") {
    notifyReporterResolved(supabase, {
      authorId: before.author_id,
      title: before.title || "",
      bookingCode: before.bookings?.code || null,
      adminNote: (adminNote || "").trim(),
    }).catch(() => {});
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Email ke pelapor saat laporannya diselesaikan. Fire-and-forget, tidak melempar error. */
async function notifyReporterResolved(supabase, { authorId, title, bookingCode, adminNote }) {
  try {
    const { data: reporter } = await supabase
      .from("profiles")
      .select("name, email")
      .eq("id", authorId)
      .single();
    if (!reporter?.email) return;

    await sendReportResolvedEmail(reporter.email, {
      reporter_name: reporter.name,
      title,
      booking_code: bookingCode,
      admin_note: adminNote,
    });
  } catch (err) {
    console.error("Gagal email konfirmasi laporan ke pelapor:", err.message);
  }
}

export async function getTechnicianApplicantsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, phone, approval_status, created_at")
    .eq("role", "technician")
    .order("approval_status", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };
  return { applicants: data || [] };
}

export async function setTechnicianApprovalAdmin(userId, approvalStatus) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  if (!["approved", "rejected", "pending"].includes(approvalStatus)) {
    return { error: "Status persetujuan tidak valid." };
  }

  // pastikan target memang teknisi — jangan sampai mengubah status customer/admin
  const { data: target } = await supabase.from("profiles").select("role, name, email").eq("id", userId).single();
  if (!target || target.role !== "technician") {
    return { error: "Hanya akun teknisi yang bisa disetujui/ditolak." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ approval_status: approvalStatus })
    .eq("id", userId)
    .eq("role", "technician");
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout"); // refresh badge navbar (jumlah pendaftar pending)
  return { ok: true };
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
  revalidatePath("/", "layout"); // ganti role bisa mengubah badge pendaftar teknisi
  return { ok: true };
}

/**
 * Ubah persen komisi platform untuk satu teknisi (0–100).
 * Mengembalikan pesan ramah bila kolom commission_rate belum ada di database
 * (migrasi / penambahan via Table Editor belum dijalankan).
 */
export async function updateCommissionRateAdmin(userId, rate) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const value = Number(rate);
  if (Number.isNaN(value) || value < 0 || value > 100) {
    return { error: "Komisi harus angka antara 0–100." };
  }

  // pastikan target memang teknisi
  const { data: target } = await supabase.from("profiles").select("role, name").eq("id", userId).single();
  if (!target || target.role !== "technician") {
    return { error: "Hanya akun teknisi yang punya komisi." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ commission_rate: value })
    .eq("id", userId)
    .eq("role", "technician");

  if (error) {
    if (/column .* does not exist/i.test(error.message)) {
      return { error: "Kolom commission_rate belum ada di database — tambahkan dulu lewat Table Editor (numeric, default 10)." };
    }
    return { error: error.message };
  }

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

  if (technicianId) {
    const [{ data: booking }, { data: technician }] = await Promise.all([
      supabase
        .from("bookings")
        .select("*, services(name), profiles!bookings_user_id_fkey(name, phone)")
        .eq("id", bookingId)
        .single(),
      supabase.from("profiles").select("name, email").eq("id", technicianId).single(),
    ]);

    if (booking && technician) {
      await sendTechnicianAssignmentEmail(technician.email, {
        code: booking.code,
        service_name: booking.services?.name,
        technician_name: technician.name,
        customer_name: booking.profiles?.name || "",
        customer_phone: booking.profiles?.phone || "",
        booking_date: booking.booking_date,
        booking_time: booking.booking_time,
        address: booking.address,
        notes: booking.notes,
      });
    }
  }

  revalidatePath("/admin");
  return { ok: true };
}

/* ============================== EXPORT CSV ============================== */

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  // selalu bungkus dengan kutip + escape kutip dalam — aman untuk koma, newline, titik-koma Excel
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV lengkap semua pesanan yang sudah selesai (untuk pembukuan admin).
 * Termasuk rincian uang (subtotal, diskon voucher, fee, total) dan
 * komisi platform vs bersih teknisi sesuai rate masing-masing teknisi.
 */
export async function getCompletedBookingsCsvAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `*, services(name), profiles!bookings_user_id_fkey(name, phone, email),
       technician:profiles!bookings_technician_id_fkey(id, name, phone, email, commission_rate)`
    )
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };
  const rows = data || [];

  const headers = [
    "Kode Pesanan",
    "Tanggal Pesan",
    "Jadwal Kunjungan",
    "Tanggal Selesai",
    "Layanan",
    "Pelanggan",
    "Telepon",
    "Email",
    "Alamat",
    "Metode Bayar",
    "Subtotal Layanan",
    "Diskon Voucher",
    "Biaya Aplikasi",
    "Total Dibayar",
    "Teknisi",
    "Kontak Teknisi",
    "Komisi Platform",
    "Bersih Teknisi",
  ];

  const payLabelMap = { qris: "QRIS", virtual_account: "Virtual Account", e_wallet: "E-Wallet", cod: "Cash on Delivery" };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");

  let totalRevenue = 0;
  let totalCommission = 0;
  const lines = [headers.map(csvEscape).join(";")];

  for (const b of rows) {
    const subtotal = Number(b.subtotal_price) || 0;
    const discount = Number(b.discount_amount) || 0;
    const fee = Number(b.app_fee) || 0;
    const total = Number(b.total_price) || 0;
    const split = computeSplit(total, b.technician?.commission_rate ?? undefined);
    totalRevenue += total;
    totalCommission += split.commission;

    lines.push(
      [
        b.code,
        fmtDate(b.created_at),
        `${b.booking_date} ${b.booking_time}`,
        fmtDate(b.completed_at),
        b.services?.name || "-",
        b.profiles?.name || "-",
        b.profiles?.phone || "-",
        b.profiles?.email || "-",
        b.address,
        payLabelMap[b.payment_method] || b.payment_method || "-",
        subtotal,
        discount,
        fee,
        total,
        b.technician?.name || "-",
        b.technician?.phone || "-",
        split.commission,
        split.net,
      ]
        .map(csvEscape)
        .join(";")
    );
  }

  // baris ringkasan di bawah
  lines.push("");
  lines.push([`Jumlah pesanan selesai`, rows.length].map(csvEscape).join(";"));
  lines.push(["Total pendapatan (dibayar)", totalRevenue].map(csvEscape).join(";"));
  lines.push(["Total komisi platform", totalCommission].map(csvEscape).join(";"));
  lines.push(["Diekspor", new Date().toLocaleString("id-ID")].map(csvEscape).join(";"));

  const stamp = new Date().toISOString().slice(0, 10);
  return { csv: "\uFEFF" + lines.join("\r\n"), filename: `pesanan-selesai-${stamp}.csv`, count: rows.length };
}

/* ========================= ARSIP LAPORAN BULANAN ========================= */

/**
 * Daftar arsip laporan bulanan (untuk tab Histori admin).
 */
export async function getMonthlyReportArchivesAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("monthly_report_archives")
    .select("id, year, month, csv_path, file_size, order_count, total_revenue, total_commission, created_at")
    .order("year", { ascending: false })
    .order("month", { ascending: false });

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      return { error: "Tabel monthly_report_archives belum ada — jalankan supabase/migrate-monthly-report-archives.sql dulu." };
    }
    return { error: error.message };
  }
  return { archives: data || [] };
}

/**
 * Signed URL unduh (10 menit) untuk satu arsip laporan bulanan.
 */
export async function getMonthlyReportDownloadUrlAdmin(archiveId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: rec } = await supabase
    .from("monthly_report_archives")
    .select("year, month, csv_path")
    .eq("id", archiveId)
    .single();
  if (!rec) return { error: "Arsip tidak ditemukan." };

  const { data, error } = await supabase.storage
    .from("laporan-bulanan")
    .createSignedUrl(rec.csv_path, 600, { download: `laporan-pesanan-${rec.year}-${String(rec.month).padStart(2, "0")}.csv` });

  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

/* ============================== VOUCHER ============================== */

/**
 * Semua voucher (termasuk yang sudah dipakai/kedaluwarsa) + ringkasan.
 * Butuh policy "admin can view all vouchers" di DB.
 */
export async function getAllVouchersAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("vouchers")
    .select(
      "*, owner:profiles!vouchers_user_id_fkey(name, email), used_booking:bookings!vouchers_used_booking_id_fkey(code)"
    )
    .order("expires_at", { ascending: false });

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      return { error: "Tabel vouchers belum ada — jalankan supabase/migrate-vouchers.sql dulu." };
    }
    return { error: error.message + " — jalankan supabase/fix-admin-vouchers.sql untuk policy admin." };
  }
  return { vouchers: data || [] };
}

/**
 * Buat voucher manual (kode promosi) untuk satu pelanggan.
 * amount: rupiah, validDays: masa berlaku.
 */
export async function createVoucherAdmin({ userId, amount, validDays, note }) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const amt = Number(amount);
  const days = Number(validDays) || 90;
  if (!userId) return { error: "Pilih penerima voucher." };
  if (!amt || amt <= 0) return { error: "Nominal voucher harus lebih dari 0." };
  if (days < 1 || days > 365) return { error: "Masa berlaku 1–365 hari." };

  // pastikan target ada
  const { data: target } = await supabase.from("profiles").select("name, email").eq("id", userId).single();
  if (!target) return { error: "Penerima tidak ditemukan." };

  const code = (note || "PROMO") .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "PROMO";
  const fullCode = `${code}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  const { data, error } = await supabase
    .from("vouchers")
    .insert({
      user_id: userId,
      code: fullCode,
      amount: Math.round(amt),
      source: "admin_manual",
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    })
    .select("code")
    .single();

  if (error) {
    if (/violates row-level security/i.test(error.message || "")) {
      return { error: "Database menolak (RLS) — jalankan supabase/fix-admin-vouchers.sql di SQL Editor untuk memberi admin akses voucher." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  return { ok: true, code: data.code, recipient: target.name };
}

/** Hapus voucher (palsu / salah input). */
export async function deleteVoucherAdmin(voucherId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { error } = await supabase.from("vouchers").delete().eq("id", voucherId);
  if (error) {
    if (/violates row-level security/i.test(error.message || "")) {
      return { error: "Database menolak (RLS) — jalankan supabase/fix-admin-vouchers.sql dulu." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  return { ok: true };
}

/* ========================= SALDO TEKNISI (TAB ADMIN) ========================= */

/**
 * Daftar pengajuan setor saldo teknisi (semua status) + profil ringkas.
 */
export async function getBalanceDepositsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("balance_deposits")
    .select("*, technician:profiles!balance_deposits_technician_id_fkey(id, name, email, balance, commission_rate)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    if (/relation|does not exist/i.test(error.message || "")) {
      return { error: "Tabel belum ada — jalankan supabase/migrate-technician-balance.sql dulu." };
    }
    return { error: error.message };
  }
  return { deposits: data || [] };
}

/**
 * Setujui bukti setor: saldo teknisi bertambah sebesar jumlah setor.
 */
export async function approveBalanceDepositAdmin(depositId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: dep } = await supabase
    .from("balance_deposits")
    .select("id, technician_id, amount, status")
    .eq("id", depositId)
    .single();
  if (!dep) return { error: "Pengajuan setor tidak ditemukan." };
  if (dep.status !== "pending") return { error: "Pengajuan ini sudah diproses sebelumnya." };

  const res = await creditTechnicianBalance(
    supabase,
    dep.technician_id,
    dep.amount,
    "Setor saldo disetujui admin",
    dep.id
  );
  if (!res.ok) return { error: res.error };

  const { error: upErr } = await supabase
    .from("balance_deposits")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", depositId)
    .eq("status", "pending"); // guard race: hanya pending yang bisa disetujui
  if (upErr) return { error: upErr.message };

  revalidatePath("/admin");
  revalidatePath("/technician");
  return { ok: true, balance: res.balance };
}

/**
 * Tolak bukti setor dengan alasan — teknisi bisa kirim ulang bukti baru.
 */
export async function rejectBalanceDepositAdmin(depositId, reason) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const clean = (reason || "").trim();
  if (clean.length < 5) return { error: "Tulis alasan penolakan (minimal 5 karakter)." };

  const { error } = await supabase
    .from("balance_deposits")
    .update({ status: "rejected", rejection_reason: clean, reviewed_at: new Date().toISOString() })
    .eq("id", depositId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Admin menambah saldo teknisi langsung (tanpa bukti setor) —
 * mis. koreksi manual atau bonus.
 */
export async function addTechnicianBalanceAdmin(technicianId, amount, note) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0) return { error: "Jumlah harus lebih dari 0." };

  const res = await creditTechnicianBalance(
    supabase,
    technicianId,
    amt,
    note?.trim() || "Ditambahkan manual oleh admin"
  );
  if (!res.ok) return { error: res.error };

  revalidatePath("/admin");
  revalidatePath("/technician");
  return { ok: true, balance: res.balance };
}

/* ========================= PENARIKAN SALDO (WITHDRAWAL) ========================= */

/**
 * Daftar pengajuan penarikan saldo teknisi (semua status).
 */
export async function getWithdrawalsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("balance_withdrawals")
    .select("*, technician:profiles!balance_withdrawals_technician_id_fkey(id, name, email, balance)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    if (/relation|does not exist/i.test(error.message || "")) {
      return { error: "Tabel penarikan belum ada — jalankan supabase/migrate-technician-withdrawals.sql dulu." };
    }
    return { error: error.message };
  }
  return { withdrawals: data || [] };
}

/**
 * Setujui penarikan: admin transfer dana ke rekening teknisi
 * di luar aplikasi; saldo teknisi SUDAH dipotong saat pengajuan.
 */
export async function approveWithdrawalAdmin(withdrawalId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: wd } = await supabase
    .from("balance_withdrawals")
    .select("id, status")
    .eq("id", withdrawalId)
    .single();
  if (!wd) return { error: "Pengajuan tidak ditemukan." };
  if (wd.status !== "pending") return { error: "Pengajuan ini sudah diproses sebelumnya." };

  const { error } = await supabase
    .from("balance_withdrawals")
    .update({ status: "approved", reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
    .eq("id", withdrawalId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/technician");
  return { ok: true };
}

/**
 * Tolak penarikan + alasan → saldo teknisi dikembalikan penuh
 * (transaksi 'refund' amount positif).
 */
export async function rejectWithdrawalAdmin(withdrawalId, reason) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const clean = (reason || "").trim();
  if (clean.length < 5) return { error: "Tulis alasan penolakan (minimal 5 karakter)." };

  const { data: wd } = await supabase
    .from("balance_withdrawals")
    .select("id, status, technician_id, amount, transaction_id, bank_name, account_number")
    .eq("id", withdrawalId)
    .single();
  if (!wd) return { error: "Pengajuan tidak ditemukan." };
  if (wd.status !== "pending") return { error: "Pengajuan ini sudah diproses sebelumnya." };

  // Refund penuh: transaksi positif + saldo profil naik
  const { data: tech } = await supabase
    .from("profiles")
    .select("balance")
    .eq("id", wd.technician_id)
    .single();

  const { data: refundTx, error: refundErr } = await supabase
    .from("balance_transactions")
    .insert({
      technician_id: wd.technician_id,
      type: "refund",
      amount: wd.amount,
      note: `Penarikan ditolak admin: ${clean}`.slice(0, 200),
    })
    .select("id")
    .single();
  if (refundErr) return { error: refundErr.message };

  const { error: balErr } = await supabase
    .from("profiles")
    .update({ balance: Number(tech?.balance || 0) + Number(wd.amount) })
    .eq("id", wd.technician_id);
  if (balErr) return { error: balErr.message };

  const { error } = await supabase
    .from("balance_withdrawals")
    .update({
      status: "rejected",
      rejection_reason: clean,
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      transaction_id: refundTx.id, // arahkan ke transaksi refund
    })
    .eq("id", withdrawalId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/technician");
  return { ok: true };
}
