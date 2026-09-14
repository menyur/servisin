import { createClient } from "@/lib/supabase/server";
import ProfileEditor from "@/components/ProfileEditor";
import Link from "next/link";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-5 py-20 text-center">
        <p className="text-ink-soft mb-4">Kamu harus masuk untuk melihat profil.</p>
        <Link href="/login" className="btn-primary">Masuk</Link>
      </div>
    );
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  return <ProfileEditor initialProfile={profile} />;
}
