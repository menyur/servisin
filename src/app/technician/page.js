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

  return (
    <TechnicianDashboard
      initialBookings={bookings}
      technicianName={profile?.name}
      commissionRate={Number(profile?.commission_rate ?? 10)}
      myRating={myRating}
    />
  );
}
