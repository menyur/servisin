import { createClient } from "@/lib/supabase/server";
import {
  getAllBookingsAdmin,
  getAllServicesAdmin,
  getAllUsersAdmin,
  getAllReportsAdmin,
  getAllVouchersAdmin,
  getBalanceDepositsAdmin,
  getWithdrawalsAdmin,
  getFinanceSummaryAdmin,
  getAllBannersAdmin,
  getTechnicianBalancesAdmin,
  getAllReviewsAdmin,
  getDailyOpsBoardAdmin,
  getAccountDeletionSummaryAdmin,
} from "@/app/actions/admin";
import AdminDashboard from "@/components/AdminDashboard";
import Link from "next/link";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-5 py-20 text-center">
        <p className="text-ink-soft mb-4">Kamu harus masuk sebagai admin untuk membuka halaman ini.</p>
        <Link href="/login" className="btn-primary">Masuk</Link>
      </div>
    );
  }

  const [bookingsRes, servicesRes, usersRes, reportsRes, vouchersRes, categoriesRes, depositsRes, withdrawalsRes, financeRes, bannersRes, techBalancesRes, reviewsRes, boardRes, accountDeletionRes] = await Promise.all([
    getAllBookingsAdmin(),
    getAllServicesAdmin(),
    getAllUsersAdmin(),
    getAllReportsAdmin(),
    getAllVouchersAdmin(),
    supabase.from("categories").select("id, name").order("sort_order"),
    getBalanceDepositsAdmin().catch(() => ({ error: "Gagal memuat pengajuan setor." })),
    getWithdrawalsAdmin().catch(() => ({ error: "Gagal memuat pengajuan penarikan." })),
    getFinanceSummaryAdmin().catch(() => ({ error: "Gagal memuat ringkasan keuangan." })),
    getAllBannersAdmin().catch(() => ({ error: "Gagal memuat banner." })),
    getTechnicianBalancesAdmin().catch(() => ({ error: "Gagal memuat saldo teknisi." })),
    getAllReviewsAdmin().catch(() => ({ error: "Gagal memuat penilaian teknisi." })),
    // Papan harian dimuat di server supaya tab pembuka tidak berkedip kosong.
    getDailyOpsBoardAdmin().catch(() => ({ error: "Gagal memuat papan harian." })),
    // Hanya hitungan untuk lencana tab. Tabel yang belum dimigrasikan bukan
    // kegagalan halaman — tabnya sendiri yang menjelaskannya.
    getAccountDeletionSummaryAdmin().catch(() => ({ error: "Gagal memuat antrean hapus akun." })),
  ]);

  if (bookingsRes.error) {
    return (
      <div className="max-w-md mx-auto px-5 py-20 text-center">
        <p className="text-coral font-medium">{bookingsRes.error}</p>
        <p className="text-ink-soft text-sm mt-2">
          Untuk mengaktifkan akses admin, ubah kolom <code>role</code> pada tabel <code>profiles</code> akun kamu menjadi <code>&apos;admin&apos;</code> lewat Supabase Table Editor.
        </p>
      </div>
    );
  }

  return (
    <AdminDashboard
      initialBookings={bookingsRes.bookings}
      initialServices={servicesRes.services || []}
      initialUsers={usersRes.users || []}
      initialReports={reportsRes.error ? [] : reportsRes.reports}
      initialVouchers={vouchersRes.error ? [] : vouchersRes.vouchers || []}
      vouchersError={vouchersRes.error || null}
      categories={categoriesRes.data || []}
      balanceDeposits={depositsRes.deposits || []}
      balanceDepositsError={depositsRes.error || null}
      withdrawals={withdrawalsRes.withdrawals || []}
      withdrawalsError={withdrawalsRes.error || null}
      financeSummary={financeRes.summary || null}
      initialBanners={bannersRes.banners || []}
      bannersError={bannersRes.error || null}
      initialTechnicianBalances={techBalancesRes.technicians || []}
      technicianBalancesError={techBalancesRes.error || null}
      initialTechnicianAppFee={techBalancesRes.appFeeReport || []}
      technicianAppFeeTotal={techBalancesRes.appFeeReportTotal || null}
      initialPiutangUmur={techBalancesRes.piutangUmur || null}
      piutangAmbangHari={techBalancesRes.ambangHari || null}
      initialReviews={reviewsRes.reviews || []}
      reviewsSummary={reviewsRes.summary || null}
      reviewsByTechnician={reviewsRes.byTechnician || []}
      reviewsError={reviewsRes.error || null}
      board={boardRes.board || null}
      boardError={boardRes.error || null}
      accountDeletionSummary={accountDeletionRes?.error ? null : accountDeletionRes}
    />
  );
}
