// ============================================================================
// verify-warranty-settings.mjs — jaga PENGATURAN GARANSI panel admin tetap
// berarti: satu saklar aktif/nonaktif + satu durasi standar untuk semua layanan.
//
// LATAR: sebelumnya panjang garansi hanya ditentukan `services.warranty_days`
// (per layanan, bawaan 7 hari). Tidak ada saklar untuk mematikannya saat terjadi
// masalah, dan janji garansi bisa berbeda-beda per layanan tanpa satu tempat
// untuk melihatnya. Sekarang admin mengatur satu durasi di tab "Garansi" dan
// keputusan "masih bergaransi?" dihitung DI DATABASE (public.warranty_days_efektif)
// supaya web, panel admin, dan aplikasi Flutter tidak bisa berbeda jawaban.
//
// Uji A (statis): migrasi, perhitungan durasi, kedua RPC garansi, server action,
//                 dan kartu pengaturan di tab admin memakai aturan yang sama.
// Uji B (live, opsional): `warranty_days_efektif` di database benar-benar
//                 mengembalikan durasi standar (bukan angka per layanan) dan 0
//                 untuk layanan yang tidak ada — dibaca apa adanya, tanpa
//                 mengubah setelan produksi.
//
// Exit: 0 lulus, 1 regresi. Bagian live dilewati tanpa kredensial (exit tetap 0
// bila bagian statis lulus, dengan catatan yang jelas).
// Jalankan: npm run verify:garansi
// ============================================================================
import fs from "node:fs";

let failed = 0;
let checked = 0;

function check(label, ok, detail = "") {
  checked++;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const MIGRASI = "supabase/migrate-warranty-settings.sql";
const LAMA = "supabase/migrate-warranty-claims.sql";

// ---------------------------------------------------------------------------
// A1. Migrasi: kolom setelan + aman diulang
// ---------------------------------------------------------------------------
step("A1. Migrasi setelan garansi ada & idempoten");

const migrasi = read(MIGRASI);
check(
  "kolom saklar ditambahkan (warranty_enabled, bawaan menyala)",
  /add column if not exists warranty_enabled boolean not null default true/.test(migrasi)
);
check(
  "kolom durasi standar ditambahkan (warranty_days, bawaan 7 hari)",
  /add column if not exists warranty_days int not null default 7/.test(migrasi)
);
check(
  "durasi dibatasi 0–365 hari di database (bukan hanya di panel admin)",
  /check \(warranty_days between 0 and 365\)/.test(migrasi) &&
    /drop constraint if exists app_settings_warranty_days_check/.test(migrasi)
);
check(
  "tabel app_settings ikut dibuat lengkap bila berkas ini jalan lebih dulu",
  /create table if not exists public\.app_settings/.test(migrasi) &&
    /transfer_account_number text not null default ''/.test(migrasi),
  "tanpa kolom transfer di dalamnya, migrasi transfer tidak akan pernah menambahkannya"
);
check(
  "baris setelan tunggal aman diulang",
  /insert into public\.app_settings \(id\) values \(1\) on conflict \(id\) do nothing/.test(migrasi)
);
check(
  "hanya admin yang boleh mengubah setelan",
  /admin can update app settings[\s\S]*?p\.role = 'admin'/.test(migrasi)
);
check(
  "seluruh berkas idempoten (create or replace / if not exists)",
  /create or replace function public\.warranty_days_efektif/.test(migrasi) &&
    !/\bcreate table public\./.test(migrasi)
);

// ---------------------------------------------------------------------------
// A2. Satu perhitungan durasi untuk semua jalur
// ---------------------------------------------------------------------------
step("A2. Durasi efektif dihitung di database, dipakai semua RPC");

check(
  "fungsi warranty_days_efektif(uuid) ada & stabil",
  /function public\.warranty_days_efektif\(p_service uuid\)[\s\S]{0,80}?stable/.test(migrasi)
);
const badanEfektif = migrasi.slice(
  migrasi.indexOf("function public.warranty_days_efektif"),
  migrasi.indexOf("---------- 4)")
);
check(
  "saklar mati → 0 hari",
  /when not st\.warranty_enabled then 0/.test(badanEfektif)
);
check(
  "layanan yang dikecualikan (warranty_days = 0) → 0 hari",
  /when coalesce\(svc\.warranty_days, 0\) <= 0 then 0/.test(badanEfektif)
);
check(
  "selain itu durasi standar (setelan global) yang dipakai",
  /else least\(365, greatest\(0, st\.warranty_days\)\)/.test(badanEfektif)
);
check(
  "layanan tidak ditemukan / setelan tidak ada → 0, bukan galat",
  /select coalesce\(\(/.test(badanEfektif) && /\), 0\)/.test(badanEfektif)
);

const badanKlaim = migrasi.slice(
  migrasi.indexOf("function public.create_warranty_claim"),
  migrasi.indexOf("---------- 5)")
);
const badanInfo = migrasi.slice(
  migrasi.indexOf("function public.booking_warranty_info"),
  migrasi.indexOf("---------- 6)")
);
check(
  "create_warranty_claim memakai durasi efektif",
  /v_days := public\.warranty_days_efektif\(v_b\.service_id\)/.test(badanKlaim)
);
check(
  "booking_warranty_info memakai durasi efektif",
  /v_days := coalesce\(public\.warranty_days_efektif\(v_b\.service_id\), 0\)/.test(badanInfo)
);
check(
  "tidak ada lagi jalur yang membaca durasi per layanan langsung sebagai panjang garansi",
  !/select coalesce\(warranty_days, 0\) into v_days from services/.test(migrasi),
  "kalau ada, klien bisa melihat garansi lebih panjang dari setelan admin"
);
check(
  "klaim dari layanan yang dikecualikan dibedakan dari garansi yang dimatikan",
  /warranty_disabled', not v_aktif/.test(migrasi) &&
    /Garansi sedang dinonaktifkan/.test(migrasi) &&
    /Layanan ini tidak bergaransi/.test(migrasi)
);
check(
  "saklar dimatikan TIDAK menyentuh jalur keputusan klaim",
  !/decide_warranty_claim/.test(migrasi),
  "klaim yang sudah masuk & kunjungan ulang terjadwal harus tetap bisa diselesaikan"
);
check(
  "hak eksekusi dirapikan (cabut PUBLIC, beri authenticated + service_role)",
  /revoke all on function public\.warranty_days_efektif\(uuid\) from public, anon, authenticated/.test(migrasi) &&
    /grant execute on function public\.warranty_days_efektif\(uuid\) to authenticated, service_role/.test(migrasi)
);
check(
  "berkas ini menyatakan diri harus jalan setelah migrasi garansi lama",
  migrasi.includes(LAMA.replace("supabase/", "")),
  `menyebut ${LAMA.replace("supabase/", "")} di komentar/judulnya`
);
check(
  "daftar grant RPC resmi ikut memuat fungsi baru",
  /warranty_days_efektif\(uuid\)', 'authenticated, service_role'/.test(
    read("supabase/fix-rpc-grants-public.sql")
  )
);

// ---------------------------------------------------------------------------
// A3. Server action panel admin
// ---------------------------------------------------------------------------
step("A3. Server action baca & simpan setelan");

const actions = read("src/app/actions/admin.js");
check("getWarrantySettingsAdmin diekspor", /export async function getWarrantySettingsAdmin\(/.test(actions));
check("saveWarrantySettingsAdmin diekspor", /export async function saveWarrantySettingsAdmin\(/.test(actions));
check(
  "membaca kedua kolom setelan dari baris tunggal app_settings",
  /from\("app_settings"\)[\s\S]{0,80}?select\("warranty_enabled, warranty_days"\)[\s\S]{0,80}?eq\("id", 1\)/.test(actions)
);
check(
  "durasi divalidasi 0–365 di server (klien tidak bisa menyelundupkan angka lain)",
  /n < 0 \|\| n > 365/.test(actions)
);
check(
  "menolak keadaan membingungkan: aktif tapi 0 hari",
  /aktif && n === 0/.test(actions) && /minimal 1 hari saat garansi aktif/.test(actions)
);
check(
  "migrasi yang belum jalan dijelaskan, bukan gagal senyap",
  (actions.match(/migrate-warranty-settings\.sql/g) || []).length >= 2
);
check(
  "\"aktif/nonaktif\" disimpan sebagai boolean asli, bukan string",
  /warranty_enabled: aktif/.test(actions) && /const aktif = !!enabled/.test(actions)
);

// ---------------------------------------------------------------------------
// A4. Kartu pengaturan di tab Garansi
// ---------------------------------------------------------------------------
step("A4. Tab Garansi memuat pengaturan (saklar + durasi)");

const tab = read("src/components/WarrantyClaimsAdminTab.js");
check(
  "mengimpor kedua server action",
  /getWarrantySettingsAdmin/.test(tab) && /saveWarrantySettingsAdmin/.test(tab)
);
check("memuat setelan bersama daftar klaim", /getWarrantySettingsAdmin\(\)/.test(tab) && /Promise\.all/.test(tab));
check("menyimpan lewat server action", /await saveWarrantySettingsAdmin\(\{/.test(tab));
check("ada saklar aktif/nonaktif untuk garansi", /setDraft\(\{ enabled: !garansiAktif/.test(tab));
check(
  "durasi standar dibatasi 1–365 di kolom isian",
  /min="1"/.test(tab) && /max="365"/.test(tab)
);
check(
  "gagal baca setelan ditampilkan (termasuk petunjuk migrasi), tidak disembunyikan",
  /settingsError \? \(/.test(tab) && /text-coral/.test(tab)
);
check(
  "daftar klaim memakai durasi standar, bukan angka per layanan",
  /garansi \$\{settings\.days\} hari/.test(tab) && !/garansi \$\{garansiHari\} hari/.test(tab)
);
check(
  "dijelaskan bahwa mematikan garansi tidak membatalkan klaim berjalan",
  /Mematikan garansi tidak membatalkan klaim/.test(tab)
);
check(
  "dijelaskan bahwa layanan bertanda 0 tetap dikecualikan",
  /masa\s+garansi 0 per layanan\)\s+tetap dikecualikan/.test(tab)
);
const dashboard = read("src/components/AdminDashboard.js");
check(
  "tab Garansi terdaftar di panel admin",
  /tab === "warranty"/.test(dashboard) && /WarrantyClaimsAdminTab/.test(dashboard)
);
check(
  "pengecualian per layanan bisa diatur dari panel, bukan hanya dari SQL",
  /Tanpa garansi untuk layanan ini/.test(dashboard) &&
    /warrantyDays: tandaGaransi\(service\)/.test(dashboard),
  "tanpa kendali ini, aturan 'layanan bertanda 0' tidak bisa diterapkan admin"
);
check(
  "kartu layanan menandai layanan yang dikecualikan dari garansi",
  /Tanpa garansi<\/span>/.test(dashboard)
);
check(
  "penanda garansi tidak mengirim nilai tak sah bila kolomnya belum ada",
  /function tandaGaransi\(service\)[\s\S]{0,160}?Number\(service\.warranty_days \?\? 7\)/.test(dashboard)
);

// ---------------------------------------------------------------------------
// A5. Aplikasi pelanggan tidak menyalin aturan
// ---------------------------------------------------------------------------
step("A5. Aplikasi Flutter membaca hasil dari server, bukan menebak");

const api = read("flutter_app/lib/api.dart");
const models = read("flutter_app/lib/models.dart");
check(
  "aplikasi memanggil RPC booking_warranty_info",
  /rpc\('booking_warranty_info'/.test(api)
);
check(
  "jumlah hari garansi diambil dari jawaban server",
  /warrantyDays: \(m\['warranty_days'\] as num\?\)\?\.toInt\(\) \?\? 0/.test(models)
);
check(
  "tidak ada durasi garansi yang ditulis ulang di kode aplikasi",
  !/warrantyDays\s*[:=]\s*7\b/.test(models) && !/warranty_days'\s*:\s*7/.test(api)
);
check(
  "probe layanan-mandiri ikut menguji setelan global (bukan hanya per layanan)",
  /MIGRATION_WARRANTY_SETTINGS/.test(read("scripts/verify-customer-self-service.mjs")) &&
    /warrantySettingsOriginal/.test(read("scripts/verify-customer-self-service.mjs"))
);

// ---------------------------------------------------------------------------
// B. Live (opsional): perhitungan di database benar-benar sesuai aturan
// ---------------------------------------------------------------------------
step("B. Pemeriksaan live database (opsional, tanpa mengubah setelan)");

let env = null;
try {
  const { loadEnv } = await import("./lib/probe-env.mjs");
  env = loadEnv();
} catch (err) {
  info(
    `kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — bagian B dilewati; ` +
      "bagian A sudah membuktikan berkasnya konsisten"
  );
}

if (env) {
  const { makeAdminClient } = await import("./lib/probe-env.mjs");
  const admin = makeAdminClient(env);

  const { data: setelan, error: setelanErr } = await admin
    .from("app_settings")
    .select("warranty_enabled, warranty_days")
    .eq("id", 1)
    .maybeSingle();
  check(
    `kolom setelan garansi ada di database (${MIGRASI})`,
    !setelanErr && Boolean(setelan),
    setelanErr?.message || "ada"
  );

  if (!setelanErr && setelan) {
    const aktif = !!setelan.warranty_enabled;
    const standar = Number(setelan.warranty_days ?? 0);
    info(`setelan saat ini: ${aktif ? `aktif ${standar} hari` : "nonaktif"}`);

    const { data: svc, error: svcErr } = await admin
      .from("services")
      .select("id, name, warranty_days")
      .limit(1)
      .maybeSingle();

    if (svcErr || !svc) {
      check("ada layanan untuk diuji", false, svcErr?.message || "tabel services kosong");
    } else {
      const harap = aktif && Number(svc.warranty_days ?? 0) > 0 ? standar : 0;
      const { data: efektif, error: hitungErr } = await admin.rpc("warranty_days_efektif", {
        p_service: svc.id,
      });
      check(
        `durasi efektif layanan nyata = ${harap} hari (saklar ${aktif ? "menyala" : "mati"}, layanan warranty_days=${svc.warranty_days})`,
        !hitungErr && Number(efektif) === harap,
        hitungErr?.message || `didapat ${efektif}`
      );
    }

    const { data: kosong, error: kosongErr } = await admin.rpc("warranty_days_efektif", {
      p_service: "00000000-0000-0000-0000-000000000000",
    });
    check(
      "layanan tak dikenal → 0 hari (bukan galat / durasi standar)",
      !kosongErr && Number(kosong) === 0,
      kosongErr?.message || `didapat ${kosong}`
    );
  }
}

console.log("\n" + "=".repeat(72));
if (failed) {
  console.log(
    `GAGAL: ${failed}/${checked} pemeriksaan tidak lolos — perbaiki berkas yang disebut di atas, ` +
      "jangan melemahkan pemeriksaannya."
  );
  process.exit(1);
}
console.log(
  `LULUS: ${checked}/${checked} pemeriksaan lolos — setelan garansi (saklar + durasi standar) ` +
    "tersambung dari panel admin sampai perhitungan di database."
);
process.exit(0);
