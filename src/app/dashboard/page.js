import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyBookings } from "@/app/actions/bookings";
import { formatRupiah } from "@/lib/pricing";
import { StatusPill } from "@/components/StatusPipeline";
import { PlusCircle } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-5 py-20 text-center">
        <p className="text-ink-soft mb-4">Kamu harus masuk untuk melihat dashboard.</p>
        <Link href="/login" className="btn-primary">Masuk</Link>
      </div>
    );
  }

  const { bookings } = await getMyBookings();

  return (
    <div className="max-w-3xl mx-auto px-5 py-12">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <h1 className="font-display text-2xl text-navy">Riwayat Pesanan</h1>
        <Link href="/booking" className="btn-primary !py-2 text-sm">
          <PlusCircle size={16} /> Booking baru
        </Link>
      </div>

      {bookings.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-ink-soft mb-4">Kamu belum punya pesanan.</p>
          <Link href="/#kategori" className="btn-primary">Cari layanan</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((b) => (
            <div key={b.id} className="card">
              <div className="flex justify-between items-start flex-wrap gap-2 mb-2">
                <div>
                  <p className="font-display font-bold text-navy">{b.code}</p>
                  <p className="text-sm text-ink-soft">{b.services?.name}</p>
                </div>
                <StatusPill status={b.status} />
              </div>
              <div className="text-sm text-ink-soft grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3">
                <span>Jadwal: {b.booking_date} · {b.booking_time}</span>
                <span>Metode bayar: {paymentLabel(b.payment_method)}</span>
                <span>Total: {formatRupiah(b.total_price)}</span>
                <span>Alamat: {b.address}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function paymentLabel(m) {
  return { qris: "QRIS", virtual_account: "Virtual Account", e_wallet: "E-Wallet", cod: "Cash on Delivery" }[m] || m;
}
