"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { debitTechnicianCommission } from "@/lib/balance";
import { sendAdminNewDepositEmail, sendAdminNewWithdrawalEmail } from "@/lib/email";

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
 * Kirim email notifikasi pengajuan saldo ke semua admin.
 * Fire-and-forget: kegagalan email tidak menggagalkan pengajuan.
 */
async function notifyAdminsBalanceRequest(supabase, kind, payload) {
  try {
    const { data: adminEmails } = await supabase.rpc("get_admin_emails");
    if (!adminEmails?.length) return;
    if (kind === "deposit") await sendAdminNewDepositEmail(adminEmails, payload);
    else await sendAdminNewWithdrawalEmail(adminEmails, payload);
  } catch (err) {
    console.error("Gagal notifikasi saldo ke admin:", err?.message);
  }
}

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

  const { data: techProfile } = await supabase
    .from("profiles")
    .select("name, email, balance")
    .eq("id", user.id)
    .single();

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

  notifyAdminsBalanceRequest(supabase, "deposit", {
    tech_name: techProfile?.name || "Teknisi",
    tech_email: techProfile?.email || user.email,
    current_balance: techProfile?.balance || 0,
    amount: amt,
    proofUrl,
  });

  revalidatePath("/technician");
  return { ok: true };
}

/**
 * Teknisi mengajukan penarikan saldo ke rekening pribadi.
 * Saldo langsung DITAHAN (dikurangi) saat pengajuan supaya tidak
 * dipakai dobel; kalau admin menolak, saldo dikembalikan penuh.
 */
export async function requestWithdrawal({ amount, bankName, accountNumber, accountHolder }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Belum login." };

  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0) return { error: "Isi jumlah penarikan yang valid." };

  const bank = (bankName || "").trim();
  const accNo = (accountNumber || "").trim();
  const accHolder = (accountHolder || "").trim();
  if (!bank) return { error: "Isi nama bank / e-wallet tujuan." };
  if (!accNo || accNo.length < 6) return { error: "Isi nomor rekening yang valid (min. 6 karakter)." };
  if (!accHolder) return { error: "Isi nama pemilik rekening." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, balance, name, email")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "technician" && profile?.role !== "admin") {
    return { error: "Hanya teknisi yang bisa menarik saldo." };
  }
  if (Number(profile.balance || 0) < amt) {
    return { error: `Saldo tidak cukup. Saldo aktifmu ${Math.round(Number(profile.balance || 0)).toLocaleString("id-ID")}.` };
  }

  // Ada pengajuan pending lain? Tunggu diproses dulu (satu kanal hold).
  const { data: pendingWd } = await supabase
    .from("balance_withdrawals")
    .select("id")
    .eq("technician_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingWd) {
    return { error: "Kamu masih punya pengajuan penarikan yang menunggu verifikasi admin." };
  }

  // Catat transaksi hold (amount negatif)
  const { data: tx, error: txErr } = await supabase
    .from("balance_transactions")
    .insert({
      technician_id: user.id,
      type: "withdrawal",
      amount: -amt,
      note: `Pengajuan tarik ke ${bank} ${accNo.slice(0, 4)}••••`,
    })
    .select("id")
    .single();
  if (txErr) {
    if (/relation|does not exist|check constraint/i.test(txErr.message || "")) {
      return { error: "Fitur penarikan belum aktif — jalankan supabase/migrate-technician-withdrawals.sql di SQL Editor." };
    }
    return { error: txErr.message };
  }

  const { error: insErr } = await supabase.from("balance_withdrawals").insert({
    technician_id: user.id,
    amount: amt,
    bank_name: bank,
    account_number: accNo,
    account_holder: accHolder,
    status: "pending",
    transaction_id: tx.id,
  });
  if (insErr) return { error: insErr.message };

  // Kurangi saldo profil
  const { error: updErr } = await supabase
    .from("profiles")
    .update({ balance: Number(profile.balance || 0) - amt })
    .eq("id", user.id);
  if (updErr) return { error: updErr.message };

  notifyAdminsBalanceRequest(supabase, "withdrawal", {
    tech_name: profile.name || "Teknisi",
    tech_email: profile.email || user.email,
    current_balance: Number(profile.balance || 0) - amt,
    amount: amt,
    bank_name: bank,
    account_number: accNo,
    account_holder: accHolder,
  });

  revalidatePath("/technician");
  return { ok: true };
}
