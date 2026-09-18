// Buat semua bucket Storage yang dipakai aplikasi Servisin — otomatis & idempoten.
// Memakai SUPABASE_SERVICE_ROLE_KEY (Storage API), jadi tidak terkena error 42501
// yang kadang memblokir insert storage.buckets di SQL Editor.
//
// Pemakaian:  node scripts/setup-storage.mjs
// Policy RLS storage dibuat lewat supabase/setup-storage-buckets.sql (bagian 2) —
// script ini hanya membuat bucket + menyetel flag public-nya.
// Tidak pernah mencetak nilai secret — hanya nama env & hasil operasi.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// --- muat .env.local tanpa dependency ---
const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("✗ BUTUH env di .env.local: NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY");
  console.error("  Service role key: Supabase Dashboard → Settings → API → service_role (secret).");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

// [nama bucket, public?] — public=true berarti bisa dibaca via getPublicUrl
const BUCKETS = [
  ["service-images", true],   // thumbnail layanan (tampil di landing page)
  ["payment-proofs", true],   // bukti transfer (dilihat admin & struk)
  ["balance-proofs", true],   // bukti setor saldo teknisi (dilihat admin)
  ["attachments", true],      // foto kondisi/kerusakan booking
  ["profile-media", true],    // avatar & banner profil
  ["receipts", false],        // PDF struk ter-arsip (akses via UI)
  ["laporan-bulanan", false], // CSV laporan bulanan cron (admin-only)
];

const host = url.replace(/^https?:\/\//, "").split(".")[0];
console.log(`Cek/membuat ${BUCKETS.length} bucket di project ${host}…\n`);

const { data: existing, error: listErr } = await supabase.storage.listBuckets();
if (listErr) {
  console.error("✗ Gagal list bucket:", listErr.message);
  process.exit(1);
}
const byId = new Map(existing.map((b) => [b.id, b]));

let created = 0, skipped = 0, fixed = 0, failed = 0;

for (const [name, isPublic] of BUCKETS) {
  const cur = byId.get(name);
  if (cur) {
    if (cur.public !== isPublic) {
      const { error } = await supabase.storage.updateBucket(name, { public: isPublic });
      if (error) { console.log(`~ ${name}: GAGAL set public=${isPublic} — ${error.message}`); failed++; }
      else { console.log(`~ ${name}: flag public diperbarui → ${isPublic}`); fixed++; }
    } else {
      console.log(`= ${name}: sudah ada (public=${cur.public}) — lewati`);
      skipped++;
    }
    continue;
  }
  const { error } = await supabase.storage.createBucket(name, { public: isPublic });
  if (error) { console.log(`✗ ${name}: ${error.message}`); failed++; }
  else { console.log(`+ ${name}: dibuat (public=${isPublic})`); created++; }
}

console.log(`\nSelesai: ${created} dibuat, ${skipped} sudah ada, ${fixed} flag diperbarui${failed ? `, ${failed} GAGAL` : ""}.`);
console.log("Terakhir: jalankan supabase/setup-storage-buckets.sql di SQL Editor bila policy storage belum ada.");
