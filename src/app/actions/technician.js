"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { debitTechnicianCommission } from "@/lib/balance";

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

  // pesanan selesai → potong komisi dari saldo teknisi
  if (status === "completed") {
    await debitTechnicianCommission(supabase, bookingId);
  }

  revalidatePath("/technician");
  return { ok: true };
}

/* ========================= SALDO: SETOR / TOP-UP ========================= */

/**
 * Teknisi mengajukan setor saldo: upload bukti transfer + jumlah.
 * Saldo BARU bertambah setelah admin menyetujui bukti ini.
 * (Client mengunggah gambar ke bucket balance-proofs dulu, lalu
 * memanggil aksi ini dengan URL publiknya.)
 */
export async function submitBalanceDeposit({ amount, proofUrl }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Belum login." };

  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0) return { error: "Isi jumlah setor yang kamu transfer." };
  if (!proofUrl) return { error: "Unggah gambar bukti setor dulu." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "technician" && profile?.role !== "admin") {
    return { error: "Hanya teknisi yang bisa menyetor saldo." };
  }

  const { error } = await supabase.from("balance_deposits").insert({
    technician_id: user.id,
    amount: amt,
    claimed_amount: amt,
    proof_url: proofUrl,
    status: "pending",
  });
  if (error) {
    if (/relation|does not exist/i.test(error.message || "")) {
      return { error: "Tabel setor saldo belum ada — jalankan supabase/migrate-technician-balance.sql di SQL Editor." };
    }
    return { error: error.message };
  }

  revalidatePath("/technician");
  return { ok: true };
}
