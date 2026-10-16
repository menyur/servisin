"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateTag } from "next/cache";
import { sendTechnicianAssignmentEmail, sendReportResolvedEmail, sendReceiptEmail, sendTechnicianBalanceReminderEmail } from "@/lib/email";
import { buildReceiptPdf } from "@/lib/receipt-pdf";
import {
  computeSplit,
  commissionBase,
  ledgerCommission,
  ledgerAppFee,
  penagihanPesanan,
  piutangTerbukaBaris,
  keranjangUmurPiutang,
  ambangPiutangHari,
} from "@/lib/pricing";
import { bacaPiutangTerbuka } from "@/lib/piutang";
import { debitTechnicianCommission, creditTechnicianBalance } from "@/lib/balance";
import { sendPushToUser, sendNewJobPushToTechnicians } from "@/lib/notify";
import { ICONS } from "@/lib/icons";
import { revalidatePath } from "next/cache";
import { ADMIN_NOTIFY_EVENTS, ADMIN_NOTIFY_EVENT_KEYS } from "@/lib/admin-notify-events";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  daftarPermintaanHapus,
  eksekusiHapusAkun,
  ringkasKelayakan,
  ringkasEksekusi,
  KODE_KELAYAKAN_RAGU,
  RENCANA_HAPUS,
  JANJI_HARI,
} from "@/lib/account-deletion";

// Nama ikon yang boleh dipakai layanan baru (validasi server-side).
const ICON_NAMES = Object.keys(ICONS);

/**
 * Label metode pembayaran untuk email & UI. Metode kini hanya cod/transfer;
 * kode lama (qris/virtual_account/e_wallet) ditampilkan sebagai Transfer Bank.
 */
function payLabel(m) {
  return { cod: "Bayar di Tempat (COD)", transfer: "Transfer Bank", qris: "Transfer Bank", virtual_account: "Transfer Bank", e_wallet: "Transfer Bank" }[m] || m || "-";
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
    .select("code, status, payment_method, user_id, address, service_id, services(name)")
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

  // push ke pelanggan: pembayaran dikonfirmasi
  await sendPushToUser(b.user_id, {
    title: "Pembayaran dikonfirmasi ✅",
    event: "payment_confirmed",
    body: `Pesanan ${b.code} sudah dikonfirmasi. Menunggu teknisi ditugaskan.`,
    url: "/dashboard",
    tag: `booking-${bookingId}`,
  });

  // broadcast ke teknisi terverifikasi sesuai area + keahlian: pekerjaan baru tersedia
  await sendNewJobPushToTechnicians({ id: bookingId, code: b.code, address: b.address }, {
    serviceName: b.services?.name,
    serviceId: b.service_id,
  });

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
    .select("code, status, payment_method, user_id")
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

  // push ke pelanggan: bukti ditolak, perlu kirim ulang
  await sendPushToUser(b.user_id, {
    title: "Bukti pembayaran ditolak",
    event: "payment_rejected",
    body: `Pesanan ${b.code}: ${clean} — silakan kirim ulang bukti yang benar.`,
    url: "/dashboard",
    tag: `booking-${bookingId}`,
  });

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

/**
 * Jarak tiap booking ber-pin dari titik referensi admin — via RPC
 * bookings_nearby (radius dibatasi 50 km oleh klamp server).
 * Hasil dipakai badge jarak di kartu booking + opsi urut "Terdekat".
 */
export async function getBookingDistancesAdmin(lat, lng) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) ||
      la < -90 || la > 90 || ln < -180 || ln > 180) {
    return { error: "Titik referensi tidak valid." };
  }

  const { data, error } = await supabase.rpc("bookings_nearby", {
    p_lat: la,
    p_lng: ln,
    p_radius_m: 50000,
    p_limit: 200,
  });
  if (error) {
    if (/does not exist|not found/i.test(error.message)) {
      return { error: "Migrasi PostGIS belum dijalankan di database." };
    }
    return { error: error.message };
  }
  return { bookings: (data || []).filter((r) => r.distance_m != null) };
}

export async function getAllBookingsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak. Halaman ini khusus admin." };

  const { data } = await supabase
    .from("bookings")
    .select("*, services(name, category_id), profiles!bookings_user_id_fkey(name, phone, email), technician:profiles!bookings_technician_id_fkey(id, name)")
    .order("created_at", { ascending: false });

  const bookings = data || [];

  // Rincian VOUCHER yang dipakai pada tiap pesanan.
  // bookings hanya menyimpan `discount_amount`; kode/nilai/asal voucher ada di
  // baris `vouchers` (kolom used_booking_id). Best-effort: kolom itu bisa belum
  // ada di DB lama — kartu admin tetap tampil tanpa rincian.
  try {
    const ids = bookings.map((b) => b.id);
    const byBooking = new Map();
    for (let i = 0; i < ids.length; i += 150) {
      const { data: used } = await supabase
        .from("vouchers")
        .select("code, amount, source, used_at, used_booking_id")
        .in("used_booking_id", ids.slice(i, i + 150));
      for (const v of used || []) byBooking.set(v.used_booking_id, v);
    }
    for (const b of bookings) {
      const v = byBooking.get(b.id);
      if (v) {
        b.voucher = {
          code: v.code,
          amount: Number(v.amount) || 0,
          source: v.source || null,
          used_at: v.used_at || null,
        };
      }
    }
  } catch (e) {
    console.warn("[admin] rincian voucher pesanan dilewati:", e?.message);
  }

  // Bucket bukti pembayaran kini PRIVAT (hasil audit) — kolom menyimpan path.
  // Tukar ke signed URL agar <img> admin tetap bisa menampilkan buktinya.
  const pathLike = bookings.filter((b) => b.payment_proof_url && !b.payment_proof_url.startsWith("http"));
  if (pathLike.length > 0) {
    const results = await Promise.all(
      pathLike.map(async (b) => {
        const { data: signed } = await supabase.storage.from("payment-proofs").createSignedUrl(b.payment_proof_url, 3600);
        return [b.id, signed?.signedUrl || null];
      })
    );
    const urlById = Object.fromEntries(results);
    for (const b of pathLike) b.payment_proof_url = urlById[b.id] || null;
  }

  return { bookings };
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

  // data minimal untuk push (user_id selalu ada; teknisi opsional)
  const { data: cur } = await supabase
    .from("bookings")
    .select("code, user_id, technician_id, address, services(name)")
    .eq("id", bookingId)
    .single();

  let { error } = await supabase.from("bookings").update(payload).eq("id", bookingId);
  // kolom completed_at belum ada di DB → ulangi tanpa itu agar update status tetap jalan
  if (error && /completed_at/.test(error.message)) {
    ({ error } = await supabase.from("bookings").update({ status }).eq("id", bookingId));
  }
  if (error) return { error: error.message };

  // push ke pelanggan sesuai status baru (fire-and-forget)
  if (cur) {
    if (status === "paid") {
      // pekerjaan kembali tersedia (mis. dibatalkan teknisi/admin)
      await sendNewJobPushToTechnicians(
        { id: bookingId, code: cur.code, address: cur.address },
        { serviceName: cur.services?.name }
      );
    } else if (status === "in_progress") {
      const techName = cur.technician_id
        ? (await supabase.from("profiles").select("name").eq("id", cur.technician_id).single()).data?.name
        : null;
      await sendPushToUser(cur.user_id, {
        title: "Pengerjaan dimulai 🚀",
        event: "work_started",
        body: techName
          ? `${techName} sedang mengerjakan pesanan ${cur.code} (${cur.services?.name || "layanan"}).`
          : `Pesanan ${cur.code} sedang dikerjakan.`,
        url: "/dashboard",
        tag: `booking-${bookingId}`,
      });
    } else if (status === "completed") {
      await sendPushToUser(cur.user_id, {
        title: "Pesanan selesai ✨",
        event: "order_completed",
        body: `Pesanan ${cur.code} sudah selesai dikerjakan. Struk dikirim ke emailmu — jangan lupa beri penilaian!`,
        url: "/dashboard",
        tag: `booking-${bookingId}`,
      });
      // push ke teknisi: pekerjaannya diakui & pendapatan dicatat
      if (cur.technician_id) {
        await sendPushToUser(cur.technician_id, {
          title: "Pekerjaan selesai 🎉",
          event: "order_completed",
          body: `Pesanan ${cur.code} ditandai selesai. Terima kasih — komisi dipotong, pendapatan bersih masuk saldo kamu.`,
          url: "/technician",
          tag: `booking-${bookingId}`,
        });
      }
    }
  }

  // struk PDF otomatis ke pelanggan saat pesanan ditandai selesai (fire-and-forget)
  // + potong komisi dari saldo teknisi — keduanya tak pernah menggagalkan update status
  if (status === "completed") {
    sendReceiptForBooking(supabase, bookingId).catch(() => {});
    debitTechnicianCommission(supabase, bookingId)
      .then((r) => {
        if (r && r.ok === false) console.error("Gagal debit komisi:", r.error || JSON.stringify(r));
        else if (r?.skipped) console.error("Debit komisi dilewati:", JSON.stringify(r));
      })
      .catch((e) => console.error("Gagal debit komisi:", e?.message));
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

  // warrantyDays: masa garansi pekerjaan (0 = tanpa garansi). undefined = tidak
  // diubah. Kolomnya ditambahkan migrate-warranty-claims.sql — bila DB belum
  // memilikinya, update diulang TANPA kolom ini supaya perubahan nama/harga
  // tetap tersimpan (pola yang sama dengan confirmBookingPaymentAdmin).
  if (input.warrantyDays !== undefined && input.warrantyDays !== null && input.warrantyDays !== "") {
    const n = parseInt(input.warrantyDays, 10);
    if (Number.isNaN(n) || n < 0 || n > 365) {
      return { error: "Masa garansi harus angka 0–365 hari (0 = tanpa garansi)." };
    }
    patch.warranty_days = n;
  }

  let { data, error } = await supabase
    .from("services")
    .update(patch)
    .eq("id", serviceId)
    .select("*, categories(name)");

  let warrantySkipped = false;
  if (error && patch.warranty_days !== undefined && /warranty_days/.test(error.message || "")) {
    delete patch.warranty_days;
    warrantySkipped = true;
    ({ data, error } = await supabase
      .from("services")
      .update(patch)
      .eq("id", serviceId)
      .select("*, categories(name)"));
  }

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
  return { service: data[0], warrantySkipped };
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

/**
 * Kelola varian layanan (mis. ukuran PK pada AC).
 * Dipakai wizard booking: layanan yang punya varian aktif memaksa pemilihan
 * varian, dan harga final diambil dari varian — bukan dari client.
 */
export async function getServiceOptionsAdmin(serviceId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("service_options")
    .select("*")
    .eq("service_id", serviceId)
    .order("sort_order");
  if (error) return { error: error.message };
  return { options: data || [] };
}

export async function createServiceOptionAdmin(serviceId, input) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const label = (input.label || "").trim();
  const price = Number(input.price);
  if (!label) return { error: "Nama varian wajib diisi (contoh: 1 PK)." };
  if (!Number.isFinite(price) || price < 0) return { error: "Harga tidak valid." };

  // sort_order paling akhir milik layanan itu
  const { data: last } = await supabase
    .from("service_options")
    .select("sort_order")
    .eq("service_id", serviceId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const { data, error } = await supabase
    .from("service_options")
    .insert({
      service_id: serviceId,
      label,
      price,
      duration_estimate: (input.durationEstimate || "").trim() || null,
      is_active: input.isActive !== false,
      sort_order: (last?.[0]?.sort_order ?? 0) + 1,
    })
    .select("*")
    .single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message || "")) {
      return { error: `Varian "${label}" sudah ada untuk layanan ini.` };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/booking"); // wizard langsung menawarkan varian baru
  revalidateTag("services");
  return { option: data };
}

export async function updateServiceOptionAdmin(optionId, input) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const patch = {};
  const label = (input.label || "").trim();
  if (!label) return { error: "Nama varian tidak boleh kosong." };
  patch.label = label;
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) return { error: "Harga tidak valid." };
  patch.price = price;
  patch.duration_estimate = (input.durationEstimate || "").trim() || null;
  if (input.isActive !== undefined) patch.is_active = !!input.isActive;

  const { data, error } = await supabase
    .from("service_options")
    .update(patch)
    .eq("id", optionId)
    .select("*")
    .single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message || "")) {
      return { error: `Varian "${label}" sudah ada untuk layanan ini.` };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/booking");
  revalidateTag("services");
  return { option: data };
}

export async function deleteServiceOptionAdmin(optionId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { error } = await supabase.from("service_options").delete().eq("id", optionId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/booking");
  revalidateTag("services");
  return { ok: true };
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

  // ambil kondisi lama: transisi ke "resolved" (email) + perubahan admin_note (push balasan)
  const { data: before } = await supabase
    .from("reports")
    .select("status, title, admin_note, author_id, bookings(code)")
    .eq("id", reportId)
    .single();

  const cleanNote = (adminNote || "").trim();

  const { error } = await supabase
    .from("reports")
    .update({ status, admin_note: cleanNote || null })
    .eq("id", reportId);
  if (error) return { error: error.message };

  // Push balasan ke pelapor saat admin mengisi/mengubah catatan (web-push + FCM
  // sekaligus via sendPushToUser; event bisa dimatikan pelanggan di pengaturan
  // notifikasi). Fire-and-forget — jangan perlambat simpanan admin.
  if (cleanNote && before?.author_id && cleanNote !== (before.admin_note || "")) {
    sendPushToUser(before.author_id, {
      title: "Balasan laporan admin",
      event: "report_replied",
      body: before.bookings?.code
        ? `Admin membalas laporanmu untuk pesanan ${before.bookings.code}.`
        : `Admin membalas laporanmu${before.title ? ` "${before.title}"` : ""}.`,
      url: "/dashboard",
      tag: `report-${reportId}`,
    }).catch(() => {});
  }

  // Push ke pelapor saat STATUS laporan berubah (open → reviewed → resolved).
  // Terpisah dari notifikasi balasan di atas: status bisa berubah tanpa
  // catatan admin, dan catatan bisa diisi tanpa mengubah status. Push ini
  // sampai ke aplikasi Flutter (FCM) maupun web (web-push). Fire-and-forget.
  if (before?.author_id && status !== before.status) {
    sendPushToUser(before.author_id, {
      title: "Status laporan diperbarui 📄",
      event: "report_status",
      body: reportStatusPushBody(status, before),
      url: "/dashboard",
      tag: `report-status-${reportId}`,
    }).catch(() => {});
  }

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

/** Label status laporan yang ramah (selaras dengan label di aplikasi Flutter). */
const REPORT_STATUS_LABEL = {
  open: "Baru Masuk",
  reviewed: "Sedang Ditinjau",
  resolved: "Selesai",
};

/** Ringkasan singkat perubahan status laporan untuk notifikasi push. */
function reportStatusPushBody(status, before) {
  const label = REPORT_STATUS_LABEL[status] || status;
  const code = before?.bookings?.code;
  const judul = before?.title ? ` "${before.title}"` : "";
  return code
    ? `Laporanmu${judul} untuk pesanan ${code} kini berstatus: ${label}.`
    : `Laporanmu${judul} kini berstatus: ${label}.`;
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
  revalidateTag("technicians"); // daftar publik /teknisi berubah (approve/reject)
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
  revalidateTag("technicians"); // daftar publik /teknisi bisa berubah (promosi/demosi role)
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

/**
 * Cari teknisi on-duty (GPS aktif ≤ 2 jam) terdekat dari titik lokasi (pin)
 * sebuah booking — untuk membantu penugasan manual. RPC security definer
 * khusus admin: mengembalikan id + nama + jarak + kesegaran lokasi;
 * koordinat teknisi TIDAK pernah keluar. Baris kosong = belum ada teknisi
 * ber-GPS di radius, atau booking belum punya pin.
 */
export async function fetchNearestTechniciansAdmin(bookingId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase.rpc("technicians_nearby_booking", {
    p_booking: bookingId,
  });
  if (error) {
    if (/does not exist|not found/i.test(error.message)) {
      return { error: "Migrasi GPS teknisi belum dijalankan di database." };
    }
    return { error: error.message };
  }
  return { technicians: data || [] };
}

/**
 * SATU-KLIK "Tugaskan teknisi terdekat":
 * 1) validasi booking (milik tabel, unassigned) — ambil pin + kategori;
 * 2) ambil teknisi on-duty terdekat (technicians_nearby_booking);
 * 3) pilih kandidat terdekat yang skill-nya cocok (bila data skill ada);
 * 4) assign DENGAN jalur hero yang sama dgn assignTechnicianAdmin —
 *    sehingga email penugasan + push tugas baru tetap terkirim.
 * Tidak mengubah status booking — hanya technician_id.
 */
export async function assignNearestTechnicianAdmin(bookingId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: booking, error: bkErr } = await supabase
    .from("bookings")
    .select("id, code, technician_id, lat, lng, service_id, services(category_id)")
    .eq("id", bookingId)
    .single();
  if (bkErr || !booking) return { error: "Pesanan tidak ditemukan." };
  if (!booking.technician_id && booking.lat == null) {
    return { error: "Pesanan belum punya titik lokasi — gunakan dropdown manual." };
  }
  if (booking.technician_id) {
    return { error: "Pesanan sudah ditugaskan." };
  }

  const { data: near, error: nearErr } = await supabase.rpc(
    "technicians_nearby_booking",
    { p_booking: bookingId }
  );
  if (nearErr) {
    if (/does not exist|not found/i.test(nearErr.message)) {
      return { error: "Migrasi GPS teknisi belum dijalankan di database." };
    }
    return { error: nearErr.message };
  }
  if (!near || near.length === 0) {
    return {
      error:
        "Belum ada teknisi on-duty ber-GPS dalam radius 20 km dari pesanan.",
    };
  }

  const catId = booking.services?.category_id || null;
  // RPC tidak membawa skill — ambil sekali untuk semua kandidat (≤15 id).
  const { data: skillRows } = await supabase
    .from("profiles")
    .select("id, skill")
    .in("id", near.map((t) => t.technician_id));
  const skillOf = new Map((skillRows || []).map((r) => [r.id, r.skill]));

  const chosen =
    // skill cocok dulu; tanpa info kategori = ambil terdekat apa adanya
    (catId && near.find((t) => skillOf.get(t.technician_id) === catId)) ||
    near[0];

  // assign manual + notifikasi (email teknisi/pelanggan) — disalin dari jalur hero
  const res = await assignTechnicianAdmin(bookingId, chosen.technician_id);
  if (res.error) return { error: res.error };
  return {
    ok: true,
    assigned: chosen.technician_id,
    name: chosen.name,
    distance_m: chosen.distance_m,
    skillMatched: catId != null,
  };
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

      // push ke pelanggan: teknisi sudah ditugaskan
      await sendPushToUser(booking.user_id, {
        title: "Teknisi ditugaskan 🛠️",
        event: "technician_assigned",
        body: `${technician.name} akan menangani pesanan ${booking.code} (${booking.services?.name || "layanan"}).`,
        url: "/dashboard",
        tag: `booking-${bookingId}`,
      });
      // push ke teknisi: tugas baru masuk
      await sendPushToUser(technicianId, {
        title: "Tugas baru masuk",
        event: "technician_assigned",
        body: `${booking.code} — ${booking.services?.name || "Layanan"}, ${booking.booking_date} ${booking.booking_time}.`,
        url: "/technician",
        tag: `assign-${bookingId}`,
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

  const payLabelMap = { cod: "Bayar di Tempat (COD)", transfer: "Transfer Bank", qris: "Transfer Bank", virtual_account: "Transfer Bank", e_wallet: "Transfer Bank" };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");

  let totalRevenue = 0;
  let totalCommission = 0;
  const lines = [headers.map(csvEscape).join(";")];

  for (const b of rows) {
    const subtotal = Number(b.subtotal_price) || 0;
    const discount = Number(b.discount_amount) || 0;
    const fee = Number(b.app_fee) || 0;
    const total = Number(b.total_price) || 0;
    // Dasar komisi = total − biaya app — paritas dengan debitTechnicianCommission.
    const split = computeSplit(commissionBase(total), b.technician?.commission_rate ?? undefined);
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

/**
 * CSV laporan potongan BIAYA APLIKASI dari saldo teknisi (tab Saldo Aktif).
 * Satu baris per pesanan selesai yang benar-benar memotong biaya aplikasi,
 * memakai rumus yang sama dengan tab (ledgerCommission/ledgerAppFee) supaya
 * angka di panel & di ekspor tak pernah berbeda. Gaya sama dengan
 * getCompletedBookingsCsvAdmin: pemisah ";" + BOM + baris ringkasan.
 */
export async function getAppFeeReportCsvAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: txs, error } = await supabase
    .from("balance_transactions")
    .select("id, technician_id, booking_id, type, amount, commission_amount, created_at")
    .eq("type", "earning")
    .order("created_at", { ascending: false });

  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message || "")) {
      return { error: "Tabel saldo belum ada — jalankan supabase/migrate-technician-balance.sql dulu." };
    }
    return { error: error.message };
  }

  const rows = (txs || []).filter((t) => ledgerAppFee(t) > 0);
  const profiles = await fetchProfilesByIds(supabase, rows.map((r) => r.technician_id));
  const byId = new Map(profiles.map((p) => [p.id, p]));

  const codeById = new Map();
  const bookingIds = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))];
  for (let i = 0; i < bookingIds.length; i += 150) {
    const { data } = await supabase.from("bookings").select("id, code").in("id", bookingIds.slice(i, i + 150));
    for (const b of data || []) codeById.set(b.id, b.code);
  }

  const headers = ["Waktu", "Kode Pesanan", "Teknisi", "Email Teknisi", "Potongan Saldo", "Komisi", "Biaya Aplikasi"];
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");

  let totalCut = 0;
  let totalCommission = 0;
  let totalAppFee = 0;
  const lines = [headers.map(csvEscape).join(";")];

  for (const r of rows) {
    const commission = ledgerCommission(r);
    const appFee = ledgerAppFee(r);
    const cut = Math.abs(Number(r.amount) || 0);
    totalCut += cut;
    totalCommission += commission;
    totalAppFee += appFee;
    lines.push(
      [
        fmtDate(r.created_at),
        codeById.get(r.booking_id) || "-",
        byId.get(r.technician_id)?.name || "-",
        byId.get(r.technician_id)?.email || "-",
        cut,
        commission,
        appFee,
      ]
        .map(csvEscape)
        .join(";")
    );
  }

  lines.push("");
  lines.push(["Jumlah potongan", rows.length].map(csvEscape).join(";"));
  lines.push(["Total potongan saldo", totalCut].map(csvEscape).join(";"));
  lines.push(["Total komisi", totalCommission].map(csvEscape).join(";"));
  lines.push(["Total biaya aplikasi", totalAppFee].map(csvEscape).join(";"));
  lines.push(["Diekspor", new Date().toLocaleString("id-ID")].map(csvEscape).join(";"));

  const stamp = new Date().toISOString().slice(0, 10);
  return { csv: "\uFEFF" + lines.join("\r\n"), filename: `biaya-aplikasi-${stamp}.csv`, count: rows.length };
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

  // Bucket bukti setor kini PRIVAT (hasil audit) — tukar path ke signed URL.
  const deposits = data || [];
  const withPath = deposits.filter((d) => d.proof_url && !d.proof_url.startsWith("http"));
  if (withPath.length > 0) {
    const results = await Promise.all(
      withPath.map(async (d) => {
        const { data: signed } = await supabase.storage.from("balance-proofs").createSignedUrl(d.proof_url, 3600);
        return [d.id, signed?.signedUrl || null];
      })
    );
    const urlById = Object.fromEntries(results);
    for (const d of withPath) d.proof_url = urlById[d.id] || null;
  }

  return { deposits };
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

/**
 * Ambil baris ledger saldo beserta kolom piutang (`uncovered_amount`).
 *
 * Kolom itu ditambahkan supabase/enforce-full-charge-balance.sql; bila migrasinya
 * belum dijalankan, permintaan dengan kolom tersebut GAGAL dan seluruh laporan
 * akan tampak kosong. Karena itu ada fallback: ambil tanpa kolomnya dan anggap
 * semua potongan tertagih (perilaku laporan lama) — angka piutangnya saja yang
 * belum terpisah, bukan seluruh ringkasan yang hilang.
 */
async function pilihTransaksiSaldo(supabase) {
  const dasar = (kolom) =>
    supabase
      .from("balance_transactions")
      .select(kolom)
      .order("created_at", { ascending: false })
      .limit(5000);
  const lengkap = "id, type, amount, commission_amount, booking_id, uncovered_amount, created_at";
  let hasil = await dasar(lengkap);
  if (hasil.error && /uncovered_amount/.test(hasil.error.message || "")) {
    hasil = await dasar("id, type, amount, commission_amount, booking_id, created_at");
  }
  return hasil;
}

/**
 * Ringkasan keuangan platform untuk admin:
 * - totalBalance   : jumlah saldo aktif semua teknisi (kewajiban platform)
 * - totalTopup     : semua setor disetujui (uang masuk)
 * - totalCommission: komisi platform dari pesanan selesai
 * - totalAppFee    : biaya app per pesanan selesai (|amount| − komisi)
 * - platformRevenue: pendapatan platform riil (komisi + biaya app)
 * - totalWithdrawn : penarikan terkirim (uang keluar)
 * - pendingHold    : dana tertahan di pengajuan penarikan pending
 * - month          : versi bulan berjalan
 */
export async function getFinanceSummaryAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [txRes, wdRes, balRes, bkRes, recRes] = await Promise.all([
    pilihTransaksiSaldo(supabase),
    supabase.from("balance_withdrawals").select("amount, status, created_at").limit(5000),
    supabase.from("profiles").select("id, balance, commission_rate").eq("role", "technician"),
    supabase.from("bookings").select("id, total_price, app_fee, technician_id").eq("status", "completed").limit(5000),
    // Pelunasan piutang (supabase/migrate-piutang-recovery.sql). Bila migrasinya
    // belum dijalankan, laporan tetap terbuka — piutangnya cuma belum terpasang
    // ke setoran yang menutupnya (`migrasiJalan: false`).
    supabase.from("balance_recoveries").select("earning_tx_id, amount, kind, created_at").limit(5000),
  ]);

  if (txRes.error && /relation|does not exist/i.test(txRes.error.message || "")) {
    return { error: "Tabel saldo belum ada — jalankan supabase/migrate-technician-balance.sql dulu." };
  }

  const txs = txRes.data || [];
  const recs = recRes.error ? [] : recRes.data || [];
  const wds = wdRes.data || [];
  const balances = balRes.data || [];
  const selesai = bkRes.error ? [] : bkRes.data || [];

  const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
  const inMonth = (row) => new Date(row.created_at) >= startOfMonth;

  const topups = txs.filter((t) => t.type === "topup");
  const earnings = txs.filter((t) => t.type === "earning");
  const approvedWd = wds.filter((w) => w.status === "approved");
  const pendingWd = wds.filter((w) => w.status === "pending");

  // Potongan tiap baris earning (amount < 0) = komisi + biaya app.
  // Rumusnya SATU SUMBER di src/lib/pricing.js (ledgerCommission/ledgerAppFee)
  // agar laporan ini, tab "Saldo Aktif", dan aplikasi tak pernah berbeda.
  const totalCommission = sum(earnings, ledgerCommission);
  const totalAppFee = sum(earnings, ledgerAppFee);
  const monthEarnings = earnings.filter(inMonth);
  const monthCommission = sum(monthEarnings, ledgerCommission);
  const monthAppFee = sum(monthEarnings, ledgerAppFee);

  // ---- Laporan TIGA KOLOM (kebijakan potongan penuh — docs/balance-rule.md) ----
  // ditagihkan  = komisi + biaya app dari pesanan selesai (bookings)
  // tertagih    = yang benar-benar terpotong dari saldo teknisi (ledger)
  // piutang     = saldo teknisi minus (ditagih lagi saat teknisi menyetor)
  // Identitas: ditagihkan = tertagih + piutang.
  const rateById = new Map(balances.map((b) => [b.id, b.commission_rate]));
  let chargedCommission = 0;
  let chargedAppFee = 0;
  for (const b of selesai) {
    const p = penagihanPesanan({
      totalPrice: b.total_price,
      appFee: b.app_fee,
      rate: rateById.get(b.technician_id) ?? undefined,
    });
    chargedCommission += p.commission;
    chargedAppFee += p.fee;
  }
  const chargedTotal = chargedCommission + chargedAppFee;
  const receivableTechnician = sum(
    balances.filter((b) => Number(b.balance) < 0),
    (b) => Math.abs(Number(b.balance) || 0)
  );
  const technicianCredit = sum(
    balances.filter((b) => Number(b.balance) > 0),
    (b) => Number(b.balance) || 0
  );
  // Potongan dari ledger yang pesanannya sudah tidak ada (data lama dibersihkan)
  // dilaporkan terpisah supaya "ditagihkan − tertagih" tidak dibaca sebagai
  // piutang padahal sumbernya baris yatim.
  const idSelesai = new Set(selesai.map((b) => b.id));
  const yatim = (t) => !t.booking_id || !idSelesai.has(t.booking_id);
  const orphanCollected = sum(earnings.filter(yatim), (t) => Math.abs(Number(t.amount) || 0));

  // ---- Laporan TIGA KOLOM (kebijakan potongan penuh — docs/balance-rule.md) ----
  // ditagihkan        = komisi + biaya app dari pesanan selesai (bookings)
  // tertagih          = bagian potongan yang tertutup saldo prabayar teknisi
  // piutang           = bagian yang tidak tertutup → saldo teknisi minus
  // belum terpotong   = pesanan selesai yang baris potongannya belum ada
  // Identitas: ditagihkan = tertagih + piutang + belum terpotong.
  const ledgerTerpakai = sum(earnings.filter((t) => !yatim(t)), (t) => Math.abs(Number(t.amount) || 0));
  const uncovered = (t) =>
    Math.min(Math.max(0, Number(t.uncovered_amount) || 0), Math.abs(Number(t.amount) || 0));
  const uncoveredEligible = sum(earnings.filter((t) => !yatim(t)), uncovered);
  const uncoveredTotal = sum(earnings, uncovered);
  const coveredTotal = Math.max(0, ledgerTerpakai - uncoveredEligible);
  const belumTerpotong = Math.max(0, chargedTotal - ledgerTerpakai);

  // ---- PEMULIHAN PIUTANG (setoran menutup kekurangan lebih dulu) ----
  // `balance_recoveries` memasangkan setiap setoran dengan baris piutang yang
  // ditutupnya (FIFO), jadi laporan periode berikutnya bisa menunjukkan uang
  // yang benar-benar masuk untuk melunasi piutang — bukan sekadar angka minus
  // di neraca yang menurun.
  const dilunasiPer = new Map();
  for (const r of recs) {
    dilunasiPer.set(r.earning_tx_id, (dilunasiPer.get(r.earning_tx_id) || 0) + (Number(r.amount) || 0));
  }
  // Dipisah menurut JENIS pelunasan: 'setoran' = uang masuk sungguhan,
  // 'penghapusan' = piutang yang dilepas lewat keputusan admin (kerugian
  // platform). Menggabungkannya akan membuat laporan mengaku ada uang masuk
  // padahal utangnya hanya dihapuskan (lihat supabase/migrate-piutang-writeoff.sql).
  const recsSetoran = recs.filter((r) => (r.kind || "setoran") === "setoran");
  const recsHapus = recs.filter((r) => r.kind === "penghapusan");
  const recoveryTotal = sum(recsSetoran, (r) => r.amount);
  const recoveryMonth = sum(recsSetoran.filter(inMonth), (r) => r.amount);
  const writeoffTotal = sum(recsHapus, (r) => r.amount);
  const writeoffMonth = sum(recsHapus.filter(inMonth), (r) => r.amount);
  // Piutang yang MASIH terbuka (belum tertutup setoran) — angka yang benar-benar
  // masih ditagih, berbeda dari piutang tercatat yang sudah sebagian dilunasi.
  const piutangTerbuka = sum(earnings, (t) =>
    piutangTerbukaBaris({ uncovered: uncovered(t), dilunasi: dilunasiPer.get(t.id) || 0 })
  );
  // Keranjang UMUR piutang (0-30 / 31-60 / 61-90 / >90 hari) + bagian yang jatuh
  // tempo: piutang teknisi yang berhenti menua tanpa batas, jadi umurnya harus
  // terlihat di laporan, bukan hanya nominalnya.
  const piutangUmur = keranjangUmurPiutang(
    earnings
      .map((t) => ({
        created_at: t.created_at,
        outstanding: piutangTerbukaBaris({ uncovered: uncovered(t), dilunasi: dilunasiPer.get(t.id) || 0 }),
      }))
      .filter((x) => x.outstanding > 0),
    { hariJatuhTempo: ambangPiutangHari() }
  );

  const summary = {
    totalBalance: sum(balances, (b) => b.balance),
    totalTopup: sum(topups, (t) => t.amount),
    totalCommission,
    totalAppFee,
    platformRevenue: totalCommission + totalAppFee,
    totalWithdrawn: sum(approvedWd, (w) => w.amount),
    pendingHold: sum(pendingWd, (w) => w.amount),
    techCount: balances.length,
    // Laporan tiga kolom
    charged: { commission: chargedCommission, appFee: chargedAppFee, total: chargedTotal, orders: selesai.length },
    collected: {
      total: coveredTotal,
      ledgerCharged: ledgerTerpakai,
      commission: totalCommission,
      appFee: totalAppFee,
    },
    receivable: {
      /** seluruh piutang yang tercatat di ledger (semua periode) */
      uncoveredTotal,
      /** piutang dari pesanan yang selesai bulan ini saja */
      periode: sum(monthEarnings, uncovered),
      /** piutang pada neraca: saldo teknisi minus saat ini */
      saldoMinus: receivableTechnician,
      /** pesanan selesai yang baris potongannya belum ada (belum ditagih sama sekali) */
      belumTerpotong,
      /** potongan dari baris ledger yang pesanannya sudah dihapus (data lama) */
      orphanCollected,
      /** cek identitas: tertagih + piutang + belum terpotong */
      identitas: coveredTotal + uncoveredEligible + belumTerpotong,
    },
    /** Umur piutang terbuka: keranjang + jatuh tempo (lihat docs/balance-rule.md) */
    piutangUmur,
    // Pemulihan piutang: setoran yang menutup kekurangan (lihat
    // supabase/migrate-piutang-recovery.sql + docs/balance-rule.md).
    recovery: {
      /** pelunasan tercatat dari setoran (semua periode) */
      total: recoveryTotal,
      /** pelunasan pada bulan berjalan — kolom "pemulihan piutang" laporan */
      periode: recoveryMonth,
      /** piutang yang masih terbuka (belum tertutup setoran) */
      terbuka: piutangTerbuka,
      /** piutang tercatat di ledger (semua baris 'earning') */
      ledgerTercatat: uncoveredTotal,
      /** piutang yang DIHAPUSKAN (write-off) — kerugian, bukan uang masuk */
      writeoffTotal,
      /** penghapusan pada bulan berjalan */
      writeoffPeriode: writeoffMonth,
      /** cek identitas: piutang tercatat = masih terbuka + dilunasi setoran + dihapuskan */
      identitas: piutangTerbuka + recoveryTotal + writeoffTotal,
      /** false = migrasi pelunasan belum dijalankan (angka pemulihan = 0) */
      migrasiJalan: !recRes.error,
    },
    technicianCredit,
    technicianDebt: receivableTechnician,
    month: {
      topup: sum(topups.filter(inMonth), (t) => t.amount),
      commission: monthCommission,
      appFee: monthAppFee,
      platformRevenue: monthCommission + monthAppFee,
      withdrawn: sum(approvedWd.filter(inMonth), (w) => w.amount),
    },
  };

  return { summary };
}

/* ========================= VERIFIKASI KTP PENDAFTAR ========================= */

/**
 * Buat signed URL (berlaku 30 menit) untuk foto KTP pendaftar teknisi.
 * Bucket ktp-documents PRIVAT — hanya admin yang boleh membaca via action ini.
 */
/**
 * Saldo aktif per teknisi: balance + commission_rate + agregat transaksi
 * (total setor, total komisi terpotong, penarikan disetujui/pending).
 * Dipakai tab "Saldo Aktif" di panel admin.
 */
/**
 * Admin mengirim pengingat setor ke teknisi bersaldo 0/minus (komisi
 * melebihi setoran). Push (web + FCM) + email; fire-and-forget, tak melempar.
 */
export async function remindTechnicianBalanceAdmin(technicianId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: tech } = await supabase
    .from("profiles")
    .select("id, name, email, balance, role")
    .eq("id", technicianId)
    .maybeSingle();
  if (!tech || tech.role !== "technician") return { error: "Teknisi tidak ditemukan." };

  const saldo = Number(tech.balance || 0);

  // Penanda agar APLIKASI teknisi menampilkan banner "Admin mengingatkan setor"
  // (kolom dari supabase/migrate-balance-reminder.sql). Best-effort: bila kolom
  // belum ada, push & email tetap dikirim.
  const { error: stampErr } = await supabase
    .from("profiles")
    .update({ balance_reminder_at: new Date().toISOString() })
    .eq("id", technicianId);
  if (stampErr && !/column .* does not exist|schema cache/i.test(stampErr.message || "")) {
    console.error("Gagal menyimpan penanda pengingat saldo:", stampErr.message);
  }

  await sendPushToUser(tech.id, {
    title: "Saldo kamu perlu ditindak",
    body:
      saldo < 0
        ? "Saldo teknisimu minus. Ajukan setor untuk menutup komisi."
        : "Saldo aktifmu kosong. Ajukan setor untuk melanjutkan pekerjaan.",
    url: "/technician",
    event: "balance_reminder",
  });
  if (tech.email) {
    await sendTechnicianBalanceReminderEmail(tech.email, { name: tech.name, balance: saldo });
  }

  revalidatePath("/admin");
  return { ok: true };
}

/* ===================== UMUR PIUTANG & PENGHAPUSAN ===================== */

/**
 * Ringkasan umur piutang + daftar pengajuan penghapusan untuk panel admin.
 * Dipakai tab Saldo Aktif (keranjang umur 0-30/31-60/61-90/>90 + tindakan).
 */
export async function getPiutangUmurAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { perTeknisi, error, pelunasanTerbaca } = await bacaPiutangTerbuka(supabase);
  if (error) return { error };

  const ids = [...perTeknisi.keys()];
  const { data: profs } = ids.length
    ? await supabase.from("profiles").select("id, name, email, approval_status").in("id", ids)
    : { data: [] };
  const info = new Map((profs || []).map((p) => [p.id, p]));

  const semuaItem = [];
  const teknisi = ids
    .map((id) => {
      const v = perTeknisi.get(id);
      const p = info.get(id);
      semuaItem.push(...v.items);
      return {
        id,
        nama: p?.name || p?.email || String(id).slice(0, 8),
        email: p?.email || null,
        approval_status: p?.approval_status || null,
        masihAktif: p?.approval_status === "approved",
        total: v.umur.total,
        tertua: v.umur.tertua,
        baris: v.umur.baris,
        buckets: v.umur.buckets,
        jatuhTempo: v.umur.jatuhTempo,
        items: v.items,
      };
    })
    .sort((a, b) => b.tertua - a.tertua);

  const { data: writeoffs, error: woErr } = await supabase
    .from("piutang_writeoffs")
    .select(
      "id, technician_id, amount, reason, status, oldest_days, technician_active, requested_by, requested_at, decided_by, decided_at, decision_note"
    )
    .order("requested_at", { ascending: false })
    .limit(200);

  return {
    umur: keranjangUmurPiutang(semuaItem, { hariJatuhTempo: ambangPiutangHari() }),
    teknisi,
    writeoffs: writeoffs || [],
    writeoffsError: woErr
      ? /relation|does not exist/i.test(woErr.message || "")
        ? "Tabel penghapusan belum ada — jalankan supabase/migrate-piutang-writeoff.sql dulu."
        : woErr.message
      : null,
    pelunasanTerbaca,
    ambangHari: ambangPiutangHari(),
  };
}

/**
 * Ajukan penghapusan piutang seorang teknisi (mis. teknisi sudah berhenti).
 *
 * Penghapusan TIDAK langsung jalan: pengajuan ini menunggu PERSETUJUAN admin
 * (decidePiutangWriteoffAdmin) dan alasan wajib diisi — inilah yang membedakan
 * penghapusan sah dari clamp lama yang menghapus piutang tanpa jejak.
 */
export async function requestPiutangWriteoffAdmin(technicianId, reason) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const clean = (reason || "").trim();
  if (clean.length < 10) {
    return { error: "Tulis alasan penghapusan (minimal 10 karakter) — alasan ini menjadi jejak audit." };
  }
  if (!technicianId) return { error: "Teknisi tidak dikenal." };

  const { perTeknisi, error } = await bacaPiutangTerbuka(supabase);
  if (error) return { error };
  const v = perTeknisi.get(technicianId);
  if (!v || v.umur.total <= 0) return { error: "Teknisi ini tidak punya piutang terbuka untuk dihapuskan." };

  const { data: pending } = await supabase
    .from("piutang_writeoffs")
    .select("id")
    .eq("technician_id", technicianId)
    .eq("status", "pending")
    .maybeSingle();
  if (pending) return { error: "Sudah ada pengajuan penghapusan yang menunggu persetujuan." };

  const { data: prof } = await supabase
    .from("profiles")
    .select("name, approval_status")
    .eq("id", technicianId)
    .maybeSingle();
  const masihAktif = prof?.approval_status === "approved";

  const { error: insErr } = await supabase.from("piutang_writeoffs").insert({
    technician_id: technicianId,
    amount: v.umur.total,
    reason: clean,
    oldest_days: v.umur.tertua,
    technician_active: masihAktif,
    requested_by: admin.id,
  });
  if (insErr) {
    if (/relation|does not exist/i.test(insErr.message || "")) {
      return { error: "Tabel penghapusan belum ada — jalankan supabase/migrate-piutang-writeoff.sql dulu." };
    }
    if (/duplicate key|unique/i.test(insErr.message || "")) {
      return { error: "Sudah ada pengajuan penghapusan yang menunggu persetujuan." };
    }
    return { error: insErr.message };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    amount: v.umur.total,
    oldest_days: v.umur.tertua,
    masihAktif,
    nama: prof?.name || null,
  };
}

/**
 * Putuskan pengajuan penghapusan piutang: SETUJU atau TOLAK.
 *
 * Yang setuju dijalankan sebagai SATU transaksi di database
 * (public.approve_piutang_writeoff): mencatat pelunasan jenis 'penghapusan' untuk
 * tiap baris piutang, menulis baris penyesuaian, dan menaikkan saldo — mustahil
 * setengah jalan sehingga invarian "saldo = Σ mutasi" tetap utuh.
 */
export async function decidePiutangWriteoffAdmin(writeoffId, approve, note) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };
  if (!writeoffId) return { error: "Pengajuan tidak dikenal." };

  const clean = (note || "").trim();
  if (!approve && clean.length < 5) {
    return { error: "Tulis alasan penolakan (minimal 5 karakter)." };
  }

  const { data: w, error: readErr } = await supabase
    .from("piutang_writeoffs")
    .select("id, technician_id, amount, status, reason")
    .eq("id", writeoffId)
    .maybeSingle();
  if (readErr) {
    return {
      error: /relation|does not exist/i.test(readErr.message || "")
        ? "Tabel penghapusan belum ada — jalankan supabase/migrate-piutang-writeoff.sql dulu."
        : readErr.message,
    };
  }
  if (!w) return { error: "Pengajuan penghapusan tidak ditemukan." };
  if (w.status !== "pending") return { error: "Pengajuan ini sudah diputuskan sebelumnya." };

  if (!approve) {
    const { error } = await supabase
      .from("piutang_writeoffs")
      .update({
        status: "rejected",
        decided_by: admin.id,
        decided_at: new Date().toISOString(),
        decision_note: clean,
      })
      .eq("id", writeoffId)
      .eq("status", "pending");
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true, status: "rejected" };
  }

  const { data, error } = await supabase.rpc("approve_piutang_writeoff", {
    p_writeoff: writeoffId,
    p_note: clean || null,
  });
  if (error) {
    return {
      error: /function|does not exist|schema cache/i.test(error.message || "")
        ? "Fungsi persetujuan belum ada — jalankan supabase/migrate-piutang-writeoff.sql dulu."
        : error.message,
    };
  }
  if (!data?.ok) return { error: data?.error || "Gagal menghapuskan piutang." };

  revalidatePath("/admin");
  revalidatePath("/technician");
  return { ok: true, status: "approved", ...data };
}

export async function getTechnicianBalancesAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const [techRes, txRes, wdRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, name, email, phone, balance, commission_rate, approval_status")
      .eq("role", "technician")
      .order("name", { ascending: true }),
    supabase
      .from("balance_transactions")
      .select("id, technician_id, type, amount, commission_amount, booking_id, created_at"),
    supabase.from("balance_withdrawals").select("technician_id, amount, status"),
  ]);

  if (techRes.error && /relation|does not exist|column/i.test(techRes.error.message || "")) {
    return { error: "Kolom/tabel saldo belum ada — jalankan supabase/migrate-technician-balance.sql dulu." };
  }

  const techs = techRes.data || [];
  const txs = txRes.error ? [] : txRes.data || [];
  const wds = wdRes.error ? [] : wdRes.data || [];

  // Piutang + umurnya per teknisi, dan pengajuan penghapusan yang menunggu
  // persetujuan (keduanya tampil di kolom tindakan tab Saldo Aktif).
  const { perTeknisi: piutangPer, error: piutangErr } = await bacaPiutangTerbuka(supabase);
  const { data: writeoffs } = await supabase
    .from("piutang_writeoffs")
    .select("id, technician_id, amount, status, oldest_days, reason, requested_at")
    .order("requested_at", { ascending: false })
    .limit(200);
  const pendingWriteoff = new Map(
    (writeoffs || []).filter((w) => w.status === "pending").map((w) => [w.technician_id, w])
  );

  const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
  const technicians = techs.map((t) => {
    const myTx = txs.filter((x) => x.technician_id === t.id);
    const myWd = wds.filter((x) => x.technician_id === t.id);
    const earning = myTx.filter((x) => x.type === "earning");
    const topup = sum(myTx.filter((x) => x.type === "topup"), (x) => x.amount);
    // Komisi & biaya app dipisah dengan rumus bersama (src/lib/pricing.js):
    // satu baris earning = |amount| = komisi + biaya app.
    const commission = sum(earning, ledgerCommission);
    const appFee = sum(earning, ledgerAppFee);
    const wdApproved = sum(myWd.filter((x) => x.status === "approved"), (x) => x.amount);
    const wdPending = sum(myWd.filter((x) => x.status === "pending"), (x) => x.amount);
    return {
      ...t,
      total_topup: topup,
      total_commission: commission,
      total_app_fee: appFee,
      total_withdrawn: wdApproved,
      pending_withdraw: wdPending,
      available: Number(t.balance || 0) - wdPending,
      // Umur piutang terbuka (0-30/31-60/61-90/>90 hari) — dasar keputusan
      // penghapusan untuk teknisi yang berhenti.
      piutang_terbuka: piutangPer.get(t.id)?.umur.total ?? 0,
      piutang_tertua: piutangPer.get(t.id)?.umur.tertua ?? 0,
      piutang_jatuh_tempo: piutangPer.get(t.id)?.umur.jatuhTempo.total ?? 0,
      piutang_buckets: piutangPer.get(t.id)?.umur.buckets ?? { h0_30: 0, h31_60: 0, h61_90: 0, hLebih90: 0 },
      writeoff_pending: pendingWriteoff.get(t.id) || null,
    };
  });

  // Laporan potongan biaya aplikasi: satu baris per pesanan selesai yang
  // benar-benar memotong biaya app dari saldo teknisi (terbaru lebih dulu).
  // Ditampilkan di dalam tab "Saldo Aktif" agar terkonsolidasi dengan komisi.
  const REPORT_LIMIT = 200;
  const feeRows = txs
    .filter((x) => x.type === "earning" && ledgerAppFee(x) > 0)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const shown = feeRows.slice(0, REPORT_LIMIT);

  const nameById = new Map(technicians.map((t) => [t.id, t.name || t.email || "-"]));
  let codeById = new Map();
  const bookingIds = [...new Set(shown.map((r) => r.booking_id).filter(Boolean))];
  if (bookingIds.length) {
    const { data: bks } = await supabase.from("bookings").select("id, code").in("id", bookingIds);
    codeById = new Map((bks || []).map((b) => [b.id, b.code]));
  }

  const appFeeReport = shown.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    technician_id: r.technician_id,
    technician_name: nameById.get(r.technician_id) || "-",
    booking_code: codeById.get(r.booking_id) || null,
    app_fee: ledgerAppFee(r),
    total_cut: Math.abs(Number(r.amount) || 0),
  }));

  const summary = {
    totalBalance: sum(technicians, (t) => t.balance),
    totalAvailable: sum(technicians, (t) => t.available),
    totalCommission: sum(technicians, (t) => t.total_commission),
    totalAppFee: sum(technicians, (t) => t.total_app_fee),
    totalTopup: sum(technicians, (t) => t.total_topup),
    pendingHold: sum(technicians, (t) => t.pending_withdraw),
    count: technicians.length,
  };

  return {
    technicians,
    piutangUmur: keranjangUmurPiutang(
      [...piutangPer.values()].flatMap((v) => v.items),
      { hariJatuhTempo: ambangPiutangHari() }
    ),
    piutangError: piutangErr || null,
    ambangHari: ambangPiutangHari(),
    appFeeReport,
    appFeeReportTotal: {
      count: feeRows.length,        // seluruh baris (bukan hanya yang ditampilkan)
      shown: appFeeReport.length,
      amount: sum(feeRows, ledgerAppFee),
      limit: REPORT_LIMIT,
    },
    summary,
  };
}

/* ========================== PENILAIAN TEKNISI ========================== */

/** Ambil baris `profiles` untuk sekumpulan id (dipecah agar URL tetap pendek). */
async function fetchProfilesByIds(supabase, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += 150) {
    const { data } = await supabase.from("profiles").select("id, name, email").in("id", unique.slice(i, i + 150));
    if (data) out.push(...data);
  }
  return out;
}

/**
 * Daftar penilaian teknisi untuk panel admin.
 *
 * Yang dicari admin: SIAPA yang menilai (nama pengguna), teknisi yang dinilai,
 * bintang, isi ulasan, pesanan terkait, dan kapan dinilai — plus ringkasan
 * (jumlah, rata-rata, sebaran bintang) dan rekap per teknisi.
 *
 * Join profil dilakukan manual (bukan embed FK) supaya tetap jalan walau
 * tabel reviews dibuat lewat Table Editor dengan nama constraint berbeda.
 */
export async function getAllReviewsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: revs, error } = await supabase
    .from("reviews")
    .select("id, booking_id, user_id, technician_id, rating, comment, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message || "")) {
      return { error: "Tabel reviews belum ada — jalankan supabase/migrate-reviews.sql dulu." };
    }
    return { error: error.message };
  }

  const rows = revs || [];
  const profiles = await fetchProfilesByIds(supabase, rows.flatMap((r) => [r.user_id, r.technician_id]));
  const byId = new Map(profiles.map((p) => [p.id, p]));

  const codeById = new Map();
  const bookingIds = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))];
  for (let i = 0; i < bookingIds.length; i += 150) {
    const { data } = await supabase.from("bookings").select("id, code").in("id", bookingIds.slice(i, i + 150));
    for (const b of data || []) codeById.set(b.id, b.code);
  }

  const reviews = rows.map((r) => ({
    id: r.id,
    rating: Number(r.rating) || 0,
    comment: r.comment || null,
    created_at: r.created_at,
    booking_id: r.booking_id,
    booking_code: codeById.get(r.booking_id) || null,
    user_id: r.user_id,
    user_name: byId.get(r.user_id)?.name || null,
    user_email: byId.get(r.user_id)?.email || null,
    technician_id: r.technician_id,
    technician_name: byId.get(r.technician_id)?.name || null,
    technician_email: byId.get(r.technician_id)?.email || null,
  }));

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) distribution[r.rating] += 1;
    sum += r.rating;
  }

  const byTechMap = new Map();
  for (const r of reviews) {
    const e =
      byTechMap.get(r.technician_id) ||
      { technician_id: r.technician_id, name: r.technician_name || "-", count: 0, sum: 0, low: 0, lastAt: null };
    e.count += 1;
    e.sum += r.rating;
    if (r.rating <= 2) e.low += 1;
    if (!e.lastAt || new Date(r.created_at) > new Date(e.lastAt)) e.lastAt = r.created_at;
    byTechMap.set(r.technician_id, e);
  }
  const byTechnician = [...byTechMap.values()]
    .map((e) => ({ technician_id: e.technician_id, name: e.name, count: e.count, avg: e.sum / e.count, low: e.low, lastAt: e.lastAt }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));

  return {
    reviews,
    byTechnician,
    summary: {
      count: reviews.length,
      avg: reviews.length ? sum / reviews.length : 0,
      distribution,
      withComment: reviews.filter((r) => (r.comment || "").trim().length > 0).length,
      lowRatings: reviews.filter((r) => r.rating <= 2).length,
    },
  };
}

export async function getKtpSignedUrlAdmin(path) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };
  if (!path || typeof path !== "string" || path.includes("..")) {
    return { error: "Path KTP tidak valid." };
  }

  const { data, error } = await supabase.storage
    .from("ktp-documents")
    .createSignedUrl(path, 30 * 60);
  if (error) {
    if (/not found|does not exist/i.test(error.message || "")) {
      return { error: "Bucket ktp-documents belum ada — jalankan supabase/migrate-technician-ktp.sql." };
    }
    return { error: error.message };
  }
  return { url: data.signedUrl };
}

/* ========================= BANNER PROMOSI ========================= */

/**
 * Tambah banner promosi baru (tab Banner panel admin).
 * imagePath = path di bucket publik `banners` (hasil BannerImageUpload).
 * targetTab: tab app yang dibuka saat banner ditap (0/1/2/3, null = tanpa aksi).
 */
export async function createBannerAdmin(input) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const title = (input.title || "").trim();
  const imagePath = (input.imagePath || "").trim();
  if (!title) return { error: "Judul banner wajib diisi." };
  if (!imagePath) return { error: "Gambar banner wajib diunggah." };

  const targetTab = input.targetTab === null || input.targetTab === "" ? null : Number(input.targetTab);
  if (targetTab !== null && (!Number.isInteger(targetTab) || targetTab < 0 || targetTab > 4)) {
    return { error: "Tab tujuan tidak valid." };
  }

  const { data: last } = await supabase.from("banners").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const sortOrder = (last?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("banners")
    .insert({
      title,
      description: (input.description || "").trim() || null,
      image_path: imagePath,
      target_tab: targetTab,
      is_active: input.isActive !== false,
      sort_order: sortOrder,
    })
    .select()
    .single();
  if (error) {
    if (/row-level security/i.test(error.message || "")) {
      return { error: "Database menolak (RLS) — jalankan supabase/migrate-banners.sql dulu." };
    }
    if (/does not exist|schema/i.test(error.message || "")) {
      return { error: "Tabel banners belum ada — jalankan supabase/migrate-banners.sql di SQL Editor." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return { banner: data };
}

/** Toggle aktif/nonaktif banner. */
export async function toggleBannerAdmin(bannerId, isActive) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { error } = await supabase.from("banners").update({ is_active: !!isActive }).eq("id", bannerId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}

/** Hapus banner (row + file gambarnya di storage; file gagal hapus tidak fatal). */
export async function deleteBannerAdmin(bannerId) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: banner } = await supabase.from("banners").select("image_path").eq("id", bannerId).single();

  const { error } = await supabase.from("banners").delete().eq("id", bannerId);
  if (error) return { error: error.message };

  if (banner?.image_path && !/^https?:\/\//.test(banner.image_path)) {
    const { error: rmErr } = await supabase.storage.from("banners").remove([banner.image_path]);
    if (rmErr) console.error("Gagal hapus file banner:", rmErr.message);
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}

/** Daftar semua banner (termasuk nonaktif) untuk tab Banner panel admin. */
export async function getAllBannersAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("banners")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) {
    if (/does not exist/i.test(error.message || "")) return { banners: [] }; // migrasi belum jalan
    return { error: error.message };
  }
  return { banners: data || [] };
}

/* ========================= PENGATURAN REKENING TRANSFER ========================= */

/**
 * Rekening transfer resmi (tabel app_settings, diisi supabase/migrate-transfer-settings.sql).
 * Dibaca oleh wizard booking web & aplikasi Flutter via RLS "authenticated can read".
 */
export async function getPaymentSettingsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("app_settings")
    .select("transfer_bank_name, transfer_account_number, transfer_account_name")
    .eq("id", 1)
    .maybeSingle();
  if (error && /relation|does not exist|Could not find the table|schema cache/i.test(error.message || "")) {
    return { error: "Tabel app_settings belum ada — jalankan supabase/migrate-transfer-settings.sql di SQL Editor dulu." };
  }
  if (error) return { error: error.message };
  return {
    bank: (data?.transfer_bank_name || "").trim(),
    number: (data?.transfer_account_number || "").trim(),
    name: (data?.transfer_account_name || "").trim(),
  };
}

/** Simpan rekening transfer (dipanggil tab "Rekening Transfer" panel admin). */
export async function savePaymentSettingsAdmin({ bank, number, name }) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };
  if (!bank?.trim() || !number?.trim()) {
    return { error: "Nama bank dan nomor rekening wajib diisi." };
  }

  const { error } = await supabase
    .from("app_settings")
    .update({
      transfer_bank_name: bank.trim(),
      transfer_account_number: number.trim(),
      transfer_account_name: (name || "").trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) {
    if (/relation|does not exist|Could not find the table|schema cache/i.test(error.message || "")) {
      return { error: "Tabel app_settings belum ada — jalankan supabase/migrate-transfer-settings.sql di SQL Editor dulu." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  return { ok: true };
}

/* ========================= PENGATURAN GARANSI ========================= */

/**
 * Setelan garansi pekerjaan (tabel app_settings; kolomnya ditambahkan
 * supabase/migrate-warranty-settings.sql).
 *
 * Dua nilai: `enabled` (saklar utama) dan `days` (durasi standar). Durasi
 * EFEKTIF tiap pesanan dihitung di DATABASE lewat public.warranty_days_efektif():
 * saklar mati → 0, layanan yang ditandai tanpa garansi
 * (services.warranty_days = 0) → 0, selain itu durasi standar. Jadi satu
 * setelan di sini berlaku untuk seluruh katalog — angka per layanan tidak lagi
 * menentukan panjang garansi, hanya menandai pengecualian.
 */
export async function getWarrantySettingsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("app_settings")
    .select("warranty_enabled, warranty_days")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (/relation|does not exist|Could not find the table|schema cache|column/i.test(error.message || "")) {
      return {
        error:
          "Setelan garansi belum ada — jalankan supabase/migrate-warranty-settings.sql di Supabase SQL Editor dulu.",
      };
    }
    return { error: error.message };
  }

  // Bawaan saat kolomnya masih kosong = nilai bawaan migrasi (aktif, 7 hari),
  // supaya tab tetap terbuka dan menunjukkan keadaan yang sebenarnya berlaku.
  return {
    enabled: data?.warranty_enabled ?? true,
    days: Number(data?.warranty_days ?? 7),
  };
}

/**
 * Simpan setelan garansi (dipanggil kartu pengaturan di tab "Garansi").
 *
 * Saat garansi AKTIF, durasi wajib 1–365 hari: "aktif tapi 0 hari" adalah
 * keadaan yang membingungkan — saklarnya menyala tetapi tidak ada garansi.
 * Untuk meniadakan garansi, matikan saklarnya; durasinya tetap tersimpan
 * supaya bisa dinyalakan lagi dengan nilai yang sama.
 *
 * Mematikan garansi TIDAK membatalkan klaim yang sudah diajukan maupun
 * kunjungan ulang yang sudah dijadwalkan — lihat migrate-warranty-settings.sql.
 */
export async function saveWarrantySettingsAdmin({ enabled, days } = {}) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const aktif = !!enabled;
  const n = Number.parseInt(days, 10);
  if (Number.isNaN(n) || n < 0 || n > 365) {
    return { error: "Durasi garansi harus angka 0–365 hari." };
  }
  if (aktif && n === 0) {
    return {
      error:
        "Durasi garansi minimal 1 hari saat garansi aktif. Matikan saklar garansi untuk meniadakannya.",
    };
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ warranty_enabled: aktif, warranty_days: n, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) {
    if (/relation|does not exist|Could not find the table|schema cache|column/i.test(error.message || "")) {
      return {
        error:
          "Setelan garansi belum ada — jalankan supabase/migrate-warranty-settings.sql di Supabase SQL Editor dulu.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/admin");
  return { ok: true, enabled: aktif, days: n };
}

/* ============== JEJAK EMAIL ADMIN YANG GAGAL TERKIRIM ============== */

/** Pesan galat RPC antrean; menyebut berkas migrasinya bila fungsinya belum ada. */
function pesanGagalAntrean(error) {
  if (/function|does not exist|schema cache|column/i.test(error?.message || "")) {
    return "Jejak kegagalan email belum aktif — jalankan supabase/migrate-admin-email-failures.sql di Supabase SQL Editor.";
  }
  return error?.message || "Gagal mengakses antrean email.";
}

/** Klien service role untuk antrean email; mengembalikan pesan galat bila tidak ada. */
function klienAntreanEmail() {
  try {
    return { db: createAdminClient() };
  } catch {
    // Tanpa kunci service role, RLS menutup tabel antrean — katakan sebabnya,
    // jangan tampilkan daftar kosong yang terlihat seperti "semua aman".
    return { error: "Kunci service role tidak terbaca di server ini, jadi jejak antrean email tidak bisa dibaca." };
  }
}

/**
 * Email admin yang gagal dikirim (kartu "Email yang gagal terkirim" di tab
 * "Notif Email Admin").
 *
 * Dibaca memakai KUNCI SERVICE ROLE karena RLS `admin_email_outbox` memang
 * menutup tabel itu dari semua klien — termasuk admin; yang boleh melihat
 * jejaknya hanya server yang sudah memastikan pemanggilnya admin (requireAdmin).
 *
 * Yang dikembalikan: baris yang punya alasan kegagalan atau sudah menyerah
 * (failed_at terisi), plus jumlah baris yang masih menunggu dikirim supaya
 * "gagal" tidak tertukar dengan "sedang dalam antrean".
 */
export async function getAdminEmailFailuresAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { db, error: klienErr } = klienAntreanEmail();
  if (klienErr) return { error: klienErr };

  const { data, error } = await db
    .from("admin_email_outbox")
    .select("id,event,ref_id,attempts,max_attempts,last_error,last_attempt_at,failed_at,created_at")
    .or("failed_at.not.is.null,last_error.not.is.null")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    if (/column|does not exist|schema cache/i.test(error.message || "")) {
      return {
        rows: [],
        warning:
          "Jejak kegagalan email belum aktif — jalankan supabase/migrate-admin-email-failures.sql di Supabase SQL Editor. " +
          "Sebelum itu, email yang gagal hanya tercatat di log server dan barisnya hilang setelah lima percobaan.",
      };
    }
    return { error: error.message };
  }

  const { count } = await db
    .from("admin_email_outbox")
    .select("id", { count: "exact", head: true })
    .is("failed_at", null);

  return { rows: data || [], antrean: count ?? null };
}

/**
 * Kembalikan satu email yang gagal ke antrean — dipakai setelah penyebabnya
 * diperbaiki (kunci Resend diganti, domain diverifikasi, penerima dinyalakan).
 * `last_error` sengaja tidak dihapus supaya alasan terakhir tetap terbaca.
 */
export async function retryAdminEmailAdmin(id) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };
  if (!id) return { error: "Baris antrean tidak dikenal." };

  const { db, error: klienErr } = klienAntreanEmail();
  if (klienErr) return { error: klienErr };

  const { error } = await db.rpc("retry_admin_email", { p_id: id });
  if (error) return { error: pesanGagalAntrean(error) };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Buang satu baris jejak: kiriman ini memang tidak perlu lagi (mis. peristiwa
 * untuk data uji yang sudah dihapus). Berbeda dari "coba lagi", ia menghapus
 * barisnya — jadi tombolnya diberi nama tegas di panel.
 */
export async function discardAdminEmailAdmin(id) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };
  if (!id) return { error: "Baris antrean tidak dikenal." };

  const { db, error: klienErr } = klienAntreanEmail();
  if (klienErr) return { error: klienErr };

  const { error } = await db.rpc("complete_admin_email", { p_id: id });
  if (error) return { error: pesanGagalAntrean(error) };

  revalidatePath("/admin");
  return { ok: true };
}

/* ================== PENERIMA NOTIFIKASI EMAIL ADMIN ================== */

/**
 * Setelan penerima email per peristiwa (tab "Notif Email Admin").
 *
 * Tabel `admin_notification_optouts` hanya menyimpan pasangan (admin, peristiwa)
 * yang DIMATIKAN — tanpa baris berarti admin menerima peristiwa itu. Jadi admin
 * baru & peristiwa baru otomatis menerima notifikasi (perilaku lama) sampai ada
 * yang mematikannya. RPC admin_emails_for_event() di database memakai aturan
 * yang sama, sehingga jalur web & jalur antrean tidak bisa berbeda.
 *
 * Tabel belum ada (migrasi belum dijalankan) → tetap kembalikan daftar admin
 * dengan `warning`, bukan error, supaya tab bisa dibuka dan menjelaskan caranya.
 */
export async function getAdminNotificationSettingsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: adminRows, error: adminsErr } = await supabase
    .from("profiles")
    .select("id, name, email")
    .eq("role", "admin")
    .order("name", { ascending: true });
  if (adminsErr) return { error: adminsErr.message };

  const admins = (adminRows || []).map((a) => ({
    id: a.id,
    name: a.name || "-",
    email: (a.email || "").trim(),
  }));

  // select GET (bukan { head: true }) supaya tabel-tidak-ada benar-benar error.
  const { data: rows, error: tableErr } = await supabase
    .from("admin_notification_optouts")
    .select("admin_id, event");
  if (tableErr) {
    return {
      admins,
      events: ADMIN_NOTIFY_EVENTS,
      optouts: [],
      warning:
        "Tabel pengaturan belum ada — saat ini SEMUA admin menerima SEMUA email. Jalankan " +
        "supabase/migrate-admin-notification-prefs.sql di Supabase SQL Editor untuk mengaktifkan pengaturan ini.",
    };
  }

  return {
    admins,
    events: ADMIN_NOTIFY_EVENTS,
    optouts: (rows || []).map((r) => ({ adminId: r.admin_id, event: r.event })),
  };
}

/**
 * Simpan setelan penerima: menerima daftar pasangan (admin, peristiwa) yang
 * DIMATIKAN, lalu mengganti seluruh isi tabel untuk admin yang tampil di panel.
 * Hanya id admin asli & kunci peristiwa yang dikenal yang diterima (validasi
 * server-side), jadi klien tidak bisa menyisipkan baris sembarangan.
 */
export async function saveAdminNotificationSettingsAdmin({ optouts } = {}) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data: adminRows, error: adminsErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin");
  if (adminsErr) return { error: adminsErr.message };
  const adminIds = (adminRows || []).map((r) => r.id);
  const validIds = new Set(adminIds);

  const wanted = [];
  const seen = new Set();
  for (const o of Array.isArray(optouts) ? optouts : []) {
    const adminId = String(o?.adminId || "");
    const event = String(o?.event || "");
    if (!validIds.has(adminId) || !ADMIN_NOTIFY_EVENT_KEYS.includes(event)) continue;
    const dedupe = `${adminId}:${event}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    wanted.push({ admin_id: adminId, event });
  }

  // Deteksi migrasi belum jalan SEBELUM menghapus apa pun.
  const { error: tableErr } = await supabase
    .from("admin_notification_optouts")
    .select("admin_id")
    .limit(1);
  if (tableErr) {
    return {
      error:
        "Tabel pengaturan belum ada — jalankan supabase/migrate-admin-notification-prefs.sql di Supabase SQL Editor dulu.",
    };
  }

  if (adminIds.length > 0) {
    const { error: delErr } = await supabase
      .from("admin_notification_optouts")
      .delete()
      .in("admin_id", adminIds);
    if (delErr) return { error: delErr.message };
  }
  if (wanted.length > 0) {
    const { error: insErr } = await supabase.from("admin_notification_optouts").insert(wanted);
    if (insErr) return { error: insErr.message };
  }

  revalidatePath("/admin");
  return { ok: true, muted: wanted.length };
}

// ============================================================================
// PAPAN OPERASIONAL HARIAN
// ============================================================================

/**
 * Hari ini menurut zona WIB — bukan zona server.
 * Server Vercel berjalan di UTC, sehingga `new Date().toISOString()` menggeser
 * tanggal mundur 7 jam: pesanan pukul 06.00 WIB terbaca sebagai tanggal
 * kemarin, tepat pada jam-jam tersibuk. Semua perbandingan "hari ini" di papan
 * ini memakai tanggal WIB yang sama dengan yang dipakai pelanggan saat memesan.
 */
function tanggalWib() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // en-CA menghasilkan YYYY-MM-DD
}

/** Kolom yang dibutuhkan papan — satu tempat agar tidak ada yang tertinggal. */
const BOARD_SELECT =
  "id, code, status, booking_date, booking_time, address, total_price, payment_method, technician_id, completed_at, created_at, " +
  "services(name), " +
  "customer:profiles!bookings_user_id_fkey(name, phone), " +
  "technician:profiles!bookings_technician_id_fkey(id, name, phone)";

/**
 * Satu layar untuk menjawab "hari ini apa yang harus saya kerjakan?".
 *
 * Tanpa ini, jawabannya tersebar di beberapa tab berbentuk daftar: pesanan
 * menunggu konfirmasi bayar ada di satu tempat, pekerjaan yang belum dapat
 * teknisi di tempat lain, dan tugas yang dilepas teknisi tidak muncul di mana
 * pun (dulu hanya lewat email). Yang dikumpulkan di sini hanya hal yang bisa
 * DITINDAKLANJUTI sekarang, bukan seluruh riwayat.
 */
export async function getDailyOpsBoardAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak. Halaman ini khusus admin." };

  const hariIni = tanggalWib();

  const [jadwalRes, perluRes, bayarRes] = await Promise.all([
    // Jadwal hari ini, urut jam.
    supabase
      .from("bookings")
      .select(BOARD_SELECT)
      .eq("booking_date", hariIni)
      .order("booking_time", { ascending: true })
      .limit(200),
    // Sudah dibayar tetapi belum ada teknisi — inilah kolam yang teknisi ambil
    // sendiri, dan yang harus ditugaskan admin bila tak kunjung diambil.
    supabase
      .from("bookings")
      .select(BOARD_SELECT)
      .eq("status", "paid")
      .is("technician_id", null)
      .order("booking_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(100),
    // Menunggu konfirmasi bayar (COD tidak perlu — uangnya tunai di lokasi).
    supabase
      .from("bookings")
      .select(BOARD_SELECT)
      .eq("status", "pending")
      .neq("payment_method", "cod")
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  if (jadwalRes.error) return { error: jadwalRes.error.message };
  const jadwal = jadwalRes.data || [];
  const perluTeknisi = perluRes.data || [];
  const menungguBayar = bayarRes.data || [];

  // Antrean pelepasan tugas: hanya yang perlu ditindaklanjuti yang ditandai,
  // tetapi riwayatnya tetap ditampilkan sebagai konteks kualitas teknisi.
  let rilis = [];
  let rilisError = null;
  try {
    const { data, error } = await supabase
      .from("job_releases")
      .select(
        "id, booking_id, reason, created_at, " +
          "technician:profiles!job_releases_technician_id_fkey(id, name), " +
          "booking:bookings(code, status, technician_id, booking_date, booking_time, total_price, services(name))"
      )
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      rilisError = /relation|does not exist/i.test(error.message || "")
        ? "Tabel job_releases belum ada — jalankan supabase/migrate-job-release.sql di SQL Editor."
        : error.message;
    } else {
      rilis = (data || []).map((r) => ({
        ...r,
        // Pekerjaan ini kembali ke kolam dan MASIH belum ada yang mengambilnya.
        perluTeknisiBaru: r.booking?.status === "paid" && r.booking?.technician_id == null,
      }));
    }
  } catch (e) {
    rilisError = e?.message || "Gagal memuat pelepasan tugas.";
  }

  // Jumlah klaim garansi yang menunggu keputusan (null = tabelnya belum ada).
  let garansiTerbuka = null;
  try {
    const { count, error } = await supabase
      .from("warranty_claims")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    if (!error) garansiTerbuka = count ?? 0;
  } catch {
    garansiTerbuka = null;
  }

  // ---- Piutang JATUH TEMPO: tugas yang menunggu keputusan admin ----
  // Saldo minus teknisi yang menua (mis. teknisi sudah berhenti) tidak akan lunas
  // sendiri, dan sebelumnya hanya terlihat bila tab Saldo dibuka. Di papan ini ia
  // menjadi tugas: ingatkan, atau ajukan penghapusan (persetujuan terpisah).
  let piutang = null;
  let piutangError = null;
  try {
    const { perTeknisi, error } = await bacaPiutangTerbuka(supabase);
    if (error) {
      piutangError = error;
    } else {
      const ids = [...perTeknisi.keys()];
      const { data: profs } = ids.length
        ? await supabase
            .from("profiles")
            .select("id, name, email, balance, approval_status, balance_reminder_at")
            .in("id", ids)
        : { data: [] };
      const baris = (profs || [])
        .map((p) => {
          const v = perTeknisi.get(p.id);
          if (!v) return null;
          return {
            id: p.id,
            nama: p.name || p.email || String(p.id).slice(0, 8),
            saldo: Number(p.balance || 0),
            approval_status: p.approval_status || null,
            masihAktif: p.approval_status === "approved",
            reminder_terakhir: p.balance_reminder_at || null,
            total: v.umur.total,
            tertua: v.umur.tertua,
            baris: v.umur.baris,
            buckets: v.umur.buckets,
            jatuhTempo: v.umur.jatuhTempo,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.tertua - a.tertua);
      piutang = {
        ambangHari: ambangPiutangHari(),
        semua: baris,
        jatuhTempo: baris.filter((r) => r.jatuhTempo.total > 0),
      };
    }
  } catch (e) {
    piutangError = e?.message || "Gagal memuat piutang teknisi.";
  }

  return {
    board: {
      hariIni,
      jadwal,
      perluTeknisi,
      menungguBayar,
      rilis,
      rilisError,
      garansiTerbuka,
      piutang,
      piutangError,
      counts: {
        jadwalHariIni: jadwal.length,
        menungguBayar: menungguBayar.length,
        perluTeknisi: perluTeknisi.length,
        dikerjakan: jadwal.filter((b) => b.status === "in_progress").length,
        selesai: jadwal.filter((b) => b.status === "completed").length,
        dibatalkan: jadwal.filter((b) => b.status === "cancelled").length,
        rilisPerluTindak: rilis.filter((r) => r.perluTeknisiBaru).length,
        piutangJatuhTempo: piutang?.jatuhTempo.length ?? 0,
      },
    },
  };
}

// ============================================================================
// KLAIM GARANSI
// ============================================================================

/**
 * Daftar klaim garansi untuk panel admin (terbaru dulu).
 * Pelanggan mengajukan lewat RPC create_warranty_claim di aplikasi; admin
 * memutuskan di sini — menyetujui berarti kunjungan ulang gratis dibuatkan.
 */
export async function getWarrantyClaimsAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const { data, error } = await supabase
    .from("warranty_claims")
    .select(
      "id, reason, status, admin_note, created_at, decided_at, revisit_booking_id, " +
        "customer:profiles!warranty_claims_customer_id_fkey(name, phone, email), " +
        "technician:profiles!warranty_claims_technician_id_fkey(name, phone), " +
        "booking:bookings!warranty_claims_booking_id_fkey(code, booking_date, booking_time, address, total_price, completed_at, services(name, warranty_days)), " +
        "revisit:bookings!warranty_claims_revisit_booking_id_fkey(code, status, booking_date, booking_time)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (/relation|does not exist/i.test(error.message || "")) {
      return {
        error: "Tabel warranty_claims belum ada — jalankan supabase/migrate-warranty-claims.sql di SQL Editor.",
      };
    }
    return { error: error.message };
  }
  return { claims: data || [] };
}

/**
 * Putuskan klaim garansi. Keputusan dijalankan di database (RPC security
 * definer) karena menyetujui klaim berarti MEMBUAT pesanan baru berharga 0 —
 * operasi yang tidak boleh bisa ditiru klien mana pun.
 *
 * date/time opsional: admin memilih jadwal kunjungan ulang; bila kosong,
 * database memakai besok dengan rentang jam yang sama seperti pesanan asal.
 */
export async function decideWarrantyClaimAdmin(claimId, decision, note = null, date = null, time = null) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };
  if (!["approved", "rejected"].includes(decision)) return { error: "Keputusan tidak valid." };

  const { data, error } = await supabase.rpc("decide_warranty_claim", {
    p_claim: claimId,
    p_status: decision,
    p_note: (note || "").trim() || null,
    p_date: date || null,
    p_time: (time || "").trim() || null,
  });

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || "")) {
      return { error: "Fungsi decide_warranty_claim belum ada — jalankan supabase/migrate-warranty-claims.sql dulu." };
    }
    return { error: error.message };
  }
  if (!data?.ok) return { error: data?.error || "Klaim gagal diputuskan." };

  revalidatePath("/admin");
  return { ok: true, result: data };
}

/* ====================== HAPUS AKUN (syarat Google Play) ====================== */

const STATUS_HAPUS = ["menunggu_konfirmasi", "diminta", "dibatalkan", "selesai", "ditolak"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Klien service-role untuk urusan hapus akun, atau null bila kuncinya tidak ada.
 *
 * KENAPA HARUS SERVICE ROLE: tabel `account_deletion_requests` hanya punya policy
 * SELECT untuk PEMILIK barisnya (transparansi bagi pengguna) — tidak ada policy
 * untuk admin. Sesi admin pun karena itu tidak bisa membaca permintaan orang lain,
 * dan `eksekusi_hapus_akun` EXECUTE-nya memang dicabut dari `authenticated`.
 *
 * KONSEKUENSINYA PENTING: klien service role tidak membawa JWT pengguna, jadi
 * penjaga admin di DALAM database (`auth.uid()` pada fungsi eksekusi) TIDAK
 * menyala di jalur ini. Pemeriksaan `requireAdmin(supabase)` dengan sesi pemanggil
 * pada tiap fungsi di bawah adalah gerbang satu-satunya — jangan dihapus.
 */
function klienHapusAkun() {
  // Tanpa kunci layanan, createAdminClient() diam-diam jatuh ke kunci anon dan
  // setiap operasi di sini ditolak RLS dengan pesan yang tidak menjelaskan
  // sebabnya. Lebih baik berhenti dengan sebab yang bisa ditindaklanjuti.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

function pesanTabelBelumAda() {
  return (
    "Tabel account_deletion_requests belum ada di database. Jalankan " +
    "supabase/migrate-account-deletion.sql di Supabase SQL Editor, lalu muat ulang halaman ini."
  );
}

/**
 * Ringkasan singkat untuk lencana di tab: berapa yang menunggu dijalankan.
 * Sengaja hanya dua hitungan (head count), supaya halaman admin tidak menanggung
 * biaya memeriksa kelayakan setiap permintaan sebelum tabnya dibuka.
 */
export async function getAccountDeletionSummaryAdmin() {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const klien = klienHapusAkun();
  if (!klien) return { diminta: 0, menungguKonfirmasi: 0, tersedia: false };

  const hitung = async (status) => {
    const { count, error } = await klien
      .from("account_deletion_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) throw new Error(error.message);
    return count || 0;
  };

  try {
    const [diminta, menungguKonfirmasi] = await Promise.all([
      hitung("diminta"),
      hitung("menunggu_konfirmasi"),
    ]);
    return { diminta, menungguKonfirmasi, tersedia: true };
  } catch (err) {
    // Migrasi belum dijalankan = keadaan normal saat ini, bukan galat halaman.
    return {
      diminta: 0,
      menungguKonfirmasi: 0,
      tersedia: false,
      error: /does not exist|schema cache|not find the table/i.test(err.message || "")
        ? pesanTabelBelumAda()
        : `Gagal menghitung permintaan: ${err.message}`,
    };
  }
}

/**
 * Daftar permintaan hapus akun untuk panel, lengkap dengan penilaian kelayakan.
 *
 * Kelayakan diperiksa dengan fungsi DB yang SAMA dengan jalur pengguna
 * (`hapus_akun_blokir`), jadi panel tidak bisa punya pendapat yang berbeda dari
 * aplikasi/web. Pemeriksaan hanya dilakukan untuk baris yang berstatus 'diminta'
 * (satu-satunya yang bisa dijalankan) supaya tidak ada panggilan RPC sia-sia.
 */
export async function getAccountDeletionRequestsAdmin(status = "diminta") {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const klien = klienHapusAkun();
  if (!klien) {
    return { error: "Kunci layanan (SUPABASE_SERVICE_ROLE_KEY) belum tersedia di server ini." };
  }

  const dipilih = status === "semua" || !status ? null : String(status);
  if (dipilih && !STATUS_HAPUS.includes(dipilih)) return { error: "Status tidak dikenal." };

  let baris;
  try {
    baris = await daftarPermintaanHapus({ admin: klien, status: dipilih, limit: 200 });
  } catch (err) {
    return {
      error: /does not exist|schema cache|not find the table/i.test(err.message || "")
        ? pesanTabelBelumAda()
        : `Gagal membaca permintaan: ${err.message}`,
      perluMigrasi: /does not exist|schema cache|not find the table/i.test(err.message || ""),
    };
  }

  const permintaan = [];
  for (const r of baris) {
    let blokir = null;
    let kelayakanRagu = false;
    if (r.user_id && r.status === "diminta") {
      const { data, error } = await klien.rpc("hapus_akun_blokir", { p_user: r.user_id });
      if (error) {
        // Fungsi penjaganya belum ada (migrasi separuh jalan): jangan gagalkan
        // seluruh daftar — tandai saja supaya admin tahu kelayakannya belum
        // terbaca, bukan "aman".
        kelayakanRagu = true;
      } else {
        blokir = data || null;
      }
    }
    const kelayakan = ringkasKelayakan({
      status: r.status,
      blokir: kelayakanRagu ? KODE_KELAYAKAN_RAGU : blokir,
    });
    permintaan.push({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      sumber: r.sumber,
      alasan: r.alasan,
      status: r.status,
      createdAt: r.created_at,
      confirmedAt: r.confirmed_at,
      decidedAt: r.decided_at,
      catatan: r.catatan_admin,
      // Janji yang dibaca pengguna di halaman/surel: diproses dalam JANJI_HARI.
      tenggat: r.created_at
        ? new Date(Date.parse(r.created_at) + JANJI_HARI * 86400000).toISOString()
        : null,
      blokir: kelayakanRagu ? null : blokir,
      kelayakanRagu,
      boleh: kelayakan.boleh,
      pesan: kelayakan.pesan,
      peringatan: kelayakan.peringatan,
    });
  }

  return { requests: permintaan, janjiHari: JANJI_HARI, rencana: RENCANA_HAPUS };
}

/**
 * JALANKAN satu permintaan hapus akun dari panel.
 *
 * Tombol di UI sudah meminta admin mengetik kata konfirmasi, tetapi itu hanya
 * kenyamanan: keputusan sesungguhnya ada di sini. Yang tidak boleh dilunakkan —
 * peran admin diperiksa dengan SESI PEMANGGIL sebelum apa pun terjadi (lihat
 * catatan di klienHapusAkun), dan `aksesDicabut === false` diteruskan apa adanya
 * supaya UI bisa menahannya sebagai keadaan bahaya.
 */
export async function executeAccountDeletionAdmin(requestId, catatan = "") {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: "Akses ditolak." };

  const id = String(requestId || "").trim();
  if (!UUID_RE.test(id)) return { error: "ID permintaan tidak valid." };

  const klien = klienHapusAkun();
  if (!klien) {
    return { error: "Kunci layanan (SUPABASE_SERVICE_ROLE_KEY) belum tersedia di server ini." };
  }

  // Dibaca lebih dulu supaya pesan galatnya jelas (status apa, surel siapa).
  // Aturan "hanya 'diminta' yang boleh dijalankan" tetap ditegakkan ulang oleh
  // fungsi database.
  const { data: baris, error: errBaca } = await klien
    .from("account_deletion_requests")
    .select("id, status, email")
    .eq("id", id)
    .maybeSingle();

  if (errBaca) {
    return {
      error: /does not exist|schema cache|not find the table/i.test(errBaca.message || "")
        ? pesanTabelBelumAda()
        : `Gagal membaca permintaan: ${errBaca.message}`,
    };
  }
  if (!baris) return { error: "Permintaan tidak ditemukan." };
  if (baris.status !== "diminta") {
    return {
      error: `Permintaan ini berstatus "${baris.status}" — hanya yang berstatus "diminta" yang menunggu dijalankan.`,
    };
  }

  const hasil = await eksekusiHapusAkun({
    requestId: id,
    catatan: String(catatan || "").trim() || "Dijalankan dari panel admin",
    admin: klien,
  });

  if (!hasil.ok) {
    return {
      error: `Gagal menjalankan: ${hasil.error}${hasil.status ? ` (status: ${hasil.status})` : ""}`,
    };
  }

  // Jejak siapa yang menjalankan: RPC menulis `decided_by = auth.uid()`, dan itu
  // NULL saat dipanggil dengan service role. Diisi hanya bila masih kosong,
  // supaya kolom audit ini benar-benar menunjuk admin yang menekan tombol.
  let pelaksanaDicatat = false;
  try {
    const { error: errCatat } = await klien
      .from("account_deletion_requests")
      .update({ decided_by: admin.id })
      .eq("id", id)
      .is("decided_by", null);
    pelaksanaDicatat = !errCatat;
  } catch {
    pelaksanaDicatat = false;
  }

  const ringkas = ringkasEksekusi(hasil);
  revalidatePath("/admin");
  return {
    ok: true,
    tingkat: ringkas.tingkat,
    pesan: ringkas.pesan,
    tiadaAkun: Boolean(hasil.tiadaAkun),
    userId: hasil.userId ?? null,
    aksesDicabut: hasil.aksesDicabut ?? null,
    galatAkses: hasil.galatAkses ?? null,
    berkasDihapus: hasil.berkasDihapus || [],
    terhapus: hasil.terhapus || {},
    surelError: hasil.surel?.error || null,
    surelTerkirim: Boolean(hasil.surel && !hasil.surel.error),
    pelaksanaDicatat,
  };
}
