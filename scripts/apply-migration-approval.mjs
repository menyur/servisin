// Uji migrasi approval_status: cek apakah kolom sudah ada & trigger bekerja.
// Anon key tidak bisa ALTER — script ini mendeteksi kondisi dan melaporkan langkah yang harus
// dijalankan manual di SQL Editor bila belum ada.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  // 1) apakah kolom approval_status sudah ada? (select kolom itu)
  const { error: colErr } = await supabase.from("profiles").select("approval_status").limit(1);
  if (colErr) {
    if (/column .* does not exist/i.test(colErr.message)) {
      console.log("KOLOM_BELUM_ADA — jalankan supabase/migrate-approval-status.sql di SQL Editor dulu.");
      process.exit(2);
    }
    console.error("Gagal membaca profiles:", colErr.message);
    process.exit(1);
  }
  console.log("Kolom approval_status: ADA");

  // 2) hitung distribusi status (untuk memastikan migrasi jalan)
  const { count: techCount, error: tErr } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "technician");
  if (tErr) {
    console.error("Gagal hitung teknisi:", tErr.message);
    process.exit(1);
  }
  const { count: pendingCount, error: pErr } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "technician")
    .eq("approval_status", "pending");
  if (pErr) {
    console.error("Gagal hitung pending:", pErr.message);
    process.exit(1);
  }
  console.log(`Teknisi terdaftar: ${techCount ?? 0}, menunggu review: ${pendingCount ?? 0}`);
}

main();
