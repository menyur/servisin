import { createClient } from "@/lib/supabase/server";
import { getMyBookings } from "@/app/actions/bookings";
import DashboardClient from "@/components/DashboardClient";
import { bacaReviewReward } from "@/lib/review-reward";
import { redirect } from "next/navigation";
import Link from "next/link";

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

  // admin & teknisi tidak punya urusan dengan dashboard pelanggan —
  // arahkan langsung ke panel masing-masing
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "technician") redirect("/technician");

  const { bookings } = await getMyBookings();
  // Insentif penilaian yang sedang berlaku (diatur admin di panel). Dipakai
  // banner pengingat & tab Voucher Saya supaya janji angkanya sama dengan
  // voucher yang benar-benar terbit. Gagal baca → nilai bawaan.
  const reward = await bacaReviewReward(supabase);

  return (
    <DashboardClient
      initialBookings={bookings}
      customerName={profile?.name || "Pelanggan"}
      customerPhone={profile?.phone || ""}
      reviewReward={{ amount: reward.amount, validDays: reward.validDays, delayDays: reward.delayDays }}
    />
  );
}
