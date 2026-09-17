// Buat akun uji teknisi lewat signup publik (anon key), lalu verifikasi
// profilnya otomatis terbuat dengan role=technician & approval_status=pending.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const stamp = Date.now().toString(36);
const email = `teknisi-uji-${stamp}@gmail.com`;
const password = "UjiTeknisi2026!";

async function main() {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name: "Teknisi Uji", phone: "081200000001", role: "technician", skill: "ac" } },
  });
  if (error) {
    console.error("Signup gagal:", error.message);
    process.exit(1);
  }
  console.log(`Akun dibuat: ${email} (userId: ${data.user?.id || "?"})`);
  if (data.user && !data.user.email_confirmed_at) {
    console.log("Catatan: email belum dikonfirmasi (fitur Confirm email aktif) — profil tetap terbuat via trigger.");
  }

  // beri waktu trigger jalan, lalu login sebagai user tsb (RLS mengizinkan baca profil sendiri)
  await new Promise((r) => setTimeout(r, 1500));
  const { data: login, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
  if (loginErr) {
    console.log(`LOGIN_GAGAL: ${loginErr.message}`);
    console.log("Kemungkinan fitur Confirm email aktif — verifikasi profil perlu dilakukan via SQL Editor:");
    console.log(`  select name, role, approval_status from profiles where email = '${email}';`);
    process.exit(3);
  }
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("name, role, approval_status")
    .eq("id", login.user.id)
    .maybeSingle();
  if (pErr) {
    console.error("Gagal membaca profil:", pErr.message);
    process.exit(1);
  }
  if (!profile) {
    console.log("PROFIL_TIDAK_DITEMUKAN — trigger handle_new_user mungkin belum ada di database.");
    process.exit(2);
  }
  console.log(`Profil: name=${profile.name} role=${profile.role} approval_status=${profile.approval_status}`);
  if (profile.role === "technician" && profile.approval_status === "pending") {
    console.log("SESUAI_HARAPAN: teknisi baru otomatis pending menunggu review admin.");
  } else {
    console.log("TIDAK_SESUAI_HARAPAN — cek trigger set_initial_approval_status / handle_new_user.");
    process.exit(2);
  }
}

main();
