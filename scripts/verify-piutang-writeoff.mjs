#!/usr/bin/env node
// ============================================================================
// verify-piutang-writeoff.mjs — probe OFFLINE untuk UMUR PIUTANG, PENGHAPUSAN
// EKSPLISIT (write-off) dengan persetujuan, dan PENGINGAT OTOMATIS.
//
// Latar (lihat docs/balance-rule.md): piutang teknisi = saldo minus dari potongan
// penuh. Teknisi yang BERHENTI tidak akan pernah menyetor, jadi piutangnya menua
// tanpa batas. Kebijakan lama (clamp saldo ke 0) membuat piutang seperti itu
// menghilang dari buku TANPA baris, alasan, maupun keputusan siapa pun. Berkas ini
// membuktikan aturan penggantinya benar-benar berlaku DAN utuh di semua sumber:
//
//   1. MURNI (src/lib/pricing.js): keranjang umur 0-30/31-60/61-90/>90 hari dengan
//      batas inklusif, ambang jatuh tempo, dan aturan pemilihan penerima pengingat
//      (hanya yang lewat ambang, idempoten lewat jeda ulang);
//   2. BACAAN LEDGER (src/lib/piutang.js): piutang terbuka = uncovered_amount −
//      pelunasan (setoran MAUPUN penghapusan), lewat klien tiruan in-memory —
//      tanpa jaringan, tanpa kredensial;
//   3. WIRING (grep sumber): cron pengingat + jadwalnya, aksi admin pengajuan &
//      persetujuan, RPC atomik + index unik "satu pending per teknisi", tab Saldo
//      (keranjang + tindakan), dan panel "Hari Ini" (tugas piutang).
//
// Secara bawaan tidak menyentuh Supabase. Dengan `--live` ia juga menjalankan
// bukti HIDUP pada database nyata (kredensial dari .env.local / env CI): membuat
// SATU teknisi uji berpiutang berumur (120 hari + 10 hari) dan SATU admin uji,
// lalu membuktikan — pada data sungguhan — bahwa pengingat otomatis memilih yang
// jatuh tempo, penandanya tertulis & menjadikannya idempoten, pengajuan ganda
// ditolak, teknisi (bukan admin) tidak bisa menghapuskan piutang, dan persetujuan
// admin menutup pelunasan sebagai `penghapusan` + menulis baris `adjustment` +
// menaikkan saldo sehingga `saldo = Σ mutasi` tetap utuh. Semua data uji dihapus
// dan sisanya dilaporkan (harus 0).
//
// Jalankan: node scripts/verify-piutang-writeoff.mjs         (npm run verify:piutang)
//           node scripts/verify-piutang-writeoff.mjs --live  (npm run verify:piutang-live)
// Kode keluar: 0 = lulus, 1 = ada regresi, 2 = migrasi belum dijalankan,
//              3 = kredensial probe tidak tersedia (hanya mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  piutangTerbukaBaris,
  keranjangUmurPiutang,
  ambangPiutangHari,
  pilihPengingatPiutang,
  PIUTANG_TENGGAT_HARI,
  PIUTANG_ULANG_INGAT_HARI,
  DEFAULT_COMMISSION_RATE,
} from "../src/lib/pricing.js";
import { bacaPiutangTerbuka } from "../src/lib/piutang.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(label, cond, detail = "") {
  const ok = !!cond;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} (dapat ${JSON.stringify(actual)}, harap ${JSON.stringify(expected)})`);
  if (!ok) failures++;
}

const NOW = new Date("2026-10-16T00:00:00Z").getTime();
const HARI = 86400000;
const hariLalu = (n) => new Date(NOW - n * HARI).toISOString();

/**
 * Klien Supabase tiruan untuk src/lib/piutang.js — hanya operator yang benar-benar
 * dipakai (select/eq/gt/in/order/limit + thenable). Tabel lain = gagal keras,
// supaya tiruan tidak diam-diam "setuju" atas hal yang tidak dimengerti.
 */
function fakeLedger({ tx = [], rec = [], txError = null, recError = null } = {}) {
  const bikin = (table) => {
    const q = { table, op: "select", filter: {} };
    const api = {
      select: () => api,
      eq: (k, v) => ((q.filter[k] = v), api),
      gt: (k, v) => ((q.filter[`${k}__gt`] = v), api),
      in: (k, v) => ((q.filter[`${k}__in`] = v), api),
      order: () => api,
      limit: () => api,
      then: (resolve, reject) =>
        Promise.resolve()
          .then(() => {
            if (q.table === "balance_transactions") {
              if (txError) return { data: null, error: { message: txError } };
              return { data: tx.filter((r) => Number(r.uncovered_amount) > Number(q.filter.uncovered_amount__gt || 0)), error: null };
            }
            if (q.table === "balance_recoveries") {
              if (recError) return { data: null, error: { message: recError } };
              const ids = q.filter.earning_tx_id__in || [];
              return { data: rec.filter((r) => ids.includes(r.earning_tx_id)), error: null };
            }
            throw new Error(`fakeLedger: tabel "${q.table}" tidak dikenal`);
          })
          .then(resolve, reject),
    };
    return api;
  };
  return { from: bikin };
}

/* ------------------------------------------------------------------ */
console.log("1. Keranjang umur piutang — batas inklusif, tanpa umur yang lolos");
{
  const piutang = [
    { outstanding: 1000, created_at: hariLalu(0) },
    { outstanding: 2000, created_at: hariLalu(30) },
    { outstanding: 3000, created_at: hariLalu(31) },
    { outstanding: 4000, created_at: hariLalu(60) },
    { outstanding: 5000, created_at: hariLalu(61) },
    { outstanding: 6000, created_at: hariLalu(90) },
    { outstanding: 7000, created_at: hariLalu(91) },
    { outstanding: 8000, created_at: hariLalu(200) },
  ];
  const u = keranjangUmurPiutang(piutang, { now: NOW, hariJatuhTempo: 30 });
  eq("0-30 hari (0 & 30 hari masuk sini)", u.buckets.h0_30, 3000);
  eq("31-60 hari (31 & 60 masuk sini)", u.buckets.h31_60, 7000);
  eq("61-90 hari (61 & 90 masuk sini)", u.buckets.h61_90, 11000);
  eq(">90 hari (91+ hari)", u.buckets.hLebih90, 15000);
  eq("total piutang terbuka", u.total, 36000);
  eq("jumlah baris pesanan", u.baris, 8);
  eq("umur tertua", u.tertua, 200);
  check(
    "setiap rupiah masuk tepat satu keranjang",
    Object.values(u.buckets).reduce((s, v) => s + v, 0) === u.total
  );

  // Jatuh tempo = LEBIH TUA dari ambang (bukan sama dengan) — umur 30 hari
  // tepat di batas masih dianggap wajar, 31 hari sudah menagih perhatian.
  eq("jatuh tempo > 30 hari saja", u.jatuhTempo.total, 33000);
  eq("baris jatuh tempo", u.jatuhTempo.baris, 6);
  eq("umur tertua yang jatuh tempo", u.jatuhTempo.tertua, 200);
  eq("ambang yang dipakai dikembalikan ke pemanggil", u.jatuhTempo.hari, 30);

  // Ambang bisa dinaikkan tanpa mengubah keranjangnya: 45 hari → yang menagih
  // perhatian hanya umur 60 hari ke atas (4000+5000+6000+7000+8000).
  const u45 = keranjangUmurPiutang(piutang, { now: NOW, hariJatuhTempo: 45 });
  eq("ambang 45 hari → hanya umur 60+ yang jatuh tempo", u45.jatuhTempo.total, 30000);
  eq("keranjang tidak berubah oleh ambang", u45.buckets, u.buckets);

  const kosong = keranjangUmurPiutang([], { now: NOW });
  eq("tanpa piutang → nol", [kosong.total, kosong.baris, kosong.tertua, kosong.jatuhTempo.total], [0, 0, 0, 0]);
  const nol = keranjangUmurPiutang([{ outstanding: 0.4, created_at: hariLalu(120) }], { now: NOW });
  eq("piutang terbulatkan nol dibuang", [nol.baris, nol.total], [0, 0]);
}

console.log("\n2. Piutang terbuka per baris = uncovered − pelunasan (dibagi setoran & penghapusan)");
{
  eq("belum dilunasi sama sekali", piutangTerbukaBaris({ uncovered: 20000, dilunasi: 0 }), 20000);
  eq("sebagian dilunasi setoran", piutangTerbukaBaris({ uncovered: 20000, dilunasi: 5000 }), 15000);
  eq("dilunasi lebih dari piutang → nol (tidak pernah negatif)", piutangTerbukaBaris({ uncovered: 10000, dilunasi: 25000 }), 0);
  eq("argumen kosong aman", piutangTerbukaBaris({}), 0);
}

console.log("\n3. Pembacaan ledger (src/lib/piutang.js) lewat klien tiruan — tanpa jaringan");
{
  const tx = [
    { id: "t1", technician_id: "teknisi-a", booking_id: "b1", uncovered_amount: 20000, created_at: hariLalu(120) },
    { id: "t2", technician_id: "teknisi-a", booking_id: "b2", uncovered_amount: 10000, created_at: hariLalu(10) },
    { id: "t3", technician_id: "teknisi-b", booking_id: "b3", uncovered_amount: 5000, created_at: hariLalu(70) },
    { id: "t4", technician_id: "teknisi-b", booking_id: "b4", uncovered_amount: 0, created_at: hariLalu(5) },
  ];
  const rec = [
    { earning_tx_id: "t1", amount: 5000, kind: "setoran" },
    { earning_tx_id: "t3", amount: 5000, kind: "penghapusan" },
  ];
  const { perTeknisi, error, pelunasanTerbaca, ambangHari } = await bacaPiutangTerbuka(fakeLedger({ tx, rec }));
  check("tanpa error saat skema lengkap", error === null);
  check("pelunasan terbaca", pelunasanTerbaca === true);
  eq("ambang hari dari env/default", ambangHari, PIUTANG_TENGGAT_HARI);
  eq("hanya teknisi yang masih punya piutang terbuka", [...perTeknisi.keys()].sort(), ["teknisi-a"]);
  const a = perTeknisi.get("teknisi-a");
  eq("pelunasan setoran mengurangi piutang terbuka", a.umur.total, 15000 + 10000);
  eq("keranjang umur per teknisi", a.umur.buckets.hLebih90, 15000);
  eq("piutang 10 hari ada di keranjang pertama", a.umur.buckets.h0_30, 10000);
  eq("baris piutang terkumpul per pesanan", a.items.length, 2);

  // Penghapusan (kind='penghapusan') ikut menutup piutang: itulah bedanya dengan
  // clamp lama yang membuang piutang TANPA baris pelunasan.
  const hanyaHapus = await bacaPiutangTerbuka(fakeLedger({ tx: [tx[2]], rec: [{ earning_tx_id: "t3", amount: 5000, kind: "penghapusan" }] }));
  eq("piutang yang dihapus penuh lepas dari daftar terbuka", [...hanyaHapus.perTeknisi.keys()], []);
  const sebagian = await bacaPiutangTerbuka(fakeLedger({ tx: [tx[2]], rec: [{ earning_tx_id: "t3", amount: 2000, kind: "penghapusan" }] }));
  eq("penghapusan sebagian menyisakan sisa piutang", sebagian.perTeknisi.get("teknisi-b").umur.total, 3000);

  const rusak = await bacaPiutangTerbuka(fakeLedger({ tx, txError: 'column "uncovered_amount" does not exist' }));
  check("kolom piutang belum dimigrasi → pesan menyebut migrasinya", /migrate|enforce-full-charge-balance/i.test(rusak.error || ""));
  eq("gagal membaca → tidak ada teknisi yang dilaporkan (bukan angka palsu)", rusak.perTeknisi.size, 0);

  const tanpaTabel = await bacaPiutangTerbuka(fakeLedger({ tx: [tx[0]], rec: [], recError: 'relation "balance_recoveries" does not exist' }));
  check("tabel pelunasan belum ada → tidak melempar, pelunasanTerbaca=false", tanpaTabel.pelunasanTerbaca === false);
  eq("piutang tetap terbaca sebesar uncovered (konservatif)", tanpaTabel.perTeknisi.get("teknisi-a").umur.total, 20000);
}

console.log("\n4. Pemilihan penerima PENGINGAT OTOMATIS (murni, idempoten)");
{
  const teknisi = (label, hari, reminderTerakhir = null) => ({
    id: label,
    nama: label,
    email: `${label}@contoh.test`,
    saldo: -25000,
    masihAktif: false,
    reminderTerakhir,
    items: [{ outstanding: 25000, created_at: hariLalu(hari) }],
  });

  const p = pilihPengingatPiutang({
    teknisi: [
      teknisi("baru-5-hari", 5),
      teknisi("jatuh-tempo-60", 60),
      teknisi("baru-diingatkan", 60, new Date(NOW - 3 * HARI).toISOString()),
      teknisi("sudah-lewat-jeda", 60, new Date(NOW - 8 * HARI).toISOString()),
      teknisi("penanda-rusak", 60, "bukan-tanggal"),
      teknisi("tepat-di-batas", 30),
    ],
    ambangHari: 30,
    ulangHari: PIUTANG_ULANG_INGAT_HARI,
    sekarang: NOW,
  });

  eq(
    "hanya yang LEWAT ambang yang diingatkan",
    p.kirim.map((k) => k.id).sort(),
    ["jatuh-tempo-60", "penanda-rusak", "sudah-lewat-jeda"]
  );
  eq("baru diingatkan (< 7 hari) dilewati", p.dilewati.map((k) => k.id), ["baru-diingatkan"]);
  eq("alasan pelewatan tercatat", p.dilewati[0].alasan, "baru diingatkan");
  eq("belum jatuh tempo tidak dikirimi", p.belumJatuhTempo.map((k) => k.id).sort(), ["baru-5-hari", "tepat-di-batas"]);
  check(
    "menjalankan ulang tidak mengirim dua kali",
    pilihPengingatPiutang({
      teknisi: [teknisi("jatuh-tempo-60", 60, new Date(NOW).toISOString())],
      ambangHari: 30,
      ulangHari: PIUTANG_ULANG_INGAT_HARI,
      sekarang: NOW,
    }).kirim.length === 0
  );
  eq("nominal yang disebut pengingat = piutang JATUH TEMPO", p.kirim.find((k) => k.id === "jatuh-tempo-60").jatuhTempo, 25000);
  eq("umur tertua dibawa untuk pesan", p.kirim.find((k) => k.id === "jatuh-tempo-60").tertuaJatuhTempo, 60);
  eq("ambang & jeda dikembalikan untuk laporan cron", [p.ambangHari, p.ulangHari], [30, PIUTANG_ULANG_INGAT_HARI]);

  const ketat = pilihPengingatPiutang({ teknisi: [teknisi("umur-40", 40)], ambangHari: 45, sekarang: NOW });
  eq("ambang 45 hari → umur 40 hari belum diingatkan", [ketat.kirim.length, ketat.belumJatuhTempo.length], [0, 1]);
  eq("tanpa teknisi → kosong", pilihPengingatPiutang({ sekarang: NOW }).kirim.length, 0);
}

console.log("\n5. Ambang jatuh tempo bisa diatur server (env), default tetap 30 hari");
{
  eq("default 30 hari", ambangPiutangHari(), 30);
  const lama = process.env.PIUTANG_JATUH_TEMPO_HARI;
  process.env.PIUTANG_JATUH_TEMPO_HARI = "45";
  eq("PIUTANG_JATUH_TEMPO_HARI=45 dipakai", ambangPiutangHari(), 45);
  process.env.PIUTANG_JATUH_TEMPO_HARI = "0";
  eq("nilai tidak masuk akal jatuh ke default", ambangPiutangHari(), PIUTANG_TENGGAT_HARI);
  if (lama === undefined) delete process.env.PIUTANG_JATUH_TEMPO_HARI;
  else process.env.PIUTANG_JATUH_TEMPO_HARI = lama;
}

/* ------------------------------------------------------------------ */
console.log("\n6. Wiring: pengajuan & persetujuan penghapusan (aksi admin)");
const adminSrc = readFileSync(join(root, "src/app/actions/admin.js"), "utf8");
const piutangSrc = readFileSync(join(root, "src/lib/piutang.js"), "utf8");
const reminderSrc = readFileSync(join(root, "src/lib/piutang-reminder.js"), "utf8");
const pricingSrc = readFileSync(join(root, "src/lib/pricing.js"), "utf8");
const cronSrc = readFileSync(join(root, "src/app/api/cron/piutang-reminder/route.js"), "utf8");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));

check("ada pembaca piutang bersama (dipakai panel & cron)", adminSrc.includes("bacaPiutangTerbuka(supabase)"));
check("satu sumber rumus piutang antar tampilan", piutangSrc.includes("piutangTerbukaBaris") && piutangSrc.includes("keranjangUmurPiutang"));
check("admin bisa melihat ringkasan umur", /export async function getPiutangUmurAdmin/.test(adminSrc));
check("pengajuan penghapusan = aksi admin terpisah", /export async function requestPiutangWriteoffAdmin/.test(adminSrc));
check("keputusan penghapusan = aksi admin terpisah", /export async function decidePiutangWriteoffAdmin/.test(adminSrc));
check("ALASAN wajib saat mengajukan (jejak audit)", /Tulis alasan penghapusan \(minimal 10 karakter\)/.test(adminSrc));
check("hanya satu pengajuan pending per teknisi dicegah di aplikasi", /Sudah ada pengajuan penghapusan yang menunggu persetujuan/.test(adminSrc));
check("menolak tanpa alasan ditolak", /Tulis alasan penolakan \(minimal 5 karakter\)/.test(adminSrc));
check("persetujuan dijalankan sebagai satu transaksi DB (RPC)", /rpc\("approve_piutang_writeoff"/.test(adminSrc));
check("teknisi yang tidak punya piutang tidak bisa dihapuskan", /tidak punya piutang terbuka untuk dihapuskan/.test(adminSrc));
check("tab Saldo menerima umur piutang dari server (bukan menebak)", adminSrc.includes("piutangUmur: keranjangUmurPiutang(") && adminSrc.includes("piutang_buckets"));
check("papan Hari Ini menerima tugas piutang (jatuh tempo)", adminSrc.includes("piutangJatuhTempo") || /jatuhTempo: baris\.filter/.test(adminSrc));

console.log("\n7. Wiring: SQL penghapusan (kolom jenis, pengajuan, RPC atomik)");
const woSql = readFileSync(join(root, "supabase/migrate-piutang-writeoff.sql"), "utf8");
check("jenis pelunasan dibedakan (setoran vs penghapusan)", /add column if not exists kind text not null default 'setoran'/.test(woSql));
check("CHECK jenis pelunasan benar", /check \(kind in \('setoran', 'penghapusan'\)\)/.test(woSql));
check("ada tabel pengajuan penghapusan", /create table if not exists public\.piutang_writeoffs/.test(woSql));
check("satu pengajuan PENDING per teknisi (index unik parsial)", /create unique index if not exists piutang_writeoffs_pending_unique[\s\S]{0,120}where status = 'pending'/.test(woSql));
check("alasan wajib kolom not null", /reason text not null/.test(woSql));
check("status keputusan terbatas (pending/approved/rejected)", /check \(status in \('pending', 'approved', 'rejected'\)\)/.test(woSql));
check("RLS: hanya admin membaca/menulis pengajuan", ["pw_select_admin", "pw_insert_admin", "pw_update_admin"].every((p) => woSql.includes(p)));
check("keputusan dikunci (FOR UPDATE) → tidak bisa dihapus dua kali", /for update/.test(woSql));
check("persetujuan mencatat pelunasan kind='penghapusan'", /v_terbuka, 'penghapusan', v_catatan/.test(woSql));
check("persetujuan menulis baris penyesuaian (invarian saldo = Σ mutasi)", /'adjustment', v_total/.test(woSql));
check("persetujuan menaikkan saldo teknisi", /set balance = v_saldo_baru/.test(woSql));
check("hanya admin yang boleh menghapuskan (dicek di DB)", /if not public\.is_admin\(\)/.test(woSql));
check("status pengajuan diubah + keputusan dicatat", /set status = 'approved'/.test(woSql) && /decided_by/.test(woSql));
check("RPC tidak terbuka untuk publik", /revoke all on function public\.approve_piutang_writeoff\(uuid, text\) from public/.test(woSql));

console.log("\n8. Wiring: pengingat otomatis (cron, jadwal, idempoten, push+email)");
check("aturan pemilihan penerima murni & satu sumber", /export function pilihPengingatPiutang/.test(pricingSrc) && reminderSrc.includes("pilihPengingatPiutang"));
check("pengingat memakai pembaca piutang yang sama dengan panel", reminderSrc.includes("bacaPiutangTerbuka"));
check("penanda idempoten memakai kolom yang juga dipakai pengingat manual", reminderSrc.includes("balance_reminder_at"));
check("pengingat otomatis memakai jalur notifikasi yang sama", reminderSrc.includes("sendPushToUser") && reminderSrc.includes("sendTechnicianBalanceReminderEmail"));
check("mode uji: tandai tanpa kirim / hitung saja", /kirim = true, dry = false/.test(reminderSrc));
check("ambang & jeda bisa dikembalikan untuk laporan", reminderSrc.includes("ambangHari: ambang") && reminderSrc.includes("ulangHari: ulang"));
check("cron melaporkan total yang diproses (dikirim + dilewati)", reminderSrc.includes("total: dikirim.length + pilihan.dilewati.length"));
check("endpoint cron ada", /export async function GET/.test(cronSrc));
check("endpoint cron ber-auth (CRON_SECRET / localhost)", cronSrc.includes("cronAuthorized(request)"));
check("endpoint cron hanya baca/tulis piutang lewat lib bersama", cronSrc.includes("jalankanPengingatPiutang"));
check("endpoint cron melaporkan penerima & pelewatan", cronSrc.includes("dilewatiBaruDiingatkan") && cronSrc.includes("piutangJatuhTempo"));
check(
  "cron terjadwal di vercel.json (harian)",
  (vercel.crons || []).some((c) => c.path === "/api/cron/piutang-reminder" && !!c.schedule)
);
check("email pengingat menerangkan umur piutang", /piutang|umurHari/.test(readFileSync(join(root, "src/lib/email.js"), "utf8")));
check("pengingat MANUAL admin & otomatis memakai penanda yang sama", /balance_reminder_at/.test(adminSrc));

console.log("\n9. Wiring: UI tab Saldo (keranjang umur + tindakan) & panel Hari Ini");
const saldoUi = readFileSync(join(root, "src/components/TechnicianBalancesTab.js"), "utf8");
check("tab Saldo menampilkan keranjang umur piutang", /Umur piutang teknisi/.test(saldoUi) && saldoUi.includes("piutang_buckets"));
check("empat keranjang ditampilkan", ["0-30 hari", "31-60 hari", "61-90 hari", ">90 hari"].every((l) => saldoUi.includes(l)));
check("aksi mengingatkan setor per teknisi", saldoUi.includes("Ingatkan"));
check("aksi MENGAJUKAN penghapusan", saldoUi.includes("Ajukan penghapusan"));
check("aksi MEMUTUSKAN penghapusan (persetujuan)", saldoUi.includes("Putuskan penghapusan"));
check("persetujuan butuh centang eksplisit (tidak terklik sambil lalu)", saldoUi.includes("Saya sudah memeriksa piutang ini"));
check("alasan penghapusan menjelaskan konsekuensinya (kerugian, bukan setoran)", /kerugian/.test(saldoUi) && /penghapusan/.test(saldoUi));
check("tab Saldo memakai aksi admin (bukan tulis DB sendiri)", saldoUi.includes("requestPiutangWriteoffAdmin") && saldoUi.includes("decidePiutangWriteoffAdmin"));
check("piutang terberat (tertua) diurutkan lebih dulu", /piutang_tertua/.test(saldoUi));

const boardUi = readFileSync(join(root, "src/components/DailyOpsBoardTab.js"), "utf8");
check("panel Hari Ini punya kartu piutang jatuh tempo", boardUi.includes("Piutang jatuh tempo"));
check("panel Hari Ini punya daftar tugas piutang", /Piutang teknisi perlu tindak/.test(boardUi));
check("tugas piutang menampilkan umur & nominal", boardUi.includes("r.tertua") && boardUi.includes("formatRupiah(r.total)"));
check("tugas piutang bisa diingatkan langsung dari papan", boardUi.includes("remindTechnicianBalanceAdmin("));
check("papan menautkan ke tab Saldo untuk penghapusan", boardUi.includes("onOpenBalances"));
check("papan menandai belum pernah diingatkan", boardUi.includes("belum pernah diingatkan"));
check(
  "papan tidak mengklaim 'tidak ada yang perlu ditindak' bila ada piutang jatuh tempo",
  // Boleh berupa KONDISI TUNGGAL (diakhiri `;`) atau SALAH SATU syarat gabungan
  // (`&&`) — papan kini juga menunggu keterlambatan mulai dan laporan no-show,
  // jadi syarat kosongnya berisi beberapa bagian. Yang dijaga tetap sama:
  // piutang jatuh tempo HARUS ikut menentukan keadaan "tidak ada tugas".
  /piutangJatuhTempo\.length === 0\s*(?:&&|;)/.test(boardUi)
);
check("AdminDashboard menyambungkan tab Saldo dari papan", /onOpenBalances=\{\(\) => setTab\("tech-balances"\)\}/.test(readFileSync(join(root, "src/components/AdminDashboard.js"), "utf8")));

console.log("\n9b. Laporan keuangan admin menampilkan keranjang umur yang sama");
const financeUi = readFileSync(join(root, "src/components/FinanceSummary.js"), "utf8");
check("ringkasan keuangan admin membaca umur piutang dari server", financeUi.includes("summary.piutangUmur"));
check(
  "ringkasan keuangan menampilkan EMPAT keranjang yang sama",
  ["0-30 hari", "31-60 hari", "61-90 hari", ">90 hari"].every((l) => financeUi.includes(l))
);
check("ringkasan keuangan menyebut bagian yang JATUH TEMPO", /Jatuh tempo/.test(financeUi) && financeUi.includes("jatuhTempo?.total"));
check("ringkasan keuangan menunjukkan umur tertua", financeUi.includes("umur.tertua"));
check(
  "ringkasan keuangan menjelaskan penghapusan = kerugian (bukan uang masuk)",
  /kerugian/.test(financeUi) && /Saldo Aktif/.test(financeUi)
);
check(
  "angka umur dihitung SERVER untuk laporan keuangan",
  /const piutangUmur = keranjangUmurPiutang\(/.test(adminSrc) && /^\s*piutangUmur,$/m.test(adminSrc)
);
check(
  "komponen klien TIDAK menghitung umur sendiri (satu sumber: server)",
  !/keranjangUmurPiutang\(|umurHariPiutang\(|PIUTANG_TENGGAT_HARI/.test(financeUi)
);

console.log("\n10. Dokumen aturan ikut mengunci kebijakan ini");
const aturanDoc = readFileSync(join(root, "docs/balance-rule.md"), "utf8");
check("dokumen menunjuk migrasi penghapusan", aturanDoc.includes("migrate-piutang-writeoff.sql"));
check("dokumen menunjuk endpoint cron pengingat", aturanDoc.includes("/api/cron/piutang-reminder"));
check("dokumen menjelaskan keranjang umur", /keranjang umur|0-30|31-60/i.test(aturanDoc));
check("dokumen menjelaskan penghapusan = kerugian (bukan pemulihan setoran)", /penghapusan/i.test(aturanDoc) && /kerugian/i.test(aturanDoc));

/* ------------------------------------------------------------------ */
if (process.argv.includes("--live")) {
  await liveProof();
}

console.log(`\n${failures === 0 ? "LULUS" : "GAGAL"}: ${failures} kegagalan`);
process.exit(failures === 0 ? 0 : 1);

/**
 * BUKTI HIDUP pada database nyata (dipanggil dengan --live).
 *
 * Menjalankan jalur yang SAMA dengan produksi — `jalankanPengingatPiutang()` yang
 * dipakai endpoint cron dan `approve_piutang_writeoff` yang dipakai panel admin —
 * pada satu akun teknisi uji, lalu membersihkannya. Yang dibuktikan hanya bisa
 * dibuktikan di sini: umur piutang diambil dari `created_at` ledger sungguhan,
 * penanda pengingat benar-benar tertulis, dan persetujuan penghapusan benar-benar
 * satu transaksi (pelunasan + adjustment + saldo).
 */
async function liveProof() {
  const { loadEnv, makeAdminClient, makeUserClient, createTempUser, deleteTempUsers, sleep } = await import(
    "./lib/probe-env.mjs"
  );
  const { jalankanPengingatPiutang } = await import("../src/lib/piutang-reminder.js");
  const { bacaPiutangTerbuka } = await import("../src/lib/piutang.js");

  console.log("\n11. BUKTI HIDUP (--live): pengingat otomatis + penghapusan berpersetujuan");

  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err.code === "NO_CREDENTIALS") {
      console.log(`GATE: GAGAL_DIJALANKAN — kredensial probe tidak tersedia. Kurang: ${(err.missing ?? []).join(", ")}`);
      process.exit(3);
    }
    throw err;
  }
  const admin = makeAdminClient(env);

  // ---- Prasyarat migrasi: diperiksa SEBELUM data uji dibuat (agar tidak ada
  // sisa data bila migrasinya belum jalan) ----
  const { error: kindErr } = await admin.from("balance_recoveries").select("kind").limit(1);
  const { error: woErr } = await admin.from("piutang_writeoffs").select("id").limit(1);
  if (kindErr || woErr) {
    console.log(`GATE: MIGRASI_BELUM_JALAN — ${kindErr?.message || woErr?.message}`);
    console.log("   Jalankan: npm run apply:sql -- supabase/migrate-piutang-writeoff.sql --apply");
    process.exit(2);
  }

  const rpcUji = await admin.rpc("approve_piutang_writeoff", { p_writeoff: "00000000-0000-0000-0000-000000000000" });
  check(
    "RPC approve_piutang_writeoff terpasang di database",
    !/could not find the function|does not exist|schema cache|permission denied/i.test(rpcUji.error?.message || ""),
    rpcUji.error?.message ?? ""
  );
  check(
    "penjaga admin ada DI DALAM fungsi (service role pun ditolak, bukan crash)",
    rpcUji.data?.ok === false,
    rpcUji.data?.error ?? ""
  );

  const PIUTANG_LAMA = 14000; // 120 hari → keranjang >90 hari, JATUH TEMPO
  const PIUTANG_BARU = 6000; // 10 hari  → keranjang 0-30 hari, belum jatuh tempo
  const TOTAL = PIUTANG_LAMA + PIUTANG_BARU;
  let teknisi = null;
  let adminUser = null;

  try {
    console.log("--- 11.1 Akun uji: teknisi berpiutang BERUMUR (120 hari + 10 hari) ---");
    teknisi = await createTempUser(admin, "technician", "wo-tech");
    adminUser = await createTempUser(admin, "admin", "wo-admin");
    const { error: prepErr } = await admin
      .from("profiles")
      .update({ approval_status: "approved", commission_rate: DEFAULT_COMMISSION_RATE, balance: -TOTAL })
      .eq("id", teknisi.id);
    if (prepErr) throw new Error(`gagal menyiapkan teknisi uji: ${prepErr.message}`);
    const { error: ledgerErr } = await admin.from("balance_transactions").insert([
      {
        technician_id: teknisi.id,
        type: "earning",
        amount: -PIUTANG_LAMA,
        commission_amount: 10000,
        uncovered_amount: PIUTANG_LAMA,
        note: "UJI PIUTANG berumur 120 hari — aman dihapus",
        created_at: new Date(Date.now() - 120 * HARI).toISOString(),
      },
      {
        technician_id: teknisi.id,
        type: "earning",
        amount: -PIUTANG_BARU,
        commission_amount: 4000,
        uncovered_amount: PIUTANG_BARU,
        note: "UJI PIUTANG berumur 10 hari — aman dihapus",
        created_at: new Date(Date.now() - 10 * HARI).toISOString(),
      },
    ]);
    if (ledgerErr) throw new Error(`gagal menulis ledger uji: ${ledgerErr.message}`);
    check(`piutang uji siap: Rp ${TOTAL.toLocaleString("id-ID")} (saldo −Rp ${TOTAL.toLocaleString("id-ID")})`, true);

    console.log("--- 11.2 Pengingat otomatis memilih piutang JATUH TEMPO ---");
    const r1 = await jalankanPengingatPiutang(admin, { kirim: false });
    const milikSaya = r1.dikirim.find((d) => d.id === teknisi.id);
    check("teknisi berpiutang jatuh tempo masuk daftar pengingat", Boolean(milikSaya));
    check(
      `yang ditagih = piutang JATUH TEMPO saja (Rp ${PIUTANG_LAMA.toLocaleString("id-ID")})`,
      Number(milikSaya?.jatuhTempo) === PIUTANG_LAMA,
      `dapat Rp ${Number(milikSaya?.jatuhTempo ?? 0).toLocaleString("id-ID")}`
    );
    check(`umur tertua dibaca dari ledger = 120 hari`, Number(milikSaya?.tertua) === 120, `dapat ${milikSaya?.tertua}`);
    check(
      "keranjang umur benar pada data sungguhan (>90 = 14.000, 0-30 = 6.000)",
      Number(milikSaya?.buckets?.hLebih90) === PIUTANG_LAMA && Number(milikSaya?.buckets?.h0_30) === PIUTANG_BARU,
      JSON.stringify(milikSaya?.buckets)
    );

    console.log("--- 11.3 Penanda pengingat + IDEMPOTENSI ---");
    const { data: sesudahIngat } = await admin.from("profiles").select("balance_reminder_at").eq("id", teknisi.id).single();
    check(
      "penanda balance_reminder_at tertulis (banner aplikasi + penjaga idempotensi)",
      Boolean(sesudahIngat?.balance_reminder_at),
      sesudahIngat?.balance_reminder_at ?? "(kosong)"
    );
    const r2 = await jalankanPengingatPiutang(admin, { kirim: false });
    check("jalan kedua TIDAK mengirim lagi (idempoten)", !r2.dikirim.some((d) => d.id === teknisi.id));
    check(
      "pelewatan tercatat beserta alasannya",
      r2.dilewati.some((d) => d.id === teknisi.id && d.alasan === "baru diingatkan")
    );
    const r3 = await jalankanPengingatPiutang(admin, { hari: 200, kirim: false });
    check("ambang 200 hari → piutang 120 hari tidak ditagih", r3.belumJatuhTempo.some((d) => d.id === teknisi.id));

    console.log("--- 11.4 Pengajuan penghapusan: satu pending per teknisi ---");
    const { data: pengajuan, error: insErr } = await admin
      .from("piutang_writeoffs")
      .insert({
        technician_id: teknisi.id,
        amount: TOTAL,
        reason: "Teknisi berhenti — tagihan akhir tidak tersisa (uji otomatis).",
        oldest_days: 120,
        technician_active: false,
        requested_by: adminUser.id,
      })
      .select("id,status")
      .single();
    check("pengajuan tersimpan sebagai pending", !insErr && pengajuan?.status === "pending", insErr?.message ?? "");
    const ganda = await admin.from("piutang_writeoffs").insert({
      technician_id: teknisi.id,
      amount: 1000,
      reason: "Pengajuan ganda — harus ditolak (uji otomatis).",
      requested_by: adminUser.id,
    });
    check("pengajuan kedua DITOLAK (index unik: satu pending per teknisi)", Boolean(ganda.error));

    console.log("--- 11.5 Teknisi (bukan admin) tidak bisa menghapuskan piutang ---");
    const techClient = makeUserClient(env);
    const { error: techSignErr } = await techClient.auth.signInWithPassword({
      email: teknisi.email,
      password: teknisi.password,
    });
    if (techSignErr) throw new Error(`sign-in teknisi uji gagal: ${techSignErr.message}`);
    await sleep(300);
    const ditolak = await techClient.rpc("approve_piutang_writeoff", { p_writeoff: pengajuan.id });
    check("RPC menolak teknisi", ditolak.data?.ok === false || Boolean(ditolak.error));
    check(
      "alasannya menyebut admin",
      /admin/i.test(ditolak.data?.error || ditolak.error?.message || ""),
      ditolak.data?.error || ditolak.error?.message || ""
    );

    console.log("--- 11.6 Persetujuan admin = satu transaksi (pelunasan + adjustment + saldo) ---");
    const adminClient = makeUserClient(env);
    const { error: adminSignErr } = await adminClient.auth.signInWithPassword({
      email: adminUser.email,
      password: adminUser.password,
    });
    if (adminSignErr) throw new Error(`sign-in admin uji gagal: ${adminSignErr.message}`);
    await sleep(300);
    const setuju = await adminClient.rpc("approve_piutang_writeoff", {
      p_writeoff: pengajuan.id,
      p_note: "Uji otomatis — teknisi dikonfirmasi berhenti.",
    });
    const hasil = setuju.data;
    check("admin bisa menyetujui penghapusan", hasil?.ok === true, setuju.error?.message ?? hasil?.error ?? "");
    check(`nominal yang dihapuskan = Rp ${TOTAL.toLocaleString("id-ID")}`, Number(hasil?.amount) === TOTAL, `dapat ${hasil?.amount}`);
    check(`dua baris pesanan ditutup`, Number(hasil?.orders) === 2, `dapat ${hasil?.orders}`);
    check(
      `saldo naik dari −Rp ${TOTAL.toLocaleString("id-ID")} ke Rp ${Number(hasil?.balance ?? -1).toLocaleString("id-ID")}`,
      Number(hasil?.balance) === 0 && Number(hasil?.saldoSebelum) === -TOTAL,
      `saldoSebelum=${hasil?.saldoSebelum} balance=${hasil?.balance}`
    );

    console.log("--- 11.7 Jejak di buku: pelunasan 'penghapusan' + adjustment + saldo = Σ mutasi ---");
    const { data: rec } = await admin
      .from("balance_recoveries")
      .select("amount,kind")
      .eq("technician_id", teknisi.id);
    check("dua pelunasan tercatat", (rec ?? []).length === 2, `dapat ${(rec ?? []).length}`);
    check("semuanya jenis 'penghapusan' (bukan setoran/uang masuk)", (rec ?? []).every((r) => r.kind === "penghapusan"));
    check(
      "total pelunasan = besar piutang",
      (rec ?? []).reduce((s, r) => s + Number(r.amount), 0) === TOTAL
    );
    const { data: adj } = await admin
      .from("balance_transactions")
      .select("amount,note")
      .eq("technician_id", teknisi.id)
      .eq("type", "adjustment");
    check("baris penyesuaian ditulis (pelepasan piutang dari buku punya jejak)", (adj ?? []).length === 1);
    const { data: mutasi } = await admin.from("balance_transactions").select("amount").eq("technician_id", teknisi.id);
    const { data: profilAkhir } = await admin.from("profiles").select("balance").eq("id", teknisi.id).single();
    check(
      "invarian saldo = Σ mutasi tetap utuh",
      (mutasi ?? []).reduce((s, x) => s + Number(x.amount), 0) === Number(profilAkhir?.balance),
      `Σ=${(mutasi ?? []).reduce((s, x) => s + Number(x.amount), 0)} saldo=${profilAkhir?.balance}`
    );
    const { perTeknisi: piutangSisa } = await bacaPiutangTerbuka(admin);
    check("piutang terbuka teknisi itu sudah NOL", !piutangSisa.has(teknisi.id));
    const { data: woAkhir } = await admin
      .from("piutang_writeoffs")
      .select("status,decided_by,decided_at,amount")
      .eq("id", pengajuan.id)
      .single();
    check(
      "keputusan tercatat: approved + siapa & kapan",
      woAkhir?.status === "approved" && woAkhir?.decided_by === adminUser.id && Boolean(woAkhir?.decided_at),
      JSON.stringify(woAkhir)
    );
    const lagi = await adminClient.rpc("approve_piutang_writeoff", { p_writeoff: pengajuan.id });
    check("persetujuan kedua DITOLAK (piutang tidak dihapus dua kali)", lagi.data?.ok === false, lagi.data?.error ?? "");
  } finally {
    console.log("--- 11.8 Membersihkan data uji ---");
    if (teknisi) {
      await admin.from("balance_recoveries").delete().eq("technician_id", teknisi.id);
      await admin.from("balance_transactions").delete().eq("technician_id", teknisi.id);
      await admin.from("piutang_writeoffs").delete().eq("technician_id", teknisi.id);
    }
    const hapus = await deleteTempUsers(admin, [teknisi, adminUser]);
    check("akun uji terhapus", (hapus ?? []).every((h) => h.ok), JSON.stringify(hapus));
    if (teknisi) {
      const hitung = async (table) => {
        const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("technician_id", teknisi.id);
        return count ?? 0;
      };
      const sisa = [await hitung("balance_transactions"), await hitung("balance_recoveries"), await hitung("piutang_writeoffs")];
      const { count: sisaProfil } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in("id", [teknisi.id, adminUser?.id].filter(Boolean));
      check(
        "tidak ada data uji tersisa (ledger / pelunasan / pengajuan / profil)",
        sisa.every((c) => c === 0) && (sisaProfil ?? 0) === 0,
        `ledger/rec/writeoff=${sisa.join("/")} profil=${sisaProfil}`
      );
    }
  }
}
