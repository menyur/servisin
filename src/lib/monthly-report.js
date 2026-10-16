/**
 * Laporan CSV bulanan: semua pesanan yang selesai pada bulan kalender tertentu.
 * Dipakai oleh route cron /api/cron/monthly-report (dan bisa dipakai ulang di UI).
 * Sumber data dibaca langsung lewat Supabase admin (service role bila ada),
 * jadi tidak butuh sesi user.
 *
 * LAPORAN TIGA KOLOM (kebijakan potongan penuh — lihat docs/balance-rule.md):
 *   ditagihkan = komisi + biaya aplikasi dari pesanan selesai (bookings)
 *   tertagih   = yang benar-benar terpotong dari saldo teknisi (ledger)
 *   piutang    = selisihnya (saldo teknisi minus), ditagih lagi saat dia menyetor
 * Identitas yang dijaga: ditagihkan = tertagih + piutang.
 *
 * PENUTUPAN PIUTANG ikut dilaporkan: "PEMULIHAN piutang periode ini" = setoran
 * yang menutup kekurangan pada periode ini (tabel `balance_recoveries`, lihat
 * supabase/migrate-piutang-recovery.sql), dan "Piutang BELUM lunas" = sisa
 * piutang yang belum tertutup setoran. Tanpa keduanya, periode yang hanya
 * berisi setoran (tanpa pesanan selesai) akan tampak seperti tanpa uang masuk.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { computeSplit, commissionBase, penagihanPesanan, piutangTerbukaBaris } from "@/lib/pricing";

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Baca potongan ledger per pesanan: { covered, uncovered }.
 *   covered   = bagian yang tertutup saldo teknisi saat itu (tertagih)
 *   uncovered = bagian yang menjadi piutang teknisi (kolom uncovered_amount)
 * Kolom `uncovered_amount` ditambahkan supabase/enforce-full-charge-balance.sql;
 * bila migrasinya belum dijalankan, seluruh potongan dianggap tertagih (perilaku
 * lama) supaya laporan tetap bisa dibuka.
 */
async function bacaLedgerPerPesanan(supabase, ids) {
  if (!ids.length) return new Map();
  const dasar = () =>
    supabase.from("balance_transactions").select("booking_id, amount, uncovered_amount").eq("type", "earning").in("booking_id", ids);
  let { data: txs, error } = await dasar();
  if (error && /uncovered_amount/.test(error.message || "")) {
    ({ data: txs } = await supabase
      .from("balance_transactions")
      .select("booking_id, amount")
      .eq("type", "earning")
      .in("booking_id", ids));
  }

  const map = new Map();
  for (const t of txs || []) {
    if (!t.booking_id || !(Number(t.amount) < 0)) continue;
    const total = Math.abs(Number(t.amount) || 0);
    const uncovered = Math.min(Math.max(0, Number(t.uncovered_amount) || 0), total);
    const prev = map.get(t.booking_id) || { covered: 0, uncovered: 0 };
    map.set(t.booking_id, { covered: prev.covered + (total - uncovered), uncovered: prev.uncovered + uncovered });
  }
  return map;
}

export function buildMonthlyReportCsv(rows, { year, month, ledgerByBooking = new Map(), totals = null } = {}) {
  const barisLedger = (id) => ledgerByBooking.get(id) || null;
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
    "Komisi Ditagihkan",
    "Biaya App Ditagihkan",
    "Tertagih dari Saldo",
    "Piutang (belum tertagih)",
    "Bersih Teknisi",
  ];

  const payLabelMap = { cod: "Bayar di Tempat (COD)", transfer: "Transfer Bank", qris: "Transfer Bank", virtual_account: "Transfer Bank", e_wallet: "Transfer Bank" };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");
  const num = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0);

  let totalRevenue = 0;
  let totalCommission = 0;
  let totalChargedFee = 0;
  let totalCollected = 0;
  let totalReceivable = 0;
  const lines = [headers.map(csvEscape).join(";")];

  for (const b of rows) {
    const total = Number(b.total_price) || 0;
    // Dasar komisi = total − biaya aplikasi — sama dengan yang benar-benar
    // ditagihkan sistem (debitTechnicianCommission / RPC set_job_status).
    const split = computeSplit(commissionBase(total), b.technician?.commission_rate ?? undefined);
    // Biaya aplikasi yang DITAGIHKAN diambil dari pesanan (bukan dari ledger):
    // kolom ini harus tetap benar walau potongannya belum/baru sebagian tertagih.
    const charged = penagihanPesanan({
      totalPrice: total,
      appFee: b.app_fee,
      rate: b.technician?.commission_rate ?? undefined,
    });
    const baris = barisLedger(b.id);
    const collected = baris ? Math.min(num(baris.covered), charged.want) : 0;
    const receivable = Math.min(baris ? num(baris.uncovered) : charged.want, Math.max(0, charged.want - collected));

    totalRevenue += total;
    totalCommission += charged.commission;
    totalChargedFee += charged.fee;
    totalCollected += Math.min(collected, charged.want);
    totalReceivable += receivable;

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
        Number(b.subtotal_price) || 0,
        Number(b.discount_amount) || 0,
        Number(b.app_fee) || 0,
        total,
        b.technician?.name || "-",
        charged.commission,
        charged.fee,
        collected,
        receivable,
        split.net,
      ]
        .map(csvEscape)
        .join(";")
    );
  }

  const ditagihkan = totalCommission + totalChargedFee;
  lines.push("");
  lines.push([`Periode`, `${String(month).padStart(2, "0")}/${year}`].map(csvEscape).join(";"));
  lines.push([`Jumlah pesanan selesai`, rows.length].map(csvEscape).join(";"));
  lines.push(["Total pendapatan", totalRevenue].map(csvEscape).join(";"));
  lines.push(["Komisi ditagihkan", totalCommission].map(csvEscape).join(";"));
  lines.push(["Biaya aplikasi ditagihkan", totalChargedFee].map(csvEscape).join(";"));
  lines.push(["DITAGIHKAN (komisi + biaya app)", ditagihkan].map(csvEscape).join(";"));
  lines.push(["TERTAGIH dari saldo teknisi", totalCollected].map(csvEscape).join(";"));
  lines.push(["PIUTANG periode ini (saldo minus teknisi)", totalReceivable].map(csvEscape).join(";"));
  lines.push(
    ["PEMULIHAN piutang periode ini (setoran menutup kekurangan)", totals?.recoveryThisMonth ?? 0]
      .map(csvEscape)
      .join(";")
  );
  lines.push(["Piutang BELUM lunas (belum tertutup setoran)", totals?.piutangTerbuka ?? totalReceivable].map(csvEscape).join(";"));
  lines.push(["Belum terpotong (pesanan tanpa baris ledger)", totals?.tanpaLedgerTotal ?? 0].map(csvEscape).join(";"));
  lines.push(["Piutang TOTAL saat ini (semua saldo minus)", totals?.receivableTotal ?? totalReceivable].map(csvEscape).join(";"));
  lines.push(["Diekspor", new Date().toLocaleString("id-ID")].map(csvEscape).join(";"));

  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Kumpulkan pesanan selesai dalam periode bulan kalender + ringkasan tiga kolom.
 * month: 1-12, year: angka. Default: bulan berjalan.
 */
export async function collectMonthlyCompleted({ year, month } = {}) {
  const supabase = await createAdminClient();

  const now = new Date();
  const y = year || now.getFullYear();
  const m = month || now.getMonth() + 1;
  const start = new Date(y, m - 1, 1, 0, 0, 0).toISOString();
  const end = new Date(y, m, 1, 0, 0, 0).toISOString();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `*, services(name), profiles!bookings_user_id_fkey(name, phone, email),
       technician:profiles!bookings_technician_id_fkey(id, name, commission_rate)`
    )
    .eq("status", "completed")
    .gte("completed_at", start)
    .lt("completed_at", end)
    .order("completed_at", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = data || [];

  // Ledger potongan per pesanan: dipakai untuk memisahkan TERTAGIH dari PIUTANG.
  // (Semua baris 'earning' potongan penuh, jadi |amount| = komisi + biaya app;
  // laporan tetap membaca apa adanya supaya baris lama — potongan sebagian dari
  // kebijakan sebelumnya — tidak dihitung sebagai tertagih penuh.)
  const ledgerByBooking = await bacaLedgerPerPesanan(supabase, rows.map((b) => b.id));

  let totalRevenue = 0;
  let totalCommission = 0;
  let totalChargedFee = 0;
  let totalCollected = 0;
  let totalReceivable = 0;
  let totalTanpaLedger = 0;
  for (const b of rows) {
    const charged = penagihanPesanan({
      totalPrice: b.total_price,
      appFee: b.app_fee,
      rate: b.technician?.commission_rate ?? undefined,
    });
    const baris = ledgerByBooking.get(b.id);
    // Tanpa baris ledger potongannya belum dijalankan sama sekali — jangan
    // dihitung "tertagih" hanya karena pesanannya selesai.
    const covered = baris ? Math.min(baris.covered, charged.want) : 0;
    const uncovered = Math.min(baris ? baris.uncovered : charged.want, Math.max(0, charged.want - covered));
    totalRevenue += Number(b.total_price) || 0;
    totalCommission += charged.commission;
    totalChargedFee += charged.fee;
    totalCollected += covered;
    totalReceivable += uncovered;
    if (!baris) totalTanpaLedger += charged.want;
  }

  // Piutang total saat ini = saldo minus seluruh teknisi (bukan hanya periode ini).
  // Ditampilkan terpisah agar laporan bulanan tidak menyiratkan piutang baru.
  let receivableTotal = totalReceivable;
  const { data: negatif } = await supabase
    .from("profiles")
    .select("balance")
    .eq("role", "technician")
    .lt("balance", 0);
  if (Array.isArray(negatif)) {
    receivableTotal = negatif.reduce((s, p) => s + Math.max(0, -(Number(p.balance) || 0)), 0);
  }

  // ---- Pemulihan piutang (setoran menutup kekurangan) ----
  // Periode ini: berapa piutang yang lunas karena setoran pada periode ini.
  // Bisa > 0 walau tidak ada pesanan selesai bulan ini (piutang bulan lalu
  // dibayar bulan ini) — justru itulah yang dulu hilang dari laporan.
  const { data: recsPeriode } = await supabase
    .from("balance_recoveries")
    .select("amount")
    .gte("created_at", start)
    .lt("created_at", end);
  const recoveryThisMonth = (recsPeriode || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);

  // Piutang yang BELUM lunas (semua periode) = Σ (uncovered − pelunasan) per baris.
  // Berbeda dari `receivableTotal` (entri neraca dari saldo minus teknisi):
  // angka ini murni dari ledger, jadi bisa diaudit per pesanan.
  let piutangTerbuka = 0;
  const { data: piutangBaris } = await supabase
    .from("balance_transactions")
    .select("id, uncovered_amount")
    .eq("type", "earning")
    .gt("uncovered_amount", 0)
    .limit(5000);
  if (piutangBaris?.length) {
    const { data: recSemua } = await supabase.from("balance_recoveries").select("earning_tx_id, amount").limit(5000);
    const dilunasiPer = new Map();
    for (const r of recSemua || []) {
      dilunasiPer.set(r.earning_tx_id, (dilunasiPer.get(r.earning_tx_id) || 0) + (Number(r.amount) || 0));
    }
    piutangTerbuka = piutangBaris.reduce(
      (s, t) => s + piutangTerbukaBaris({ uncovered: t.uncovered_amount, dilunasi: dilunasiPer.get(t.id) || 0 }),
      0
    );
  } else if (!piutangBaris) {
    piutangTerbuka = totalReceivable; // kolom piutang belum ada → pakai angka periode
  }

  return {
    rows,
    year: y,
    month: m,
    count: rows.length,
    totalRevenue,
    totalCommission,
    totalAppFeeCharged: totalChargedFee,
    chargedTotal: totalCommission + totalChargedFee,
    collectedTotal: totalCollected,
    receivableThisMonth: totalReceivable,
    recoveryThisMonth,
    piutangTerbuka,
    tanpaLedgerTotal: totalTanpaLedger,
    receivableTotal,
    ledgerByBooking,
  };
}
