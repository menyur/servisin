// ============================================================================
// verify-job-target-fallback.mjs — jaga notifikasi "pekerjaan baru" terus
// terkirim walau alamat pesanan tidak memuat nama area teknisi.
//
// LATAR (temuan probe live 11 Okt 2026): filter area mencocokkan TEKS
// `service_area` di dalam `bookings.address`. Pelanggan yang menulis alamat
// tanpa nama area — mis. "griya reang indah blok B2" padahal teknisi ber-area
// "Serang" — membuat TIDAK ADA teknisi yang cocok, sehingga broadcast tidak
// dikirim ke siapa pun dan pekerjaan menggantung. (Pin map tidak menolong:
// alamat tetap teks bebas.) Contoh nyata: 5 dari 8 pesanan terbaru mendapat
// 0 teknisi cocok.
//
// Perbaikan: `selectJobTargets` (src/lib/skill-match.js) berlapis fail-open →
// area+keahlian → keahlian → semua. Dipakai web-push, FCM, tawaran tugas
// dilepas, dan dicerminkan di aplikasi (jobs_screen.dart).
//
// Uji A: kasus murni. Uji B: data ledger NYATA (bila kredensial tersedia).
// Exit: 0 lulus, 1 regresi, 3 bagian B dilewati.
// Jalankan: npm run verify:job-target
// ============================================================================
import { selectJobTargets, technicianReceivesJob } from "../src/lib/skill-match.js";
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";

let failed = 0;

function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

const TECH_SERANG = { id: "t1", skill: "ac", service_area: "Serang" };
const TECH_TANPA_AREA = { id: "t2", skill: "ac", service_area: null };
const TECH_SKILL_BEDA = { id: "t3", skill: "kebersihan", service_area: "Serang" };

step("A. Pemilihan penerima berlapis (fail-open)");
{
  const r = selectJobTargets([TECH_SERANG, TECH_TANPA_AREA, TECH_SKILL_BEDA], {
    categoryId: "ac",
    categoryName: "Service AC",
    address: "Jl. Merdeka No. 1, Serang",
  });
  check("alamat cocok area → mode area_skill", r.mode === "area_skill", r.mode);
  check("hanya teknisi area+keahlian cocok", r.targets.length === 2 && r.targets.every((t) => t.skill === "ac"), r.targets.map((t) => t.id).join(","));
}

{
  // Kasus bug: alamat tanpa nama area → dulu 0 penerima, kini jatuh ke keahlian.
  const techs = [TECH_SERANG, TECH_SKILL_BEDA];
  const alamat = "griya reang indah blok B2 no38";
  const dulu = techs.filter((t) => technicianReceivesJob(t, { categoryId: "ac", categoryName: "Service AC", address: alamat }));
  const r = selectJobTargets(techs, { categoryId: "ac", categoryName: "Service AC", address: alamat });
  check("aturan lama menghasilkan 0 penerima (bug)", dulu.length === 0, `${dulu.length}`);
  check("fallback memberi penerima berkeahlian cocok", r.mode === "skill" && r.targets.length === 1 && r.targets[0].id === "t1", `${r.mode}:${r.targets.length}`);
}

{
  const r = selectJobTargets([TECH_SERANG, TECH_SKILL_BEDA], {
    categoryId: "motor",
    categoryName: "Service Motor",
    address: "griya reang indah",
  });
  check("keahlian tidak terbaca juga → semua kandidat", r.mode === "all" && r.targets.length === 2, r.mode);
}

{
  const r = selectJobTargets([], { categoryId: "ac", address: "x" });
  check("daftar teknisi kosong → targets kosong", r.targets.length === 0 && r.mode === "all");
}

{
  // Teknisi tanpa area tetap menerima pekerjaan di area mana pun (perilaku lama).
  const r = selectJobTargets([TECH_TANPA_AREA], { categoryId: "ac", address: "alamat apa pun" });
  check("service_area kosong = tanpa filter area", r.mode === "area_skill" && r.targets.length === 1, r.mode);
}

step("A2. Pemanggil memakai helper bersama (bukan filter sendiri)");
const fs = await import("node:fs");
for (const f of ["src/lib/push.js", "src/lib/fcm.js", "src/lib/job-offer.js"]) {
  const s = fs.readFileSync(f, "utf8");
  check(`${f} memakai selectJobTargets`, s.includes("selectJobTargets(") && !s.includes("technicianReceivesJob("), "");
}
check(
  "aplikasi Flutter mencerminkan fallback yang sama",
  fs.readFileSync("flutter_app/lib/ui/jobs_screen.dart", "utf8").includes("fallbackAktif")
);

step("B. Data nyata: pesanan tanpa teknisi cocok");
let env = null;
try {
  env = loadEnv();
} catch (err) {
  console.log(`ℹ️  kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — bagian B dilewati.`);
}

if (env) {
  const admin = makeAdminClient(env);
  const { data: techs } = await admin
    .from("profiles")
    .select("id, name, service_area, skill")
    .eq("role", "technician")
    .eq("approval_status", "approved");
  const { data: bks } = await admin
    .from("bookings")
    .select("code, address, services(category_id, categories(name))")
    .in("status", ["paid", "in_progress", "pending"])
    .order("created_at", { ascending: false })
    .limit(25);

  let nolDulu = 0;
  let nolSekarang = 0;
  let menyusut = 0;
  for (const b of bks || []) {
    const criteria = {
      categoryId: b.services?.category_id || null,
      categoryName: b.services?.categories?.name || null,
      address: b.address,
    };
    const dulu = (techs || []).filter((t) => technicianReceivesJob(t, criteria)).length;
    const { targets } = selectJobTargets(techs || [], criteria);
    if (dulu === 0) nolDulu++;
    if (targets.length === 0 && (techs || []).length > 0) nolSekarang++;
    // Fallback hanya boleh MENAMBAH penerima, tidak pernah mengurangi.
    if (targets.length < dulu) menyusut++;
  }
  console.log(`   ${bks?.length || 0} pesanan terbuka diperiksa · ${techs?.length || 0} teknisi approved.`);
  console.log(`   ℹ️  aturan lama: ${nolDulu} pesanan terbuka TIDAK punya penerima (inilah bug yang dilaporkan).`);
  check("fallback tidak pernah mengurangi jumlah penerima", menyusut === 0, `${menyusut} pesanan menyusut`);
  check("setelah fallback: TIDAK ada pesanan tanpa penerima", nolSekarang === 0, `${nolSekarang}`);
}

console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"}`);
process.exit(failed === 0 ? 0 : 1);
