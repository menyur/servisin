// Verifikasi akun uji teknisi yang SUDAH dibuat sebelumnya (tanpa signup baru — hindari rate limit).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const email = "teknisi-uji-mu25gyrj@gmail.com";
const password = "UjiTeknisi2026!";

async function main() {
  const { data: login, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
  if (loginErr) {
    console.log(`LOGIN_GAGAL: ${loginErr.message}`);
    console.log("Jika 'Email not confirmed': konfirmasi email dulu, atau cek via SQL Editor:");
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
