import { createClient } from "@/lib/supabase/server";
import BookingFlow from "@/components/BookingFlow";
import Link from "next/link";
import { LogIn } from "lucide-react";

export default async function BookingPage({ searchParams }) {
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: categories } = await supabase.from("categories").select("*").order("sort_order");
  const { data: services } = await supabase
    .from("services")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-5 py-20 text-center">
        <div className="card">
          <div className="w-12 h-12 rounded-full bg-brand-tint text-brand flex items-center justify-center mx-auto mb-4">
            <LogIn size={22} />
          </div>
          <h1 className="font-display text-xl text-navy mb-2">Masuk dulu untuk booking</h1>
          <p className="text-sm text-ink-soft mb-6">
            Supaya kamu bisa melacak status pesanan dan melihat riwayat booking, silakan masuk atau daftar akun terlebih dahulu.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/login" className="btn-primary">Masuk</Link>
            <Link href="/register" className="btn-outline">Daftar</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BookingFlow
      categories={categories || []}
      services={services || []}
      preselectedServiceId={params?.service || null}
    />
  );
}
