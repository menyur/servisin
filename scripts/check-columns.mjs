// Probe status kolom via anon key (RLS menyaring baris, tapi error "column does not exist"
// tetap terlihat — cara aman mendeteksi apakah migrasi sudah dijalankan).
// Tidak mencetak nilai rahasia.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function probe(table, column) {
  const { error } = await client.from(table).select(column).limit(1);
  if (!error) return true;
  if (/column .* does not exist/i.test(error.message)) return false;
  // error lain (mis. RLS) tetap menandakan tabel ada
  if (/relation .* does not exist/i.test(error.message)) return null; // tabel tidak ada
  return true;
}

console.log("categories (tabel):", (await probe("categories", "id")) === null ? "TIDAK ADA" : "ada");
console.log("profiles.approval_status:", (await probe("profiles", "approval_status")) ? "ada" : "BELUM");
console.log("profiles.commission_rate:", (await probe("profiles", "commission_rate")) ? "ada" : "BELUM (jalankan migrasi / tambah via Table Editor)");
console.log("reports (tabel):", (await probe("reports", "id")) === null ? "TIDAK ADA" : "ada");
