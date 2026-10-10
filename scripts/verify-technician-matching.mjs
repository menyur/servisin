// ============================================================================
// verify-technician-matching.mjs — probe BACA-SAJA: apakah pekerjaan yang
// sudah dibayar benar-benar bisa "otomatis" sampai ke teknisi lewat
// pencocokan keahlian (skill) + area, tanpa penugasan admin?
//
// Latar (temuan produksi 9 Okt 2026): RPC available_jobs()/claim_job()
// mencocokkan services.category_id = profiles.skill, tetapi ada baris lama
// berisi LABEL ('Service AC') alih-alih ID kategori ('ac') → teknisi
// melihat 0 pekerjaan. Skrip ini memeriksa kondisi nyata dan memakai
// aturan baru yang toleran (id ATAU nama kategori), sama dengan
// supabase/fix-technician-skill-matching.sql, src/lib/skill-match.js, dan
// flutter_app/lib/models.dart.
//
// TIDAK membuat/mengubah data apa pun. Tidak pernah mencetak rahasia atau
// PII (hanya id kategori, kode pesanan, dan angka).
//
// Exit code: 0 = sehat, 1 = ada masalah pencocokan, 3 = kredensial tak ada.
//   npm run verify:matching
// ============================================================================
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";
// Aturan NYATA yang dipakai web-push, FCM, dan klien — tidak diduplikasi.
import {
  normalizeCategoryToken as norm,
  skillMatchesCategory as skillMatches,
  areaMatchesBooking as areaMatches,
} from "../src/lib/skill-match.js";

let env;
try {
  env = loadEnv();
} catch (err) {
  console.log(`⚠️  Kredensial probe tidak tersedia (${err.missing?.join(", ") || err.message}).`);
  console.log("   Isi .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) lalu ulangi.");
  process.exit(3);
}

const admin = makeAdminClient(env);
const problems = [];

// ---- 1) Katalog kategori (sumber kebenaran id ↔ nama) ----
const { data: categories, error: catErr } = await admin.from("categories").select("id, name");
if (catErr) {
  console.log(`🔴 Gagal membaca categories: ${catErr.message}`);
  process.exit(1);
}
const catIds = new Set((categories || []).map((c) => c.id));
const catName = new Map((categories || []).map((c) => [c.id, c.name]));

// ---- 2) Skill teknisi: kanonik(id) / label→id / tak dikenal / kosong ----
const { data: techs, error: techErr } = await admin
  .from("profiles")
  .select("id, skill, service_area, approval_status")
  .eq("role", "technician");
if (techErr) {
  console.log(`🔴 Gagal membaca profiles teknisi: ${techErr.message}`);
  process.exit(1);
}

const buckets = { canonical: [], label: [], unknown: [], empty: [] };
for (const t of techs || []) {
  const s = norm(t.skill);
  if (!s) {
    buckets.empty.push(t);
  } else if (catIds.has(s)) {
    buckets.canonical.push(t);
  } else {
    const byName = (categories || []).find((c) => norm(c.name) === s);
    // Kata kunci label pendaftaran (paritas migrasi normalisasi)
    const keyword =
      /^service ac/.test(s) ? "ac"
      : /^service kendaraan/.test(s) ? "kendaraan"
      : /^kebersihan/.test(s) ? "kebersihan"
      : /tukang/.test(s) ? "tukang"
      : null;
    if (byName || keyword) buckets.label.push({ ...t, normalized: byName?.id || keyword });
    else buckets.unknown.push(t);
  }
}

console.log("TEKNISI");
console.log(`  total                 : ${techs?.length ?? 0}`);
console.log(`  approved              : ${(techs || []).filter((t) => t.approval_status === "approved").length}`);
console.log(`  skill id kanonik      : ${buckets.canonical.length}`);
console.log(`  skill LABEL (perlu fix): ${buckets.label.length}${buckets.label.length ? ` → ${[...new Set(buckets.label.map((t) => `${t.skill}=>${t.normalized}`))].join(", ")}` : ""}`);
console.log(`  skill tak dikenal     : ${buckets.unknown.length}${buckets.unknown.length ? ` → ${[...new Set(buckets.unknown.map((t) => t.skill))].join(", ")}` : ""}`);
console.log(`  tanpa skill (semua)   : ${buckets.empty.length}`);
if (buckets.label.length) {
  problems.push(`${buckets.label.length} teknisi ber-skill LABEL — jalankan supabase/fix-technician-skill-matching.sql`);
}
if (buckets.unknown.length) {
  problems.push(`${buckets.unknown.length} teknisi ber-skill tak dikenal (perbaiki manual di panel admin)`);
}

// ---- 3) Pekerjaan terbuka (paid, belum diambil) ----
const approved = (techs || []).filter((t) => t.approval_status === "approved");
const { data: bookings, error: bErr } = await admin
  .from("bookings")
  .select("id, code, address, service_id")
  .eq("status", "paid")
  .is("technician_id", null);
if (bErr) {
  console.log(`🔴 Gagal membaca bookings: ${bErr.message}`);
  process.exit(1);
}
const { data: services } = await admin.from("services").select("id, category_id");
const svcCat = new Map((services || []).map((s) => [s.id, s.category_id]));

console.log("\nPEKERJAAN TERBUKA (status paid & belum diambil)");
console.log(`  jumlah                : ${bookings?.length ?? 0}`);
let reachable = 0;
for (const b of bookings || []) {
  const catId = svcCat.get(b.service_id) || null;
  const cName = catId ? catName.get(catId) : null;
  const skillMatch = approved.filter((t) => skillMatches(t.skill, catId, cName));
  const areaSkill = skillMatch.filter((t) => areaMatches(t.service_area, b.address));
  if (skillMatch.length) reachable++;
  console.log(
    `  ${b.code} · kategori=${catId ?? "?"} → ${skillMatch.length} teknisi cocok keahlian` +
      ` (${areaSkill.length} juga cocok area)`
  );
  if (!skillMatch.length) {
    problems.push(`pesanan ${b.code} (kategori ${catId ?? "?"}) tak punya teknisi approved yang cocok`);
  }
}

// ---- Ringkasan ----
console.log("\nRINGKASAN");
if (!problems.length) {
  console.log("✅ Pencocokan keahlian+area sehat: setiap pekerjaan terbuka terjangkau teknisi,");
  console.log("   dan tidak ada skill teknisi yang tak dikenali.");
  process.exit(0);
}
console.log("🔴 Masalah ditemukan:");
for (const p of problems) console.log(`   - ${p}`);
console.log(`   pekerjaan terjangkau: ${reachable}/${bookings?.length ?? 0}`);
process.exit(1);
