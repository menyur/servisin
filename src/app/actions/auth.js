"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

export async function signUp(prevState, formData) {
  const name = formData.get("name");
  const email = formData.get("email");
  const phone = formData.get("phone");
  const password = formData.get("password");
  // Form publik hanya boleh mendaftar sebagai customer atau technician.
  const requestedRole = formData.get("role");
  const role = requestedRole === "technician" ? "technician" : "customer";
  const skill = formData.get("skill") || null;
  // Data kurasi teknisi: alamat domisili + path foto KTP di Storage (privat).
  const address = (formData.get("address") || "").toString().trim() || null;
  const ktpUrl = (formData.get("ktp_url") || "").toString().trim() || null;

  if (!name || !email || !password) {
    return { error: "Nama, email, dan kata sandi wajib diisi." };
  }
  if (password.length < 6) {
    return { error: "Kata sandi minimal 6 karakter." };
  }
  if (role === "technician" && !address) {
    return { error: "Alamat domisili wajib diisi untuk pendaftaran teknisi." };
  }
  if (role === "technician" && !ktpUrl) {
    return { error: "Foto KTP wajib diunggah untuk verifikasi identitas." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone, role, skill, address, ktp_url: ktpUrl } },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function signIn(prevState, formData) {
  const email = formData.get("email");
  const password = formData.get("password");

  if (!email || !password) {
    return { error: "Email dan kata sandi wajib diisi." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Email atau kata sandi salah." };
  }

  revalidatePath("/", "layout");

  // landing dinamis sesuai role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();
  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "technician") redirect("/technician");
  redirect("/dashboard");
}

/** Kirim email reset password. Selalu sukses dari sudut pandang user
 * (jangan bocorkan apakah email terdaftar). */
export async function requestPasswordReset(prevState, formData) {
  const email = formData.get("email");
  if (!email) {
    return { error: "Email wajib diisi." };
  }

  const supabase = await createClient();
  // Redirect setelah link email diklik — Supabase menuntut URL absolut.
  // Prioritas: NEXT_PUBLIC_SITE_URL (produksi) → origin request saat ini (dev).
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "")
    || h.get("origin")
    || "http://localhost:3000";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  if (error) {
    return { error: "Gagal mengirim email reset: " + error.message };
  }

  return { success: true, email };
}

/** Simpan kata sandi baru (dijalankan setelah user klik link di email). */
export async function updatePassword(prevState, formData) {
  const password = formData.get("password");
  const confirm = formData.get("confirm");

  if (!password || password.length < 6) {
    return { error: "Kata sandi baru minimal 6 karakter." };
  }
  if (password !== confirm) {
    return { error: "Konfirmasi kata sandi tidak cocok." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sesi reset tidak valid atau sudah kedaluwarsa — minta link baru." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Gagal mengganti kata sandi: " + error.message };
  }

  return { success: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
