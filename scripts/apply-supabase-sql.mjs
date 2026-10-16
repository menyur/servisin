#!/usr/bin/env node
// ============================================================================
// apply-supabase-sql.mjs — menerapkan berkas SQL (DDL) ke project Supabase
// LEWAT Management API, supaya langkah "buka SQL Editor dan tempel" tidak lagi
// menjadi jalur wajib (dan tidak lagi bergantung pada ingatan siapa pun).
//
// Kenapa lewat Management API: `anon`/`service_role` hanya bisa menyentuh tabel
// & RPC lewat PostgREST — DDL (create function/alter table) TIDAK bisa. Tanpa
// CLI/psql, satu-satunya jalur DDL yang bisa diaudit adalah endpoint query milik
// Management API, memakai personal access token yang sudah dipakai skrip lain
// (lihat lib/supabase-admin.mjs untuk aturan pencarian tokennya).
//
// Pemakaian:
//   node scripts/apply-supabase-sql.mjs [berkas.sql]            # DRY-RUN
//   node scripts/apply-supabase-sql.mjs supabase/x.sql --apply  # tulis ke project
//   node scripts/apply-supabase-sql.mjs supabase/x.sql --apply --statements
//   node scripts/apply-supabase-sql.mjs --check-token           # uji token (kueri baca)
//   node scripts/apply-supabase-sql.mjs --selftest              # murni, tanpa jaringan
//
// Token: environment `SUPABASE_ACCESS_TOKEN`, atau `--token-file=<jalur>`, atau
// `.env.local`, `.env`, `~/.supabase/access-token`. JANGAN tempel token di chat.
// Untuk DDL, token perlu izin tulis database (`database_write` pada token
// fine-grained, atau token legacy milik akun project).
//
// Kode keluar: 0 diterapkan/verifikasi lolos (atau dry-run) · 1 gagal ·
// 3 kredensial/argumen kurang.
// ============================================================================
import { readFileSync } from "node:fs";

import { bacaEnvLokal } from "./lib/email-health.mjs";
import { cariToken, refDariUrl, redaksi } from "./lib/supabase-admin.mjs";

// --- Pembantu murni (diuji lewat --selftest) -------------------------------

/**
 * Pisahkan isi berkas SQL menjadi pernyataan-pernyataannya, TANPA terpotong di
 * dalam string, komentar, atau badan `$tag$ … $tag$` (di situ ada banyak `;`
 * yang bukan pemisah pernyataan). Dipakai untuk mengirim per-pernyataan saat
 * endpoint menolak satu batch berisi banyak pernyataan.
 */
export function pisahPernyataan(sql) {
  const teks = sql || "";
  const keluaran = [];
  let mulai = 0;
  let i = 0;
  let dollarTag = null; // mis. "$fn$" atau "$$"
  let kutip = false; // di dalam string '…'
  let komentarBaris = false;
  let komentarBlok = false;

  while (i < teks.length) {
    const c = teks[i];
    const dua = teks.slice(i, i + 2);

    if (komentarBaris) {
      if (c === "\n") komentarBaris = false;
      i += 1;
      continue;
    }
    if (komentarBlok) {
      if (dua === "*/") {
        komentarBlok = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (dollarTag) {
      if (teks.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i += 1;
      continue;
    }
    if (kutip) {
      // '' di dalam string = tanda kutip harfiah, bukan penutup.
      if (c === "'") {
        if (teks[i + 1] === "'") {
          i += 2;
          continue;
        }
        kutip = false;
      }
      i += 1;
      continue;
    }

    if (dua === "--") {
      komentarBaris = true;
      i += 2;
      continue;
    }
    if (dua === "/*") {
      komentarBlok = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      kutip = true;
      i += 1;
      continue;
    }
    if (c === "$") {
      const cocok = teks.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (cocok) {
        dollarTag = cocok[0];
        i += dollarTag.length;
        continue;
      }
    }
    if (c === ";") {
      keluaran.push(teks.slice(mulai, i));
      mulai = i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  keluaran.push(teks.slice(mulai));

  // Buang potongan yang hanya berisi komentar/spasi.
  return keluaran
    .map((p) => p.trim())
    .filter((p) => {
      const tanpaKomentar = p
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(/\r?\n/)
        .filter((l) => !/^\s*--/.test(l))
        .join("\n")
        .trim();
      return tanpaKomentar.length > 0;
    });
}

/** Baris pertama pernyataan (untuk ringkasan dry-run, tanpa badan fungsi). */
export function judul(p) {
  const baris = p
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--"));
  const teks = (baris[0] || "").replace(/\s+/g, " ");
  return teks.length > 90 ? `${teks.slice(0, 87)}…` : teks;
}

// --- Mode selftest ---------------------------------------------------------
if (process.argv.includes("--selftest")) {
  const kasusPisah = [
    ["dua pernyataan sederhana", pisahPernyataan("select 1; select 2;").length, 2],
    [
      "badan $fn$ berisi titik koma dihitung satu",
      pisahPernyataan("create function f() returns int as $fn$ begin return 1; end; $fn$;").length,
      1,
    ],
    [
      "komentar baris berisi titik koma diabaikan",
      pisahPernyataan("-- a; b;\nselect 1;").length,
      1,
    ],
    [
      "string berisi titik koma tidak memotong",
      pisahPernyataan("insert into t values ('a;b');").length,
      1,
    ],
    ["kutip ganda di dalam string", pisahPernyataan("select 'it''s; ok';").length, 1],
    ["komentar blok berisi titik koma", pisahPernyataan("/* a; b */ select 1;").length, 1],
    ["hanya komentar → tanpa pernyataan", pisahPernyataan("-- kosong\n/* juga */").length, 0],
    ["tag dollar kustom", pisahPernyataan("do $v$ begin raise notice 'a;b'; end $v$;").length, 1],
  ];
  let gagal = 0;
  for (const [nama, dapat, harap] of kasusPisah) {
    const ok = dapat === harap;
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${harap}, dapat ${dapat}`}`);
  }

  const judulUji = judul("\n-- komentar petunjuk\ncreate table t (id int);");
  const okJudul = judulUji === "create table t (id int);";
  if (!okJudul) gagal += 1;
  console.log(`${okJudul ? "lulus" : "GAGAL"}  judul melewati komentar${okJudul ? "" : ` — dapat "${judulUji}"`}`);

  const merah = redaksi({ ref: "abc", access_token: "sbp_rahasia", query: "select 1" });
  const okMerah = merah.access_token === "«disembunyikan»" && merah.query === "select 1";
  if (!okMerah) gagal += 1;
  console.log(`${okMerah ? "lulus" : "GAGAL"}  redaksi menyembunyikan token, menyisakan sisanya`);

  const total = kasusPisah.length + 2;
  console.log("=".repeat(72));
  console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagal}/${total}`);
  process.exit(gagal === 0 ? 0 : 1);
}

// --- Mode live -------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};
const APPLY = argv.includes("--apply");
const CEK_TOKEN = argv.includes("--check-token");
const PER_PERNYATAAN = argv.includes("--statements");
const lokal = bacaEnvLokal();
const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || lokal.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const REF = arg("ref") || refDariUrl(BASE);
const { token: TOKEN, dari } = cariToken({ argv, lokal });

const berkas = argv.find((a) => !a.startsWith("--")) || "supabase/migrate-technician-trip-share.sql";

console.log("Terapkan SQL ke Supabase (Management API)");
console.log("=".repeat(72));
console.log(`berkas      : ${berkas}`);
console.log(`project ref : ${REF || "(tidak terbaca)"}`);
console.log(`token       : ${TOKEN ? `terbaca (dari ${dari})` : "TIDAK ADA"}`);
console.log(`mode        : ${APPLY ? (PER_PERNYATAAN ? "TERAPKAN (per pernyataan)" : "TERAPKAN (satu batch)") : "DRY-RUN (tanpa --apply tidak ada yang ditulis)"}`);

let sql = "";
try {
  sql = readFileSync(berkas, "utf8");
} catch (e) {
  console.log(`\nGAGAL membaca ${berkas}: ${e.message}`);
  process.exit(1);
}

const pernyataan = pisahPernyataan(sql);
console.log(`pernyataan  : ${pernyataan.length} (berkas ${(sql.length / 1024).toFixed(1)} KB)`);
console.log("");
console.log("Isi yang akan dijalankan:");
for (const [i, p] of pernyataan.entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. ${judul(p)}`);
}

// Pemeriksaan kredensial SETELAH rencana dicetak: dengan begitu daftar
// pernyataan yang akan dijalankan tetap bisa ditinjau tanpa token sama sekali.
if (!TOKEN || !REF) {
  console.log("");
  console.log("TIDAK BISA DIJALANKAN: butuh dua hal ini.");
  if (!REF) console.log("  - NEXT_PUBLIC_SUPABASE_URL di .env.local (untuk membaca project ref)");
  if (!TOKEN) {
    console.log("  - SUPABASE_ACCESS_TOKEN (personal access token sbp_…)");
    console.log("    Buat: https://supabase.com/dashboard/account/tokens");
    console.log("    Izin  : database_write (token fine-grained) atau token legacy akun project");
    console.log("    JANGAN tempel token di chat — cukup satu baris di .env.local:");
    console.log("      SUPABASE_ACCESS_TOKEN=sbp_…");
  }
  process.exit(3);
}

if (!APPLY && !CEK_TOKEN) {
  console.log("");
  console.log("DRY-RUN: tidak ada yang dikirim. Tambahkan --apply untuk menerapkan.");
  process.exit(0);
}

const URL_QUERY = `https://api.supabase.com/v1/projects/${REF}/database/query`;

/** Kirim satu `query` ke Management API. Mengembalikan {ok, status, teks}. */
async function kirimQuery(query, { readOnly = false } = {}) {
  const res = await fetch(URL_QUERY, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  });
  const teks = await res.text();
  let json = null;
  try {
    json = JSON.parse(teks);
  } catch {
    /* bukan JSON */
  }
  const pesan = json && typeof json === "object" ? json.message || json.error : null;
  return { ok: res.ok && !pesan, status: res.status, teks, pesan };
}

// ---- Uji token tanpa menyentuh skema: satu kueri baca. ----
// Gunanya: scope token yang kurang (Database → Read-write) ketahuan DI SINI,
// bukan saat DDL sudah setengah jalan. Kueri `select 1` tidak mengubah apa pun.
if (CEK_TOKEN) {
  const r = await kirimQuery("select 1 as ok", { readOnly: true });
  console.log("");
  if (r.ok) {
    console.log("✅ token diterima Management API (uji baca berhasil).");
    console.log("   Lanjutkan dengan --apply untuk menerapkan SQL-nya.");
    process.exit(0);
  }
  console.log(`❌ token DITOLAK oleh Management API: HTTP ${r.status}`);
  console.log(`   ${r.pesan || r.teks.slice(0, 400)}`);
  if (r.status === 403) {
    console.log("   403 = token terbaca tetapi izinnya kurang: pada token scoped, beri");
    console.log("   scope Database → Read-write, dan pastikan project-nya ikut dipilih.");
  }
  process.exit(1);
}

console.log("");
console.log("=".repeat(72));

let gagal = null;
if (PER_PERNYATAAN) {
  for (const [i, p] of pernyataan.entries()) {
    const r = await kirimQuery(p);
    if (!r.ok) {
      gagal = { nomor: i + 1, judul: judul(p), ...r };
      break;
    }
    console.log(`✅ ${String(i + 1).padStart(2)}/${pernyataan.length} ${judul(p)}`);
  }
} else {
  const r = await kirimQuery(sql);
  if (r.ok) console.log(`✅ batch ${pernyataan.length} pernyataan dijalankan (HTTP ${r.status})`);
  else gagal = { nomor: 0, judul: "(satu batch)", ...r };
}

if (gagal) {
  console.log("");
  console.log(`❌ GAGAL pada pernyataan ke-${gagal.nomor}: ${gagal.judul}`);
  console.log(`   HTTP ${gagal.status}`);
  console.log(`   ${gagal.pesan || gagal.teks.slice(0, 500)}`);
  console.log("");
  console.log("Saran: berkas ini idempoten — setelah penyebabnya jelas, jalankan lagi.");
  console.log("Bila endpoint menolak batch berisi banyak pernyataan, pakai --statements.");
  process.exit(1);
}

// ---- Verifikasi struktur: memastikan VERSI BARU yang benar-benar terpasang ----
// Bukan pengganti probe live (yang menguji perilaku), melainkan pemeriksaan cepat
// supaya kegagalan versi lama ketahuan detik itu juga, bukan nanti di probe.
const VERIFIKASI = `
do $verifikasi$
declare
  v_pesan text := null;
begin
  if to_regclass('public.technician_trip_shares') is null then
    v_pesan := 'tabel technician_trip_shares tidak ada';
  elsif not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'technician_trip_shares'
                      and column_name = 'near_notified_at') then
    v_pesan := 'kolom near_notified_at tidak ada (migrasi versi lama)';
  elsif not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'distance_m') then
    v_pesan := 'fungsi distance_m tidak ada';
  elsif not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'push_trip_position'
                      and p.prosrc like '%arrived%') then
    v_pesan := 'push_trip_position masih versi lama (tanpa arrived/near)';
  elsif not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'booking_technician_position'
                      and p.prosrc like '%distance_m%') then
    v_pesan := 'booking_technician_position masih versi lama (tanpa jarak)';
  elsif not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'upsert_my_location'
                      and p.prosrc like '%technician_trip_shares%') then
    v_pesan := 'upsert_my_location belum menyegarkan perjalanan yang berbagi';
  elsif not exists (select 1 from pg_trigger
                    where tgname = 'bookings_delete_trip_share' and not tgisinternal) then
    v_pesan := 'trigger bookings_delete_trip_share tidak ada';
  elsif not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'technician_trip_shares'
                      and cmd = 'SELECT') then
    v_pesan := 'policy baca untuk teknisi tidak ada';
  elsif has_function_privilege('anon', 'public.booking_technician_position(uuid)', 'EXECUTE') then
    v_pesan := 'anon masih boleh memanggil RPC pelanggan (jalankan fix-rpc-grants-public.sql)';
  end if;

  if v_pesan is not null then
    raise exception 'VERIFIKASI GAGAL: %', v_pesan;
  end if;
end
$verifikasi$;
`;

const verifikasi = await kirimQuery(VERIFIKASI, { readOnly: true });
console.log("");
if (verifikasi.ok) {
  console.log("✅ verifikasi struktur: versi BARU terpasang (kolom penanda, jarak, tiba, trigger, izin).");
  console.log("");
  console.log("Langkah berikutnya: npm run verify:trip-share-live  (bukti perilaku pada database nyata)");
  process.exit(0);
}
console.log("❌ verifikasi struktur GAGAL:");
console.log(`   ${verifikasi.pesan || verifikasi.teks.slice(0, 500)}`);
console.log(`   (respons mentah, diredaksi: ${JSON.stringify(redaksi({ status: verifikasi.status }))})`);
process.exit(1);
