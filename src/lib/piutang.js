/**
 * Pembacaan PIUTANG TERBUKA teknisi — satu sumber untuk panel admin dan cron
 * pengingat.
 *
 * Piutang = baris ledger `balance_transactions` type 'earning' yang
 * `uncovered_amount`-nya belum tertutup pelunasan (tabel `balance_recoveries`,
 * baik jenis 'setoran' maupun 'penghapusan'). Rumus per baris dan keranjang
 * umurnya ada di src/lib/pricing.js (`piutangTerbukaBaris`, `keranjangUmurPiutang`)
 * supaya angka piutang/umur tidak pernah berbeda antar tampilan.
 *
 * Dipakai: `getFinanceSummaryAdmin`, `getPiutangUmurAdmin`,
 * `getTechnicianBalancesAdmin`, `getDailyOpsBoardAdmin` (semua di
 * src/app/actions/admin.js) dan route cron `/api/cron/piutang-reminder`.
 *
 * Aman-gagal: kolom/tabel yang belum dimigrasi tidak membuat pemanggil melempar —
 * hasilnya `{ perTeknisi: kosong, error: <pesan yang menyebut migrasinya> }`.
 */
// Impor relatif (bukan alias `@/`) supaya probe offline
// (scripts/verify-piutang-writeoff.mjs) bisa memuat berkas ini langsung dengan
// Node tanpa resolver Next — sama seperti src/lib/notify.js → ./push.js.
import { piutangTerbukaBaris, keranjangUmurPiutang, ambangPiutangHari } from "./pricing.js";

export async function bacaPiutangTerbuka(supabase) {
  const { data: rows, error } = await supabase
    .from("balance_transactions")
    .select("id, technician_id, booking_id, uncovered_amount, created_at")
    .eq("type", "earning")
    .gt("uncovered_amount", 0)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) {
    return {
      perTeknisi: new Map(),
      error: /uncovered_amount/.test(error.message || "")
        ? "Kolom piutang belum ada — jalankan supabase/enforce-full-charge-balance.sql dulu."
        : error.message,
    };
  }

  const ids = (rows || []).map((r) => r.id);
  let pelunasan = [];
  let pelunasanTerbaca = true;
  if (ids.length) {
    const { data, error: recErr } = await supabase
      .from("balance_recoveries")
      .select("earning_tx_id, amount, kind")
      .in("earning_tx_id", ids);
    if (recErr) pelunasanTerbaca = false; // migrasi pelunasan belum jalan
    pelunasan = data || [];
  }

  const dilunasiPer = new Map();
  for (const r of pelunasan) {
    dilunasiPer.set(r.earning_tx_id, (dilunasiPer.get(r.earning_tx_id) || 0) + (Number(r.amount) || 0));
  }

  const perTeknisi = new Map();
  for (const r of rows || []) {
    const terbuka = piutangTerbukaBaris({
      uncovered: r.uncovered_amount,
      dilunasi: dilunasiPer.get(r.id) || 0,
    });
    if (terbuka <= 0) continue;
    const isi = perTeknisi.get(r.technician_id) || { items: [] };
    isi.items.push({ id: r.id, booking_id: r.booking_id, created_at: r.created_at, outstanding: terbuka });
    perTeknisi.set(r.technician_id, isi);
  }

  const hari = ambangPiutangHari();
  for (const isi of perTeknisi.values()) {
    isi.umur = keranjangUmurPiutang(isi.items, { hariJatuhTempo: hari });
  }
  return { perTeknisi, error: null, pelunasanTerbaca, ambangHari: hari };
}
