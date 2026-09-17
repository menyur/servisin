/**
 * Laporan CSV bulanan: semua pesanan yang selesai pada bulan kalender tertentu.
 * Dipakai oleh route cron /api/cron/monthly-report (dan bisa dipakai ulang di UI).
 * Sumber data dibaca langsung lewat Supabase admin (service role bila ada),
 * jadi tidak butuh sesi user.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { computeSplit } from "@/lib/pricing";

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildMonthlyReportCsv(rows, { year, month }) {
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
    "Komisi Platform",
    "Bersih Teknisi",
  ];

  const payLabelMap = { qris: "QRIS", virtual_account: "Virtual Account", e_wallet: "E-Wallet", cod: "Cash on Delivery" };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");

  let totalRevenue = 0;
  let totalCommission = 0;
  const lines = [headers.map(csvEscape).join(";")];

  for (const b of rows) {
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
        Number(b.subtotal_price) || 0,
        Number(b.discount_amount) || 0,
        Number(b.app_fee) || 0,
        total,
        b.technician?.name || "-",
        split.commission,
        split.net,
      ]
        .map(csvEscape)
        .join(";")
    );
  }

  lines.push("");
  lines.push([`Periode`, `${String(month).padStart(2, "0")}/${year}`].map(csvEscape).join(";"));
  lines.push([`Jumlah pesanan selesai`, rows.length].map(csvEscape).join(";"));
  lines.push(["Total pendapatan", totalRevenue].map(csvEscape).join(";"));
  lines.push(["Total komisi platform", totalCommission].map(csvEscape).join(";"));
  lines.push(["Diekspor", new Date().toLocaleString("id-ID")].map(csvEscape).join(";"));

  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Kumpulkan pesanan selesai dalam periode bulan kalender + ringkasan.
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
  const totalRevenue = rows.reduce((s, b) => s + (Number(b.total_price) || 0), 0);
  const totalCommission = rows.reduce(
    (s, b) => s + computeSplit(b.total_price, b.technician?.commission_rate ?? undefined).commission,
    0
  );

  return { rows, year: y, month: m, count: rows.length, totalRevenue, totalCommission };
}
