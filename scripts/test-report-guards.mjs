// Uji bagian alur laporan yang TIDAK butuh sesi user:
//  1. Guard RLS dari anon: insert harus ditolak, select harus 0 baris
//  2. Simulasi email admin + email resolved (tanpa RESEND_API_KEY -> cetak ke log)
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

console.log("=== 1. Guard RLS dari anon ===");
const ins = await client
  .from("reports")
  .insert({ author_role: "customer", title: "percobaan anon", content: "x" });
console.log(ins.error ? `Insert anon DITOLAK (benar): ${ins.error.message.slice(0, 90)}` : "!! Insert anon DITERIMA — RLS bocor!");

const sel = await client.from("reports").select("*").limit(10);
if (sel.error) {
  console.log(`Select anon DITOLAK (benar): ${sel.error.message.slice(0, 90)}`);
} else {
  console.log(`Select anon: ${sel.data.length} baris terlihat (0 = benar, anon tidak boleh melihat laporan siapa pun).`);
}

console.log("\n=== 2. Simulasi email (tanpa RESEND_API_KEY -> cetak ke log) ===");
const emailMod = await import("../src/lib/email.js");
await emailMod.sendAdminNewReportEmail(["admin@fixify.test"], {
  author_role: "technician",
  title: "[UJI] Laporan pekerjaan SV-0001",
  content: "Kondisi sebelum: AC mati total.\nKondisi sesudah: dingin normal, kapasitor diganti.",
  author_name: "Teknisi Uji",
  author_email: "teknisi@uji.test",
  booking_code: "SV-0001",
});
await emailMod.sendReportResolvedEmail("pelanggan@uji.test", {
  reporter_name: "Pelanggan Uji",
  title: "[UJI] Laporan pekerjaan SV-0001",
  booking_code: "SV-0001",
  admin_note: "Sudah kami periksa, kapasitor digaransi 30 hari. Terima kasih!",
});
console.log("(Dua blok '[email disimulasikan]' di atas = template email yang akan dikirim Resend saat API key terisi.)");
