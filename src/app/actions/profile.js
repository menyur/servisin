"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateMyProfile({ name, phone, avatarUrl, bannerUrl }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Belum login." };
  if (!name || !name.trim()) return { error: "Nama tidak boleh kosong." };

  const updates = { name: name.trim(), phone: phone || null };
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
  if (bannerUrl !== undefined) updates.banner_url = bannerUrl;

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { profile: data };
}
