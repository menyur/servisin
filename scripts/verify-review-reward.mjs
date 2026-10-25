// ============================================================================
// verify-review-reward.mjs — jaga setelan INSENTIF VOUCHER PENILAIAN (panel
// admin → tab "Voucher Penilaian") tetap SATU ANGKA di semua jalur.
//
// Latar: dulu nominal (2.000), masa berlaku (90 hari), dan jeda terbit (0)
// adalah konstanta di src/lib/pricing.js yang DISALIN LAGI di
// flutter_app/lib/api.dart. Mengubah insentif berarti menyunting dua tempat,
// deploy web, dan merilis APK baru — dan mudah berubah setengah jalan (web
// 5.000, aplikasi masih 2.000 untuk insentif yang sama).
//
// Invarian yang dijaga di sini:
//   1. Setelan dibaca lewat SATU pintu (src/lib/review-reward.js) dengan
//      fallback bawaan, bukan 0 — gangguan baca tidak boleh menghapus insentif
//      yang sudah dijanjikan.
//   2. Penerbit voucher web memakai nilai itu (bukan konstanta) dan menghormati
//      nominal 0 = insentif dimatikan.
//   3. Aplikasi Flutter membaca RPC yang sama (review_reward_efektif), juga
//      dengan fallback bawaan + penghormatan nominal 0.
//   4. Aksi simpan admin dijaga admin, dijepit batas, dan tercatat di audit;
//      tabnya benar-benar terpasang di panel.
//   5. Halaman yang MENJANJIKAN angka (panduan, syarat, banner dashboard, tab
//      Voucher Saya) membaca setelan, bukan konstanta.
//   6. (live, read-only) setelan == RPC, rentang sah, dan anon ditolak.
//
// Exit: 0 = lulus, 1 = regresi, 3 = bagian live dilewati (tanpa kredensial).
// Jalankan: npm run verify:review-reward
// ============================================================================
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalisasiReviewReward,
  REVIEW_REWARD_AMOUNT_MAKS,
  REVIEW_REWARD_BAWAAN,
  REVIEW_REWARD_DELAY_DAYS_MAKS,
  REVIEW_REWARD_VALID_DAYS_MAKS,
} from "../src/lib/review-reward.js";
import { loadEnv, makeAdminClient, makeAnonClient } from "./lib/probe-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

let failed = 0;
let skippedLive = false;

function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

// ------------------------------------------------------- 1) penjepitan nilai
step("1. Penjepitan setelan (dipakai baca & simpan)");

const clamp = (o) => normalisasiReviewReward(o);
check("bawaan: 2.000 / 90 hari / jeda 0", JSON.stringify(clamp({})) === JSON.stringify(REVIEW_REWARD_BAWAAN), JSON.stringify(clamp({})));
check("nominal negatif → 0 (insentif mati, bukan error)", clamp({ amount: -500 }).amount === 0);
check(`nominal dijepit di ${REVIEW_REWARD_AMOUNT_MAKS}`, clamp({ amount: 999999 }).amount === REVIEW_REWARD_AMOUNT_MAKS);
check("masa berlaku 0 hari → minimal 1", clamp({ validDays: 0 }).validDays === 1);
check(`masa berlaku dijepit di ${REVIEW_REWARD_VALID_DAYS_MAKS}`, clamp({ validDays: 9999 }).validDays === REVIEW_REWARD_VALID_DAYS_MAKS);
check(`jeda terbit dijepit di ${REVIEW_REWARD_DELAY_DAYS_MAKS}`, clamp({ delayDays: 9999 }).delayDays === REVIEW_REWARD_DELAY_DAYS_MAKS);
check(
  "nilai tak terbaca → BAWAAN, bukan 0",
  clamp({ amount: "abc", validDays: null, delayDays: undefined }).amount === REVIEW_REWARD_BAWAAN.amount
);
check("nominal 0 tetap sah (kampanye berakhir tanpa deploy)", clamp({ amount: 0 }).amount === 0);

// --------------------------------------------------- 2) satu pintu pembacaan
step("2. Web membaca setelan lewat satu pintu");
const lib = read("src/lib/review-reward.js");
check(
  "pembaca membaca ketiga kolom app_settings",
  /from\("app_settings"\)/.test(lib) &&
    /review_reward_amount/.test(lib) &&
    /review_reward_valid_days/.test(lib) &&
    /review_reward_delay_days/.test(lib)
);
check("pembacaan gagal → BAWAAN (bukan 0)", /sumber: "bawaan"/.test(lib) && /REVIEW_REWARD_BAWAAN/.test(lib));
check("ada deteksi migrasi belum jalan", /migrasi belum dijalankan/.test(lib));

const reviews = read("src/app/actions/reviews.js");
check("penerbit voucher web memakai bacaReviewReward()", /bacaReviewReward\(supabase\)/.test(reviews));
check("web memakai reward.amount (bukan konstanta)", /amount:\s*reward\.amount/.test(reviews));
check("masa berlaku dari setelan", /reward\.validDays \* 86_400_000/.test(reviews));
check("jeda terbit dari setelan", /days >= reward\.delayDays/.test(reviews));
check("nominal 0 = insentif dimatikan (dihormati)", /reward\.amount > 0/.test(reviews));
check(
  "konstanta REVIEW_INCENTIVE_* tidak lagi dipakai penerbit voucher",
  !/REVIEW_INCENTIVE_AMOUNT|REVIEW_INCENTIVE_DAYS|VOUCHER_VALIDITY_DAYS/.test(reviews)
);
check(
  "anti-dobel tetap ada (pre-check per pesanan)",
  /\.eq\("source", "review_incentive"\)[\s\S]{0,120}?\.eq\("booking_id", bookingId\)/.test(reviews)
);

// ------------------------------------------------------ 3) aplikasi Flutter
step("3. Aplikasi Flutter memakai RPC yang sama");
const api = read("flutter_app/lib/api.dart");
check("aplikasi memanggil RPC review_reward_efektif", /db\.rpc\('review_reward_efektif'\)/.test(api));
check("membaca amount / valid_days / delay_days", /m\['amount'\]/.test(api) && /m\['valid_days'\]/.test(api) && /m\['delay_days'\]/.test(api));
check(
  "gagal baca → bawaan 2.000 / 90 / 0 (bukan 0)",
  /var reviewIncentiveAmount = 2000;/.test(api) && /var voucherValidityDays = 90;/.test(api) && /var reviewIncentiveDays = 0;/.test(api)
);
check("nominal 0 = insentif dimatikan (dihormati)", /reviewIncentiveAmount > 0/.test(api));
check(
  "aplikasi tidak lagi memakai konstanta lama",
  !/const reviewIncentiveAmount = 2000;/.test(api) && !/const voucherValidityDays = 90;/.test(api)
);

// ------------------------------------------------------------- 4) panel admin
step("4. Panel admin & aksi simpan");
const admin = read("src/app/actions/admin.js");
check("getReviewRewardAdmin ada", /export async function getReviewRewardAdmin/.test(admin));
check("saveReviewRewardAdmin ada", /export async function saveReviewRewardAdmin/.test(admin));
check("simpan dijaga admin", /export async function saveReviewRewardAdmin[\s\S]{0,600}?requireAdmin\(/.test(admin));
check("simpan menolak kolom kosong (bukan diartikan 0)", /wajib diisi/.test(admin));
check(
  "simpan dijepit batas nominal / masa berlaku / jeda",
  /REVIEW_REWARD_AMOUNT_MAKS/.test(admin) && /REVIEW_REWARD_VALID_DAYS_MAKS/.test(admin) && /REVIEW_REWARD_DELAY_DAYS_MAKS/.test(admin)
);
check(
  "simpan menulis ketiga kolom ke app_settings id = 1",
  /app_settings[\s\S]{0,400}?review_reward_amount: baru\.amount/.test(admin)
);
check("perubahan tercatat di jejak audit admin", /action: "update_review_reward"/.test(admin));

const dashboard = read("src/components/AdminDashboard.js");
check("tab \"Voucher Penilaian\" terpasang di panel", /label="Voucher Penilaian"/.test(dashboard));
check("komponen ReviewRewardSettingsTab dirender", /tab === "review-reward" && <ReviewRewardSettingsTab \/>/.test(dashboard));
check(
  "komponen tab memakai aksi server (bukan tulis langsung ke DB)",
  /saveReviewRewardAdmin/.test(read("src/components/ReviewRewardSettingsTab.js"))
);

// --------------------------------------------- 5) halaman yang menjanjikan angka
step("5. Halaman & banner memakai angka yang berlaku");
const dashboardPage = read("src/app/dashboard/page.js");
check("dashboard membaca setelan di server", /bacaReviewReward\(supabase\)/.test(dashboardPage));
check("insentif dikirim ke komponen dashboard", /reviewReward=\{\{/.test(dashboardPage));
const dashboardClient = read("src/components/DashboardClient.js");
check("banner pengingat memakai amount dari setelan", /ReviewReminderBanner[\s\S]{0,200}?amount=\{reward\.amount\}/.test(dashboardClient));
check("banner hilang saat insentif dimatikan", /!\(amount > 0\)/.test(dashboardClient));
check("tab Voucher Saya memakai masa berlaku setelan", /defaultValidityDays=\{reward\.validDays\}/.test(dashboardClient));
check(
  "panduan pelanggan membaca setelan",
  /bacaReviewReward\(supabase\)/.test(read("src/app/panduan-pelanggan/page.js"))
);
check("syarat & ketentuan membaca setelan", /bacaReviewReward\(supabase\)/.test(read("src/app/syarat/page.js")));

// ------------------------------------------------------------------ 6) SQL
step("6. Migrasi database: satu pembacaan untuk aplikasi");
const sql = read("supabase/migrate-review-reward.sql");
check("fungsi review_reward_efektif() dibuat", /create or replace function public\.review_reward_efektif\(\)/.test(sql));
check("kolom setelan ditambahkan idempoten", /add column if not exists review_reward_amount/.test(sql) && /add column if not exists review_reward_valid_days/.test(sql) && /add column if not exists review_reward_delay_days/.test(sql));
check("batas nilai dijaga constraint database", /check \(review_reward_amount between 0 and 100000\)/.test(sql) && /check \(review_reward_valid_days between 1 and 365\)/.test(sql) && /check \(review_reward_delay_days between 0 and 30\)/.test(sql));
check("penjepitan di RPC", /least\(100000, greatest\(0,/.test(sql) && /least\(365, greatest\(1,/.test(sql) && /least\(30, greatest\(0,/.test(sql));
check("migrasi belum jalan → bawaan, bukan galat", /when undefined_column or undefined_table/.test(sql));
check("anon tidak boleh memanggil review_reward_efektif()", /revoke all on function public\.review_reward_efektif\(\) from public, anon/.test(sql));
check(
  "review_reward_efektif() tercatat di daftar izin RPC",
  /review_reward_efektif\(\)/.test(read("supabase/fix-rpc-grants-public.sql"))
);

// --------------------------------------------------- 7) live (read-only saja)
step("7. Database nyata (read-only)");
try {
  const env = loadEnv();
  const adminClient = makeAdminClient(env);

  const { data: row, error } = await adminClient
    .from("app_settings")
    .select("review_reward_amount, review_reward_valid_days, review_reward_delay_days")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    if (/column/i.test(error.message || "") && /review_reward/i.test(error.message || "")) {
      console.log("   ⚠️  kolom insentif belum ada — jalankan supabase/migrate-review-reward.sql.");
    } else if (/relation|does not exist|Could not find the table|schema cache/i.test(error.message || "")) {
      console.log("   ⚠️  tabel app_settings belum ada — jalankan supabase/migrate-review-reward.sql.");
    } else {
      check("membaca app_settings", false, error.message);
    }
    skippedLive = true;
  } else {
    const amount = Number(row?.review_reward_amount);
    const valid = Number(row?.review_reward_valid_days);
    const delay = Number(row?.review_reward_delay_days);
    check(
      "nominal tersimpan dalam 0..maks",
      Number.isFinite(amount) && amount >= 0 && amount <= REVIEW_REWARD_AMOUNT_MAKS,
      `Rp${amount.toLocaleString("id-ID")}`
    );
    check("masa berlaku tersimpan dalam 1..365", Number.isFinite(valid) && valid >= 1 && valid <= REVIEW_REWARD_VALID_DAYS_MAKS, `${valid} hari`);
    check("jeda terbit tersimpan dalam 0..30", Number.isFinite(delay) && delay >= 0 && delay <= REVIEW_REWARD_DELAY_DAYS_MAKS, `${delay} hari`);

    const { data: efektif, error: rpcError } = await adminClient.rpc("review_reward_efektif");
    if (rpcError) {
      console.log(`   ⚠️  RPC review_reward_efektif() belum ada: ${rpcError.message}`);
      skippedLive = true;
    } else {
      check(
        "RPC = setelan (web, aplikasi & database tidak bisa berbeda)",
        Number(efektif?.amount) === amount && Number(efektif?.valid_days) === valid && Number(efektif?.delay_days) === delay,
        JSON.stringify(efektif)
      );

      // Kontrol negatif: anon TIDAK boleh membaca/memanggil RPC setelan.
      const anon = makeAnonClient(env);
      const { error: anonError } = await anon.rpc("review_reward_efektif");
      check(
        "anon ditolak memanggil review_reward_efektif()",
        Boolean(anonError) && /permission denied/i.test(anonError.message || ""),
        anonError ? anonError.message : "anon BERHASIL memanggilnya"
      );
    }
  }
} catch (err) {
  if (err.code === "NO_CREDENTIALS") {
    console.log(`   ⚠️  dilewati: ${err.message}`);
    skippedLive = true;
  } else {
    check("bagian live berjalan", false, err.message);
  }
}

// ------------------------------------------------------------------ kesimpulan
console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"}`);
if (skippedLive) console.log("   ℹ️  bagian live dilewati — invarian statis tetap dinilai.");
process.exit(failed === 0 ? 0 : 1);
