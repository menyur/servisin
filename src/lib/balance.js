/**
 * Helper saldo teknisi — model TOP-UP.
 *
 * Alur dana:
 *   - Saldo HANYA bertambah saat admin menyetujui bukti setor
 *     (transfer bank/ tunai teknisi) atau menambah manual.  *   - Saat pesanan selesai, KOMISI platform (commission_rate
 *     teknisi, default 10%) + BIAYA APLIKASI pelanggan (app_fee,
 *     Rp 5.000) Dipotong PENUH dari saldo. Bila saldo tidak cukup, saldo
 *     menjadi MINUS = piutang teknisi (bukan kerugian platform tanpa jejak);
 *     teknisi tak bisa mengambil pekerjaan baru sampai menyetor. Net pendapatan
 *     tetap dicatat sebagai transaksi 'earning' untuk transparansi.
 *
 * Semua fungsi aman-dipanggil (tidak melempar) dan idempoten.
 * Kolom/tabel yang belum dimigrasi di-skip tanpa menggagalkan alur.
 */
import { computeSplit, commissionBase, planBalanceCut, alokasiSetoran, piutangTerbukaBaris } from "@/lib/pricing";

/**
 * Potong komisi pesanan selesai dari saldo teknisi.
 * Idempoten: satu booking hanya pernah dipotong sekali (cek transaksi earning).
 * Dipanggil oleh updateBookingStatusAdmin & updateJobStatus.
 */
export async function debitTechnicianCommission(supabase, bookingId) {
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("id, code, status, technician_id, total_price, app_fee")
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

    const gross = commissionBase(b.total_price, b.app_fee);
    const split = computeSplit(gross, Number(tech.commission_rate ?? 10));
    // Aturan platform: potongan saldo = komisi + biaya aplikasi pelanggan.
    const fee = Math.max(0, Number(b.app_fee ?? 0));
    // KEBIJAKAN: potongan PENUH = komisi + biaya aplikasi, sebanyak apa pun
    // saldo yang ada. Saldo boleh menjadi MINUS — nilai itu adalah PIUTANG
    // teknisi (bukan kerugian platform yang hilang tanpa jejak). Mantan
    // kebijakan "potong sebatas saldo" membuat platform kehilangan selisihnya
    // tanpa catatan karena teknisi mengendalikan sendiri besar setorannya.
    const plan = planBalanceCut({ balance: tech.balance, commission: split.commission, fee });
    const totalCut = plan.cut;

    // Catat transaksi (amount negatif = saldo berkurang).
    // commission_amount = porsi komisi; sisanya biaya aplikasi. Potongannya
    // SELALU penuh, jadi |amount| = komisi + biaya app untuk setiap pesanan,
    // dan `uncovered_amount` menyimpan bagian yang belum tertutup saldo
    // (piutang teknisi) supaya laporan admin bisa memisahkan tiga kolom:
    //   ditagihkan (|amount|) = tertagih + piutang
    const row = {
      technician_id: b.technician_id,
      booking_id: bookingId,
      type: "earning",
      amount: -totalCut,
      commission_amount: plan.commissionCut,
      uncovered_amount: plan.debt,
      note:
        `Komisi ${Number(tech.commission_rate ?? 10)}% + biaya app pesanan ${b.code || ""} selesai` +
        (plan.debt > 0 ? ` (saldo minus — piutang teknisi Rp ${Math.round(plan.debt).toLocaleString("id-ID")})` : ""),
    };
    let { error: txErr } = await supabase.from("balance_transactions").insert(row);
    // Kolom uncovered_amount ditambahkan migrate/enforce-full-charge-balance.sql.
    // Bila migrasinya belum dijalankan, potongannya tetap dicatat (piutangnya
    // cuma belum terpisah di laporan) — jangan sampai potongan gagal karena itu.
    if (txErr && /uncovered_amount/.test(txErr.message || "")) {
      const { uncovered_amount: _abaikan, ...tanpaKolom } = row;
      ({ error: txErr } = await supabase.from("balance_transactions").insert(tanpaKolom));
    }
    if (txErr) {
      if (/relation|does not exist|permission|duplicate key/i.test(txErr.message || "")) {
        // duplicate key = sudah pernah dipotong (race) → anggap sukses
        return { ok: true, already: /duplicate/i.test(txErr.message || "") };
      }
      return { ok: false, error: txErr.message };
    }

    // Kurangi saldo profil. Potongan penuh → saldo boleh minus (piutang
    // teknisi). Teknisi bersaldo minus tidak bisa mengambil pekerjaan baru
    // sampai menyetor (gerbang `claim_job`: saldo > 0), jadi piutangnya
    // terlunasi sebelum pekerjaan berikutnya dan tidak menumpuk.
    const newBalance = plan.resultingBalance;
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ balance: newBalance })
      .eq("id", b.technician_id);
    if (updErr && !/column .* does not exist|permission/i.test(updErr.message || "")) {
      return { ok: false, error: updErr.message };
    }

    return { ok: true, commission: totalCut, balance: newBalance, debt: plan.debt, partial: plan.partial };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

/**
 * Baca PIUTANG TERBUKA seorang teknisi: baris ledger 'earning' yang
 * `uncovered_amount`-nya belum tertutup setoran (Σ balance_recoveries).
 * `outstanding` = besar piutang yang masih terbuka per pesanan.
 *
 * Dipakai alokasi setoran. Bila tabel pelunasan belum dimigrasi, seluruh
 * `uncovered_amount` dianggap masih terbuka (perilaku sebelum migrasi) —
 * setoran tetap menambah saldo, hanya pemasangan pelunasannya belum tercatat.
 */
async function bacaPiutangTerbuka(supabase, technicianId) {
  const { data: rows, error } = await supabase
    .from("balance_transactions")
    .select("id, booking_id, uncovered_amount, created_at")
    .eq("technician_id", technicianId)
    .eq("type", "earning")
    .gt("uncovered_amount", 0)
    .order("created_at", { ascending: true });
  if (error || !rows?.length) return { piutang: [], adaTabelPelunasan: true };

  const ids = rows.map((r) => r.id);
  const { data: rev, error: revErr } = await supabase
    .from("balance_recoveries")
    .select("earning_tx_id, amount")
    .in("earning_tx_id", ids);

  const dilunasiPer = new Map();
  for (const r of rev || []) {
    dilunasiPer.set(r.earning_tx_id, (dilunasiPer.get(r.earning_tx_id) || 0) + Math.round(Number(r.amount) || 0));
  }
  const piutang = rows
    .map((r) => ({
      id: r.id,
      booking_id: r.booking_id,
      created_at: r.created_at,
      outstanding: piutangTerbukaBaris({ uncovered: r.uncovered_amount, dilunasi: dilunasiPer.get(r.id) || 0 }),
    }))
    .filter((p) => p.outstanding > 0);

  return { piutang, adaTabelPelunasan: !revErr };
}

/**
 * Tambah saldo teknisi (dipakai admin: manual ATAU verifikasi bukti setor).
 * Mencatat transaksi 'topup' lalu menaikkan balance profil.
 *
 * SETORAN MENUTUP KEKURANGAN LEBIH DULU: sebagian setoran yang sebesar piutang
 * terpakai disimpan sebagai PELUNASAN (tabel `balance_recoveries`, FIFO — piutang
 * tertua dulu), sehingga piutang tidak lagi hanya "turun di neraca" tetapi punya
 * jejak penerimaan yang bisa dilaporkan per periode. Sisanya menjadi saldo aktif.
 * Pelunasan TIDAK mengubah saldo (saldo sudah naik lewat baris 'topup'); ia hanya
 * memasangkan setoran itu dengan piutang yang ditutupnya.
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

    // Rencana pelunasan piutang dihitung SEBELUM menulis, supaya catatan baris
    // setoran sudah bisa menyebut kekurangan yang ditutupnya.
    const { piutang, adaTabelPelunasan } = await bacaPiutangTerbuka(supabase, technicianId);
    const rencana = alokasiSetoran({ amount: amt, piutang });
    const catatan =
      (note || "Top-up saldo") +
      (rencana.dilunasi > 0
        ? ` — menutup piutang Rp ${rencana.dilunasi.toLocaleString("id-ID")}` +
          (rencana.sisa > 0 ? `, sisa masuk saldo Rp ${rencana.sisa.toLocaleString("id-ID")}` : "")
        : "");

    const { data: txRow, error: txErr } = await supabase
      .from("balance_transactions")
      .insert({
        technician_id: technicianId,
        deposit_id: depositId,
        type: "topup",
        amount: amt,
        note: catatan,
      })
      .select("id")
      .single();
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

    // Pelunasan piutang: catat pasangan setoran ↔ piutang. Best-effort — uangnya
    // tetap masuk walau pencatatan ini gagal (mis. migrasi belum dijalankan);
    // kegagalannya dilaporkan lewat `catatanPelunasan` agar tidak senyap.
    let catatanPelunasan = null;
    if (rencana.dilunasi > 0 && adaTabelPelunasan) {
      const { error: recErr } = await supabase.from("balance_recoveries").insert(
        rencana.alokasi.map((a) => ({
          technician_id: technicianId,
          earning_tx_id: a.id,
          booking_id: a.booking_id,
          topup_tx_id: txRow?.id ?? null,
          deposit_id: depositId,
          amount: a.amount,
          note: `Pelunasan piutang dari setoran (FIFO)${depositId ? " — setor disetujui admin" : " — saldo ditambah admin"}`,
        }))
      );
      if (recErr) {
        catatanPelunasan = /relation|does not exist/i.test(recErr.message || "")
          ? "tabel balance_recoveries belum ada — jalankan supabase/migrate-piutang-recovery.sql"
          : recErr.message;
        console.warn("[saldo] pelunasan piutang gagal dicatat:", catatanPelunasan);
      }
    } else if (rencana.dilunasi > 0) {
      catatanPelunasan = "tabel balance_recoveries belum ada — jalankan supabase/migrate-piutang-recovery.sql";
    }

    return {
      ok: true,
      balance: newBalance,
      recovery: { dilunasi: rencana.dilunasi, sisa: rencana.sisa, jumlahPesanan: rencana.alokasi.length },
      catatanPelunasan,
    };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}
