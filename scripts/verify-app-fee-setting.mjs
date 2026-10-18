// ============================================================================
// verify-app-fee-setting.mjs — jaga setelan BIAYA APLIKASI (panel admin → tab
// "Biaya Aplikasi") tetap SATU ANGKA di semua jalur.
//
// Latar: dulu biaya aplikasi adalah konstanta 5000 yang ditulis ulang di kode
// web DAN di RPC database. Begitu tarif bisa diubah admin, risiko sesungguhnya
// bukan "salah simpan", melainkan angka yang BERBEDA antar jalur: pelanggan
// melihat Rp5.000 di halaman booking, tapi RPC menagih angka lama (atau
// sebaliknya), dan komisi teknisi dihitung dari dasar yang salah.
//
// Invarian yang dijaga di sini:
//   1. Setelan dibaca lewat SATU pintu (src/lib/app-fee.js) dengan fallback
//      bawaan, bukan 0 — gangguan baca tidak boleh menghapus biaya aplikasi.
//   2. RPC pembuat booking & dasar komisi memakai app_fee_efektif() /
//      bookings.app_fee, bukan angka tetap.
//   3. Setiap pemakai commissionBase() memberi biaya app PESANANNYA.
//   4. Aksi simpan admin dijaga admin + dijepit 0..APP_FEE_MAKS, dan tabnya
//      benar-benar terpasang di panel.
//   5. (live, read-only) app_settings.app_fee == app_fee_efektif(), dan anon
//      tidak boleh memanggil RPC itu.
//
// Exit: 0 = lulus, 1 = regresi, 3 = bagian live dilewati (tanpa kredensial).
// Jalankan: npm run verify:app-fee-setting
// ============================================================================
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_FEE, APP_FEE_MAKS, calculateTotal, commissionBase, normalisasiAppFee } from "../src/lib/pricing.js";
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

// ------------------------------------------------------- 1) rumus & penjepitan
step("1. Rumus harga memakai tarif yang diberikan (bukan konstanta)");

check("biaya app 0 → total = subtotal − diskon", calculateTotal(100000, 0, 0).total === 100000);
check(
  "biaya app 15000 → pelanggan membayar 115000",
  calculateTotal(100000, 0, 15000).total === 115000,
  String(calculateTotal(100000, 0, 15000).total)
);
check(
  "diskon tidak pernah melebihi subtotal + biaya app",
  calculateTotal(100000, 999999, 15000).total === 0
);
check("normalisasiAppFee menolak negatif → 0", normalisasiAppFee(-500) === 0);
check("normalisasiAppFee menjepit di APP_FEE_MAKS", normalisasiAppFee(APP_FEE_MAKS + 1) === APP_FEE_MAKS);
check(
  "normalisasiAppFee(NaN) jatuh ke bawaan, BUKAN 0",
  normalisasiAppFee("abc") === APP_FEE,
  `hasil ${normalisasiAppFee("abc")}`
);
check(
  "commissionBase memakai biaya app pesanan",
  commissionBase(115000, 15000) === 100000 && commissionBase(100000, 0) === 100000
);
check(
  "commissionBase tanpa biaya app tidak memakai default diam-diam",
  commissionBase(115000, 15000) !== commissionBase(115000),
  "dua argumen wajib di jalur penagihan"
);

// --------------------------------------------------- 2) satu pintu pembacaan
step("2. Pembacaan setelan & jalur penagihan satu sumber");
const appFeeLib = read("src/lib/app-fee.js");
check("pembaca setelan membaca app_settings.app_fee", /from\("app_settings"\)/.test(appFeeLib) && /select\("app_fee"\)/.test(appFeeLib));
check("pembacaan gagal → tarif BAWAAN (bukan 0)", /fee:\s*APP_FEE/.test(appFeeLib) && /sumber:\s*"bawaan"/.test(appFeeLib));
check("ada versi rinci untuk panel admin (deteksi migrasi belum jalan)", /bacaAppFeeRinci/.test(appFeeLib));

const bookingsAction = read("src/app/actions/bookings.js");
check("createBooking memakai bacaAppFee()", /bacaAppFee\(/.test(bookingsAction));
check(
  "biaya app DIBEKUKAN ke bookings.app_fee saat pesanan dibuat",
  /app_fee:\s*appFee/.test(bookingsAction)
);

// ------------------------------------------------ 3) semua pemakai commissionBase
step("3. Setiap pemakai commissionBase() menyertakan biaya app pesanan");
const pemakai = [
  "src/app/actions/admin.js",
  "src/components/AdminDashboard.js",
  "src/components/OrderReport.js",
  "src/lib/balance.js",
  "src/lib/monthly-report.js",
  "src/app/panduan-teknisi/page.js",
];
for (const rel of pemakai) {
  const src = read(rel);
  const calls = [...src.matchAll(/commissionBase\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => m[1]);
  // Buang pemanggilan berdefinisi sendiri (mis. dokumentasi rumus) — yang penting
  // tidak ada pemanggilan SATU argumen yang diam-diam memakai konstanta.
  const satuArg = calls.filter((arg) => !/,/.test(arg));
  check(
    `${rel}: ${calls.length} pemanggilan, semuanya membawa biaya app`,
    calls.length > 0 && satuArg.length === 0,
    satuArg.length ? `satu argumen: ${satuArg.slice(0, 2).join(" | ")}` : ""
  );
}

// ------------------------------------------------------------- 4) panel admin
step("4. Panel admin & aksi simpan");
const adminAction = read("src/app/actions/admin.js");
check("getAppFeeAdmin ada", /export async function getAppFeeAdmin/.test(adminAction));
check("saveAppFeeAdmin ada", /export async function saveAppFeeAdmin/.test(adminAction));
check("simpan dijaga admin", /export async function saveAppFeeAdmin[\s\S]{0,600}?requireAdmin\(/.test(adminAction));
check(
  "simpan menolak di luar 0..APP_FEE_MAKS",
  /saveAppFeeAdmin[\s\S]{0,1200}?APP_FEE_MAKS/.test(adminAction) && /n < 0 \|\| n > APP_FEE_MAKS/.test(adminAction)
);
check(
  "simpan menulis app_fee ke app_settings id = 1",
  /\.from\("app_settings"\)[\s\S]{0,200}?\.update\(\{\s*app_fee:/.test(adminAction)
);

const dashboard = read("src/components/AdminDashboard.js");
check("tab \"Biaya Aplikasi\" terpasang di panel", /label="Biaya Aplikasi"/.test(dashboard));
check("komponen AppFeeSettingsTab dirender", /tab === "app-fee" && <AppFeeSettingsTab \/>/.test(dashboard));
check(
  "komponen tab memakai aksi server (bukan tulis langsung ke DB)",
  /saveAppFeeAdmin/.test(read("src/components/AppFeeSettingsTab.js"))
);

// Kartu pesanan admin harus menyebut biaya aplikasi PESANAN ITU (snapshot),
// bukan tarif yang berlaku sekarang — tarif itu dasar komisi teknisi untuk
// pekerjaan tersebut, jadi menampilkan angka lain akan menyesatkan saat audit.
const adminPage = read("src/app/admin/page.js");
check(
  "kartu pesanan admin menampilkan biaya aplikasi pesanan (bookings.app_fee)",
  /formatRupiah\(b\.app_fee\)/.test(dashboard) && /b\.subtotal_price/.test(dashboard)
);
check(
  "kartu pesanan menyebut tarif itu tarif SAAT PESANAN DIBUAT",
  /bookings\.app_fee — tarif biaya aplikasi yang ditagihkan saat pesanan/.test(dashboard)
);
check(
  "tarif yang berlaku sekarang hanya keterangan pembanding",
  /tarifBerbeda\s*=\s*[\s\S]{0,120}?Number\(b\.app_fee\) !== Number\(appFeeBerlaku\)/.test(dashboard) &&
    /tarif berlaku sekarang \{formatRupiah\(appFeeBerlaku\)\} — pesanan ini tetap memakai tarif saat dibuat/.test(
      dashboard
    )
);
check(
  "halaman admin membaca tarif berlaku lewat satu pintu & mengirimnya ke panel",
  /bacaAppFeeRinci\(supabase\)/.test(adminPage) && /appFeeBerlaku=\{appFeeRes\.fee\}/.test(adminPage)
);

// ------------------------------------------------------------------ 5) SQL
step("5. Migrasi database: satu pembacaan untuk RPC");
const sql = read("supabase/migrate-app-fee-setting.sql");
check("fungsi app_fee_efektif() dibuat", /create or replace function public\.app_fee_efektif\(\)/.test(sql));
check("RPC pembuat booking memakai app_fee_efektif()", /v_fee := public\.app_fee_efektif\(\)/.test(sql));
check(
  "dasar komisi memakai bookings.app_fee (snapshot pesanan)",
  /coalesce\(v_b\.app_fee, public\.app_fee_efektif\(\)\)/.test(sql)
);
check("anon tidak boleh memanggil app_fee_efektif()", /revoke all on function public\.app_fee_efektif\(\) from public, anon/.test(sql));
check(
  "tarif dijepit 0..1000000 di database",
  /least\(1000000, greatest\(0,/.test(sql)
);

const grants = read("supabase/fix-rpc-grants-public.sql");
check(
  "app_fee_efektif() tercatat di daftar izin RPC",
  /app_fee_efektif\(\)/.test(grants)
);

// --------------------------------------------------- 6) live (read-only saja)
step("6. Database nyata (read-only)");
try {
  const env = loadEnv();
  const admin = makeAdminClient(env);

  // Migrasi belum dijalankan adalah keadaan yang WAJAR sebelum rilis setelan
  // ini; pesannya harus menyebut PERSIS apa yang kurang (tabel vs kolom vs RPC)
  // supaya admin tidak mencari-cari masalah di tempat yang salah.
  let tersimpan = null;
  const { data: row, error } = await admin.from("app_settings").select("app_fee, updated_at").eq("id", 1).maybeSingle();
  if (error) {
    if (/column/i.test(error.message || "") && /app_fee/i.test(error.message || "")) {
      console.log("   ⚠️  kolom app_settings.app_fee belum ada — jalankan supabase/migrate-app-fee-setting.sql.");
    } else if (/relation|does not exist|Could not find the table|schema cache/i.test(error.message || "")) {
      console.log("   ⚠️  tabel app_settings belum ada — jalankan supabase/migrate-app-fee-setting.sql.");
    } else {
      check("membaca app_settings", false, error.message);
    }
    skippedLive = true;
  } else {
    tersimpan = Number(row?.app_fee);
    check(
      "app_settings.app_fee ada dan dalam 0..APP_FEE_MAKS",
      Number.isFinite(tersimpan) && tersimpan >= 0 && tersimpan <= APP_FEE_MAKS,
      row ? `Rp${tersimpan.toLocaleString("id-ID")}` : "baris id=1 tidak ada"
    );
  }

  const { data: efektif, error: rpcError } = await admin.rpc("app_fee_efektif");
  if (rpcError) {
    console.log(`   ⚠️  RPC app_fee_efektif() belum ada: ${rpcError.message} — jalankan migrasinya.`);
    skippedLive = true;
  } else if (tersimpan != null) {
    check(
      "app_fee_efektif() = app_settings.app_fee (web & DB tidak bisa berbeda)",
      Number(efektif) === tersimpan,
      `efektif ${efektif} vs setelan ${tersimpan}`
    );

    // Kontrol negatif: anon TIDAK boleh memanggil RPC tarif. Tidak menulis apa pun.
    const anon = makeAnonClient(env);
    const { error: anonError } = await anon.rpc("app_fee_efektif");
    check(
      "anon ditolak memanggil app_fee_efektif()",
      Boolean(anonError) && /permission denied/i.test(anonError.message || ""),
      anonError ? anonError.message : "anon BERHASIL memanggilnya"
    );
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
