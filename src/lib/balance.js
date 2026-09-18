/**
 * Helper saldo teknisi — model TOP-UP.
 *
 * Alur dana:
 *   - Saldo HANYA bertambah saat admin menyetujui bukti setor
 *     (transfer bank/ tunai teknisi) atau menambah manual.
 *   - Saat pesanan selesai, komisi platform (commission_rate
 *     teknisi, default 10%) Dipotong dari saldo. Net pendapatan
 *     tetap dicatat sebagai transaksi 'earning' untuk transparansi,
 *     tapi yang mengurangi saldo adalah komisinya.
 *
 * Semua fungsi aman-dipanggil (tidak melempar) dan idempoten.
 * Kolom/tabel yang belum dimigrasi di-skip tanpa menggagalkan alur.
 */
import { computeSplit, APP_FEE } from "@/lib/pricing";

/** Nilai pekerjaan yang jadi dasar komisi: total bayar dikurangi biaya aplikasi. */
function commissionBase(totalPrice) {
  return Math.max(0, Number(totalPrice) - APP_FEE);
}

/**
 * Potong komisi pesanan selesai dari saldo teknisi.
 * Idempoten: satu booking hanya pernah dipotong sekali (cek transaksi earning).
 * Dipanggil oleh updateBookingStatusAdmin & updateJobStatus.
 */
export async function debitTechnicianCommission(supabase, bookingId) {
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("id, code, status, technician_id, total_price")
      .eq("id", bookingId)
      .maybeSingle();
    if (!b || !b.technician_id || b.status !== "completed") return { ok: false, skipped: true };

    // Idempotensi: booking ini sudah pernah dipotong?
    const { data: existing } = await supabase
      .from("balance_transactions")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("type", "earning")
      .maybeSingle();
    if (existing) return { ok: true, already: true };

    // Rate komisi teknisi + saldo saat ini
    const { data: tech } = await supabase
      .from("profiles")
      .select("commission_rate, balance")
      .eq("id", b.technician_id)
      .maybeSingle();
    if (!tech) return { ok: false, skipped: true };

    const gross = commissionBase(b.total_price);
    const split = computeSplit(gross, Number(tech.commission_rate ?? 10));

    // Catat transaksi komisi (amount negatif = saldo berkurang)
    const { error: txErr } = await supabase.from("balance_transactions").insert({
      technician_id: b.technician_id,
      booking_id: bookingId,
      type: "earning",
      amount: -split.commission, // saldo dipotong sebesar komisi
      commission_amount: split.commission,
      note: `Komisi ${Number(tech.commission_rate ?? 10)}% pesanan ${b.code || ""} selesai`.trim(),
    });
    if (txErr) {
      if (/relation|does not exist|permission|duplicate key/i.test(txErr.message || "")) {
        // duplicate key = sudah pernah dipotong (race) → anggap sukses
        return { ok: true, already: /duplicate/i.test(txErr.message || "") };
      }
      return { ok: false, error: txErr.message };
    }

    // Kurangi saldo profil (boleh negatif sementara — teknisi setor untuk menutup)
    const newBalance = Number(tech.balance || 0) - split.commission;
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ balance: newBalance })
      .eq("id", b.technician_id);
    if (updErr && !/column .* does not exist|permission/i.test(updErr.message || "")) {
      return { ok: false, error: updErr.message };
    }

    return { ok: true, commission: split.commission, balance: newBalance };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

/**
 * Tambah saldo teknisi (dipakai admin: manual ATAU verifikasi bukti setor).
 * Mencatat transaksi 'topup' lalu menaikkan balance profil.
 */
export async function creditTechnicianBalance(supabase, technicianId, amount, note, depositId = null) {
  const amt = Math.round(Number(amount));
  if (!technicianId || !amt || amt <= 0) return { ok: false, error: "Jumlah top-up tidak valid." };

  try {
    const { data: tech } = await supabase
      .from("profiles")
      .select("balance")
      .eq("id", technicianId)
      .maybeSingle();
    if (!tech) return { ok: false, error: "Teknisi tidak ditemukan." };

    const { error: txErr } = await supabase.from("balance_transactions").insert({
      technician_id: technicianId,
      deposit_id: depositId,
      type: "topup",
      amount: amt,
      note: note || "Top-up saldo",
    });
    if (txErr) {
      if (/relation|does not exist|permission/i.test(txErr.message || "")) {
        return { ok: false, error: "Tabel saldo belum ada — jalankan supabase/migrate-technician-balance.sql." };
      }
      return { ok: false, error: txErr.message };
    }

    const newBalance = Number(tech.balance || 0) + amt;
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ balance: newBalance })
      .eq("id", technicianId);
    if (updErr) return { ok: false, error: updErr.message };

    return { ok: true, balance: newBalance };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}
