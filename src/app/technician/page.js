import { createClient } from "@/lib/supabase/server";
import { getMyAssignments } from "@/app/actions/technician";
import TechnicianDashboard from "@/components/TechnicianDashboard";
import Link from "next/link";

export default async function TechnicianPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-5 py-20 text-center">
        <p className="text-ink-soft mb-4">Kamu harus masuk untuk membuka halaman ini.</p>
        <Link href="/login" className="btn-primary">Masuk</Link>
      </div>
    );
  }

  // select * supaya aman sebelum migrasi commission_rate dijalankan (kolom opsional)
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (profile?.role !== "technician" && profile?.role !== "admin") {
    return (
      <div className="max-w-md mx-auto px-5 py-20 text-center">
        <p className="text-coral font-medium">Halaman ini khusus untuk akun teknisi.</p>
        <p className="text-ink-soft text-sm mt-2">
          Kalau kamu seharusnya jadi teknisi, minta admin untuk mengubah role akunmu lewat panel admin.
        </p>
      </div>
    );
  }

  const { bookings, myRating } = await getMyAssignments();

  // saldo aktif + riwayat mutasi + pengajuan setor (aman bila migrasi belum dijalankan)
  let balance = Number(profile?.balance ?? 0);
  let transactions = [];
  const { data: tx, error: txErr } = await supabase
    .from("balance_transactions")
    .select("id, type, amount, commission_amount, note, created_at")
    .eq("technician_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!txErr && tx) transactions = tx;

  let deposits = [];
  const { data: deps, error: depErr } = await supabase
    .from("balance_deposits")
    .select("id, amount, status, rejection_reason, created_at")
    .eq("technician_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!depErr && deps) deposits = deps;

  return (
    <TechnicianDashboard
      initialBookings={bookings}
      technicianName={profile?.name}
      commissionRate={Number(profile?.commission_rate ?? 10)}
      myRating={myRating}
      balance={balance}
      transactions={transactions}
      deposits={deposits}
    />
  );
}
