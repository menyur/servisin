#!/usr/bin/env node
// ============================================================================
// verify-service-area-pricing.mjs — buktikan fitur luas (m²) benar-benar jalan.
//
// Dua lapis:
//   1) SELFTEST (tanpa database) — helper src/lib/area-pricing.js dipakai web &
//      panel admin. Perhitungan yang salah di sini membuat pelanggan melihat
//      nominal berbeda dari tagihan.
//   2) LIVE — memanggil RPC create_booking_security_definer sebagai pelanggan
//      sungguhan lewat Management API, lalu MEMERIKSA baris yang tertulis.
//      Semua penulisan dibungkus transaksi yang SELALU di-rollback.
//
// Pemakaian:
//   node scripts/verify-service-area-pricing.mjs --selftest
//   node scripts/verify-service-area-pricing.mjs            (butuh kredensial)
//
// Exit: 0 lulus · 1 ada temuan · 3 tanpa kredensial.
// ============================================================================
import {
  AREA_NOTE_DEFAULT,
  MAX_AREA_M2,
  MIN_AREA_M2,
  areaFromDimensions,
  areaNote,
  areaSubtotal,
  formatArea,
  isAreaService,
  normalizeArea,
  totalArea,
} from "../src/lib/area-pricing.js";

let gagal = 0;
let total = 0;
function cek(label, ok, detail = "") {
  total += 1;
  if (!ok) gagal += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function selftest() {
  console.log("Selftest helper luas (tanpa database)");
  console.log("=".repeat(74));

  cek("3 × 4 m = 12 m²", areaFromDimensions(3, 4) === 12);
  cek("2,5 × 1,2 m = 3 m²", areaFromDimensions(2.5, 1.2) === 3);
  cek("sisi 0 / kosong tidak dihitung", areaFromDimensions(0, 5) === null && areaFromDimensions("", 5) === null);
  cek("sisi teks bukan angka ditolak", areaFromDimensions("tiga", 4) === null);

  cek(
    "total beberapa bidang dijumlahkan",
    totalArea([
      { panjang: 4, lebar: 3 },
      { panjang: 2.5, lebar: 2 },
    ]) === 17
  );
  cek(
    "bidang belum lengkap dilewati",
    totalArea([{ panjang: 4, lebar: 3 }, { panjang: 2, lebar: "" }]) === 12
  );
  cek("tanpa bidang sah = null (bukan 0)", totalArea([{ panjang: 0, lebar: 0 }]) === null);

  cek("luas 0,4 m² ditolak", normalizeArea(0.4) === null);
  cek(`luas tepat batas bawah ${MIN_AREA_M2} m² diterima`, normalizeArea(MIN_AREA_M2) === MIN_AREA_M2);
  cek(`luas tepat batas atas ${MAX_AREA_M2} m² diterima`, normalizeArea(MAX_AREA_M2) === MAX_AREA_M2);
  cek("luas di atas batas ditolak", normalizeArea(MAX_AREA_M2 + 0.5) === null);
  cek("luas NaN/teks ditolak", normalizeArea("abc") === null && normalizeArea(NaN) === null);
  cek("luas dibulatkan 2 desimal", normalizeArea(12.3456) === 12.35);

  cek("subtotal 40.000/m² × 12,5 m² = 500.000", areaSubtotal(40000, 12.5) === 500000);
  // Luas dinormalkan 2 desimal DULU (sama dengan server), lalu dikalikan.
  cek("subtotal memakai luas 2 desimal", areaSubtotal(40000, 12.333) === 493200, String(areaSubtotal(40000, 12.333)));
  cek("luas tidak sah → subtotal 0", areaSubtotal(40000, null) === 0);

  cek("format 12 m²", formatArea(12) === "12 m²", formatArea(12));
  cek("format 12,5 m² (koma Indonesia)", formatArea(12.5) === "12,5 m²", formatArea(12.5));
  cek("format 12,25 m²", formatArea(12.25) === "12,25 m²", formatArea(12.25));

  cek("layanan bertanda area dikenali", isAreaService({ area_pricing: true }) === true);
  cek("layanan tanpa penanda bukan area", isAreaService({}) === false);
  cek("keterangan admin dipakai", areaNote({ area_note: "Ukur tiap dinding" }) === "Ukur tiap dinding");
  cek("keterangan kosong jatuh ke bawaan", areaNote({ area_note: "  " }) === AREA_NOTE_DEFAULT);
  cek("keterangan null jatuh ke bawaan", areaNote({}) === AREA_NOTE_DEFAULT);

  console.log("=".repeat(74));
  console.log(gagal === 0 ? `LULUS: selftest ${total}/${total}.` : `GAGAL: ${gagal} dari ${total} pemeriksaan.`);
  return gagal === 0 ? 0 : 1;
}

if (process.argv.includes("--selftest")) process.exit(selftest());

// ---------------------------------------------------------------------------
// Mode live
// ---------------------------------------------------------------------------
const { bacaEnvLokal } = await import("./lib/email-health.mjs");
const { cariToken, refDariUrl } = await import("./lib/supabase-admin.mjs");

const lokal = bacaEnvLokal();
const { token } = cariToken({ argv: process.argv, env: process.env, lokal });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || lokal.NEXT_PUBLIC_SUPABASE_URL;
const ref = refDariUrl(url);
if (!token || !ref) {
  console.error("Butuh SUPABASE_ACCESS_TOKEN (atau .env.local) + NEXT_PUBLIC_SUPABASE_URL.");
  process.exit(3);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const teks = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${teks.slice(0, 400)}`);
  return JSON.parse(teks);
}

console.log("Live: RPC pesanan per meter persegi (semua tulis di-rollback)");
console.log("=".repeat(74));

const katalog = await sql(`
  select json_build_object(
    'service', (select id from services where area_pricing and is_active order by name limit 1),
    'name', (select name from services where area_pricing and is_active order by name limit 1),
    'base', (select base_price from services where area_pricing and is_active order by name limit 1),
    'opt', (select json_build_object('id', o.id, 'label', o.label, 'price', o.price)
              from service_options o
             where o.service_id = (select id from services where area_pricing and is_active order by name limit 1)
               and o.is_active
             order by o.price limit 1),
    'non_area', (select id from services where not area_pricing and not exists (
                   select 1 from service_options o where o.service_id = services.id and o.is_active)
                 order by name limit 1),
    'user', (select id from profiles where role = 'customer' order by created_at limit 1)
  ) as k;
`);
const k = katalog[0].k;
cek("ada layanan per m² yang aktif", !!k.service, k.name || "tidak ada");
if (!k.service || !k.user) {
  console.log("Tidak bisa melanjutkan: layanan area / pelanggan uji tidak ditemukan.");
  process.exit(1);
}
const harga = Number(k.opt?.price ?? k.base);
console.log(`Layanan uji: ${k.name} · harga ${harga}/m² · opsi ${k.opt?.label ?? "(tanpa opsi)"}`);

const claims = JSON.stringify({ sub: k.user, role: "authenticated" });
const optArg = k.opt ? `'${k.opt.id}'::uuid` : "null::uuid";

/** Satu panggilan RPC dalam transaksi yang di-rollback. */
async function panggil({ area = null, qty = 1, items = null, service = k.service }) {
  const areaArg = area === null ? "null::numeric" : `${area}::numeric`;
  const itemsArg = items ? `'${JSON.stringify(items)}'::jsonb` : "null::jsonb";
  const rows = await sql(`
begin;
set local role authenticated;
set local request.jwt.claims = '${claims}';
select public.create_booking_security_definer(
  '${service}'::uuid, current_date + 1, '09:00', 'Jl. Uji Luas 1', ${optArg},
  'uji luas', null, 'cod', null::uuid, null::double precision, null::double precision,
  ${qty}, ${itemsArg}, ${areaArg}
) as hasil;
rollback;`);
  return rows[0].hasil;
}

const luas = 12.5;
const hasil = await panggil({ area: luas });
if (hasil.error) {
  cek("pesanan per m² dibuat", false, hasil.error);
} else {
  const bk = hasil.booking;
  const item = hasil.items?.[0] || {};
  cek("pesanan per m² dibuat", true, bk.code);
  cek("luas tersimpan di pesanan", Number(bk.area) === luas, String(bk.area));
  cek("luas tersimpan di baris rincian", Number(item.area) === luas, String(item.area));
  cek("harga satuan = harga katalog per m²", Number(item.unit_price) === harga, String(item.unit_price));
  cek(
    `subtotal = round(${harga} × ${luas})`,
    Number(bk.subtotal_price) === Math.round(harga * luas),
    String(bk.subtotal_price)
  );
  cek("jumlah unit tetap 1 (m² bukan unit)", Number(bk.quantity) === 1, String(bk.quantity));
  cek(
    "total = subtotal + biaya aplikasi",
    Number(bk.total_price) === Number(bk.subtotal_price) + Number(bk.app_fee),
    `total=${bk.total_price}`
  );
  cek("label ringkasan terisi", !!bk.option_label, bk.option_label);
}

async function tolak(label, opsi, pola) {
  const res = await panggil(opsi);
  const pesan = String(res?.error ?? "(tidak ditolak)");
  cek(label, pola.test(pesan), pesan.slice(0, 120));
}

await tolak("luas kosong ditolak", { area: null }, /luas area/i);
await tolak("luas 0,4 m² ditolak", { area: 0.4 }, /0,5 dan 2000/i);
await tolak("luas 2500 m² ditolak", { area: 2500 }, /0,5 dan 2000/i);
await tolak(
  "luas pada layanan per unit ditolak",
  { area: 5, service: k.non_area },
  /per unit, bukan per meter persegi/i
);

// Luas pecahan dibulatkan 2 desimal oleh server, bukan dipotong klien.
const pecahan = await panggil({ area: 7.129 });
if (!pecahan.error) {
  cek("luas dibulatkan 2 desimal di server", Number(pecahan.booking.area) === 7.13, String(pecahan.booking.area));
}

console.log("=".repeat(74));
console.log(gagal === 0 ? "LULUS: perilaku pesanan per m² sesuai." : `GAGAL: ${gagal} pemeriksaan.`);
process.exit(gagal === 0 ? 0 : 1);
