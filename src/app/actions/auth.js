"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { sendAdminNewApplicantEmail, sendAdminNewCustomerEmail } from "@/lib/email";
import { notifyAdminsOrDirect, adminEmailsForEvent } from "@/lib/admin-email";
import { kirimTautanReset } from "@/lib/password-reset";
import {
  kirimVerifikasiPendaftaran,
  metadataPendaftaran,
  ipDariHeader,
} from "@/lib/signup-verification";

export async function signUp(prevState, formData) {
  const name = formData.get("name");
  const email = formData.get("email");
  const phone = formData.get("phone");
  const password = formData.get("password");
  // Tujuan setelah daftar (mis. kembali ke alur booking); hanya path internal.
  const nextRaw = (formData.get("next") || "").toString();
  const nextPath = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;
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

  // Tujuan balik setelah link verifikasi diklik — Supabase menuntut URL absolut.
  // Prioritas: NEXT_PUBLIC_SITE_URL (produksi) → origin request saat ini (dev).
  const h = await headers();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    h.get("origin") ||
    "http://localhost:3000";

  // Akun dibuat lewat Admin API lalu emailnya dikirim Resend — BUKAN lewat
  // `supabase.auth.signUp`, yang selalu meminta mailer bawaan Supabase mengirim
  // email (hanya untuk anggota tim, 2 pesan/jam) sehingga pendaftaran pelanggan
  // biasa gagal begitu kuota itu habis. Lihat src/lib/signup-verification.js.
  const hasil = await kirimVerifikasiPendaftaran({
    email: String(email),
    password: String(password),
    data: metadataPendaftaran({ name, phone, address, role, skill, ktpUrl }),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    origin,
    ip: ipDariHeader(h),
    // Token Turnstile dari formulir (widget-nya ada di halaman /register bila
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY terisi). Jalur WEB selalu dijaga bila
    // kuncinya ada; lihat src/lib/signup-guard.js.
    turnstileToken: formData.get("cf-turnstile-response"),
    asal: "web",
  });

  if (!hasil.ok) {
    if (hasil.alasan === "email_tidak_valid") {
      return { error: "Format email tidak valid — periksa lagi penulisannya." };
    }
    if (hasil.alasan === "password_tidak_valid") {
      return { error: "Kata sandi terlalu pendek — minimal 6 karakter." };
    }
    if (hasil.alasan === "jeda") {
      return {
        error: `Email verifikasi baru saja dikirim ke alamat ini — tunggu ${hasil.sisaDetik} detik lagi.`,
      };
    }
    if (hasil.alasan === "jeda_ip" || hasil.alasan === "jeda_alamat" || hasil.alasan === "batas_harian") {
      // Pesannya datang dari pembatas (pembatas.pesan) supaya jumlah menit/jam
      // yang disebutkan selalu cocok dengan aturan yang menolaknya.
      return {
        error:
          hasil.pesan ||
          `Terlalu banyak pendaftaran dari jaringan ini — coba lagi dalam ${Math.ceil((hasil.sisaDetik || 60) / 60)} menit.`,
      };
    }
    if (hasil.alasan === "turnstile") {
      return { error: "Verifikasi keamanan gagal — muat ulang halaman lalu coba lagi." };
    }
    if (hasil.alasan === "env") {
      return { error: "Pendaftaran sedang tidak bisa mengirim email. Hubungi admin." };
    }
    return { error: "Gagal membuat akun. Coba lagi nanti." };
  }

  // Akun baru (teknisi maupun pelanggan) → email ke semua admin.
  // Jalur resminya ANTREAN BERSAMA (src/lib/admin-email.js) yang dipicu trigger
  // DB saat baris profiles dibuat — sehingga ketiga jalur (web, aplikasi,
  // Google OAuth) tercakup dan tidak pernah dobel. Blok di bawah hanya dipakai
  // sebagai fallback bila migrasi admin_email_outbox belum dijalankan.
  // Fire-and-forget: kegagalan email tidak boleh menggagalkan pendaftaran.
  await notifyAdminsOrDirect(supabase, async () => {
    // Penerima dibedakan per jenis pendaftaran (teknisi vs pelanggan) sesuai
    // pengaturan panel admin; sebelum migrasi = semua admin.
    const adminEmails = await adminEmailsForEvent(
      supabase,
      role === "technician" ? "new_technician" : "new_customer"
    );
    if (!adminEmails?.length) return;
    if (role === "technician") {
      await sendAdminNewApplicantEmail(adminEmails, {
        name,
        email,
        phone,
        address,
        skill: skill || "-",
        ktpUrl,
      });
    } else {
      await sendAdminNewCustomerEmail(adminEmails, { name, email, phone, address });
    }
  });

  redirect(nextPath || "/dashboard");
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

  // Tujuan eksplisit dari gate booking (?next=) — hanya path internal,
  // dan admin/teknisi tetap diarahkan ke panelnya masing-masing.
  const nextRaw = (formData.get("next") || "").toString();
  const nextPath = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;

  // landing dinamis sesuai role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();
  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "technician") redirect("/technician");
  redirect(nextPath || "/dashboard");
}

/** Kirim email tautan reset kata sandi (jalur web).
 *
 * Memakai src/lib/password-reset.js — bukan lagi `resetPasswordForEmail`, yang
 * bergantung pada mailer bawaan Supabase (hanya anggota tim project, 2 pesan/
 * jam) sehingga email reset pelanggan biasa tidak pernah berangkat walau
 * halaman ini berkata sukses. Tautannya kini dibuat server (service role) dan
 * dikirim lewat Resend.
 *
 * Alamat TANPA akun menghasilkan `{success:true}` yang sama — jangan bedakan,
 * itu jalan enumerasi akun. Yang boleh dibedakan cuma bentuk email salah, jeda
 * per alamat, dan server email belum siap (ketiganya tidak bergantung pada
 * ada/tidaknya akun). */
export async function requestPasswordReset(prevState, formData) {
  const email = formData.get("email");
  if (!email) {
    return { error: "Email wajib diisi." };
  }

  // Tujuan balik setelah link email diklik — Supabase menuntut URL absolut.
  // Prioritas: NEXT_PUBLIC_SITE_URL (produksi) → origin request saat ini (dev).
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "")
    || h.get("origin")
    || "http://localhost:3000";

  const hasil = await kirimTautanReset({
    email: String(email),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    origin,
  });

  if (!hasil.ok) {
    if (hasil.alasan === "email_tidak_valid") {
      return { error: "Masukkan alamat email yang benar." };
    }
    if (hasil.alasan === "jeda") {
      return { error: `Permintaan tautan baru saja dikirim — tunggu ${hasil.sisaDetik} detik lagi.` };
    }
    if (hasil.alasan === "env") {
      return { error: "Layanan email belum siap di server. Hubungi admin." };
    }
    return { error: "Gagal mengirim email reset. Coba lagi nanti." };
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
