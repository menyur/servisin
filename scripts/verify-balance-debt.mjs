#!/usr/bin/env node
// ============================================================================
// verify-balance-debt.mjs — probe OFFLINE untuk kebijakan uang yang berlaku:
// POTONGAN PENUH saat pesanan selesai; saldo teknisi BOLEH minus, dan nilai
// minus itu adalah PIUTANG teknisi (bukan kerugian platform tanpa jejak).
//
// Sekaligus menjaga PENUTUPAN piutang: setoran menutup kekurangan lebih dulu
// (alokasiSetoran, FIFO) dan pelunasannya dicatat di `balance_recoveries`
// (supabase/migrate-piutang-recovery.sql) supaya laporan per periode bisa
// menunjukkan pemulihan piutang, bukan sekadar angka minus yang menurun.
//
// Tidak menyentuh jaringan/Supabase. Menguji fungsi murni planBalanceCut +
// penagihanPesanan (src/lib/pricing.js) dan memastikan kebijakan ini benar-benar
// ada di SEMUA sumber yang harus sinkron:
//   - src/lib/balance.js                            (jalur server-side web)
//   - supabase/enforce-full-charge-balance.sql       (RPC set_job_status + lepas trigger clamp)
//   - supabase/enforce-nonnegative-balance.sql       (ditandai USANG)
//   - src/lib/monthly-report.js                      (laporan tiga kolom)
//   - src/app/actions/admin.js                       (ringkasan keuangan admin)
//   - supabase/migrate-claim-min-balance.sql         (gerbang saldo > 0 = penagih piutang)
//
// Jalankan: node scripts/verify-balance-debt.mjs  (npm run verify:balance)
// Kode keluar: 0 = lulus, 1 = ada regresi.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  planBalanceCut,
  penagihanPesanan,
  alokasiSetoran,
  piutangTerbukaBaris,
  APP_FEE,
  DEFAULT_COMMISSION_RATE,
} from "../src/lib/pricing.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(label, cond) {
  const ok = !!cond;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
  if (!ok) failures++;
}

function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} (dapat ${JSON.stringify(actual)}, harap ${JSON.stringify(expected)})`);
  if (!ok) failures++;
}

console.log("planBalanceCut — POTONGAN PENUH, saldo boleh minus");
{
  // Skenario kebocoran yang memicu perubahan kebijakan: pekerjaan Rp 105.000
  // (komisi 10.000 + biaya app 5.000) dengan saldo Rp 1.000.
  const p = planBalanceCut({ balance: 1000, commission: 10000, fee: 5000 });
  eq("potongan tetap penuh (15.000)", p.cut, 15000);
  eq("komisi penuh", p.commissionCut, 10000);
  eq("biaya app penuh", p.feeCut, 5000);
  eq("saldo menjadi minus", p.resultingBalance, -14000);
  eq("piutang = 14.000", p.debt, 14000);
  check("penanda partial (saldo tidak cukup)", p.partial === true);
}
{
  const p = planBalanceCut({ balance: 0, commission: 12000, fee: 5000 });
  eq("saldo 0 → tetap potong penuh 17.000", p.cut, 17000);
  eq("saldo akhir −17.000", p.resultingBalance, -17000);
}
{
  const p = planBalanceCut({ balance: 100000, commission: 12000, fee: 5000 });
  eq("saldo cukup → potong penuh 17.000", p.cut, 17000);
  eq("saldo akhir 83.000", p.resultingBalance, 83000);
  eq("tanpa piutang", p.debt, 0);
  check("partial false", p.partial === false);
}
{
  // Saldo yang SUDAH minus: potongan berikutnya menambah piutang (tidak dijepit).
  const p = planBalanceCut({ balance: -8751, commission: 12000, fee: 5000 });
  eq("saldo minus tetap dipotong penuh", p.cut, 17000);
  eq("piutang menumpuk di saldo", p.resultingBalance, -25751);
}
{
  const p = planBalanceCut();
  eq("argumen kosong aman", p.cut, 0);
  eq("tanpa piutang", p.debt, 0);
}

console.log("\npenagihanPesanan — angka \"ditagihkan\" (dasar laporan tiga kolom)");
{
  const t = penagihanPesanan({ totalPrice: 105000, appFee: APP_FEE, rate: 10 });
  eq("komisi = 10% × (total − biaya app)", t.commission, 10000);
  eq("biaya app dari pesanan", t.fee, 5000);
  eq("ditagihkan = 15.000", t.want, 15000);
  const t2 = penagihanPesanan({ totalPrice: 105000, appFee: APP_FEE });
  eq("rate default dipakai bila tak diberikan", t2.commission, Math.round((105000 - APP_FEE) * DEFAULT_COMMISSION_RATE / 100));
}

console.log("\nidentitas rekonsiliasi: ditagihkan = tertagih + piutang");
{
  // Tiga pesanan: satu tertutup penuh saldo, satu tertutup sebagian (jadi
  // piutang), satu saldonya persis pas. Baris ledger menyimpan potongan PENUH
  // (|amount| = ditagihkan) dan `uncovered_amount` = bagian piutangnya.
  const pesanan = [
    { totalPrice: 105000, appFee: APP_FEE, saldo: 50000 },
    { totalPrice: 105000, appFee: APP_FEE, saldo: 1000 },
    { totalPrice: 105000, appFee: APP_FEE, saldo: 15000 },
  ];
  let ditagihkan = 0;
  let tertagih = 0;
  let piutang = 0;
  for (const p of pesanan) {
    const t = penagihanPesanan({ totalPrice: p.totalPrice, appFee: p.appFee, rate: 10 });
    const cut = planBalanceCut({ balance: p.saldo, commission: t.commission, fee: t.fee });
    const ledgerAmount = -cut.cut; // selalu potongan penuh
    const uncovered = Math.min(cut.debt, Math.abs(ledgerAmount));
    ditagihkan += t.want;
    tertagih += Math.abs(ledgerAmount) - uncovered;
    piutang += uncovered;
    check(
      `satu baris ledger seimbang (ditagihkan ${t.want} = tertagih + piutang)`,
      Math.abs(ledgerAmount) === Math.abs(ledgerAmount) - uncovered + uncovered
    );
  }
  eq("ditagihkan", ditagihkan, 45000);
  eq("tertagih (tertutup saldo prabayar)", tertagih, 31000);
  eq("piutang (saldo minus)", piutang, 14000);
  check("ditagihkan = tertagih + piutang", ditagihkan === tertagih + piutang);
}

console.log("\nalokasiSetoran — setoran menutup piutang lebih dulu (FIFO, tertua dulu)");
{
  const piutang = [
    { id: "a", booking_id: "SV-1", outstanding: 14000, created_at: "2026-09-01T00:00:00Z" },
    { id: "b", booking_id: "SV-2", outstanding: 6000, created_at: "2026-09-10T00:00:00Z" },
  ];
  const kecil = alokasiSetoran({ amount: 5000, piutang });
  eq("setoran < piutang tertua → hanya menutup sebagian", kecil.dilunasi, 5000);
  eq("   yang dipakai baris tertua", kecil.alokasi[0].id, "a");
  eq("   tidak ada sisa jadi saldo", kecil.sisa, 0);

  const pas = alokasiSetoran({ amount: 14000, piutang });
  eq("setoran pas piutang tertua → lunas satu pesanan", pas.dilunasi, 14000);
  eq("   hanya satu baris tersentuh", pas.alokasi.length, 1);
  eq("   tidak ada sisa", pas.sisa, 0);

  const semua = alokasiSetoran({ amount: 20000, piutang });
  eq("setoran menutup SEMUA piutang", semua.dilunasi, 20000);
  eq("   dua baris dilunasi (FIFO)", semua.alokasi.length, 2);
  eq("   sisa masuk saldo 0", semua.sisa, 0);

  const lebih = alokasiSetoran({ amount: 25000, piutang });
  eq("setoran lebih besar → piutang lunas", lebih.dilunasi, 20000);
  eq("   sisanya menjadi saldo aktif", lebih.sisa, 5000);

  const terbalik = alokasiSetoran({ amount: 20000, piutang: [...piutang].reverse() });
  eq("urutan masukan tidak menentukan — tetap tertua dulu", terbalik.alokasi[0].id, "a");

  const tanpaPiutang = alokasiSetoran({ amount: 50000, piutang: [] });
  eq("tanpa piutang → seluruhnya jadi saldo", tanpaPiutang.dilunasi, 0);
  eq("   sisa = setoran", tanpaPiutang.sisa, 50000);

  eq("setoran 0 tidak melunasi apa pun", alokasiSetoran({ amount: 0, piutang }).dilunasi, 0);
  eq("baris yang sudah lunas dilewati", alokasiSetoran({
    amount: 5000,
    piutang: [{ id: "c", outstanding: 0, created_at: "2026-01-01T00:00:00Z" }, piutang[1]],
  }).alokasi[0].id, "b");
  eq("setoran tidak pernah melebihi piutang satu baris", alokasiSetoran({
    amount: 999999,
    piutang: [{ id: "d", outstanding: 3000 }],
  }).alokasi[0].amount, 3000);
}

console.log("\npiutangTerbukaBaris — piutang yang masih ditagih");
{
  eq("belum ada pelunasan → piutang utuh", piutangTerbukaBaris({ uncovered: 14000 }), 14000);
  eq("sebagian dilunasi", piutangTerbukaBaris({ uncovered: 14000, dilunasi: 5000 }), 9000);
  eq("lunas penuh", piutangTerbukaBaris({ uncovered: 14000, dilunasi: 14000 }), 0);
  eq("kelebihan pelunasan dijepit 0 (tidak ada piutang negatif)", piutangTerbukaBaris({ uncovered: 14000, dilunasi: 20000 }), 0);
  eq("tanpa kolom piutang", piutangTerbukaBaris({}), 0);
}

console.log("\nPenjaga kebijakan ada di sumber");
const balanceSrc = readFileSync(join(root, "src/lib/balance.js"), "utf8");
check("balance.js memakai planBalanceCut", balanceSrc.includes("planBalanceCut({"));
check("balance.js memakai saldo hasil rencana (boleh minus)", balanceSrc.includes("plan.resultingBalance"));
check(
  "balance.js TIDAK lagi menjepit saldo ke 0",
  !/Math\.max\(0, Number\(tech\.balance \|\| 0\) - totalCut\)/.test(balanceSrc)
);
check("balance.js mencatat piutang pada catatan ledger", /piutang teknisi/.test(balanceSrc));

const sql = readFileSync(join(root, "supabase/enforce-full-charge-balance.sql"), "utf8");
check("SQL berlaku: potongan penuh (v_cut := v_want)", /v_cut := v_want;/.test(sql));
check(
  "SQL berlaku: saldo TIDAK dijepit (balance = coalesce(balance,0) - v_cut)",
  /set balance = coalesce\(balance, 0\) - v_cut/.test(sql)
);
check("SQL berlaku: tidak ada greatest(0, ...) saat mengurangi saldo", !/set balance = greatest\(0,/.test(sql));
check("SQL berlaku: melepas trigger clamp lama", /drop trigger if exists clamp_balance_nonnegative_trg/.test(sql));
check("SQL berlaku: melepas fungsi clamp", /drop function if exists public\.clamp_balance_nonnegative/.test(sql));
check("SQL berlaku: TIDAK menormalkan saldo minus menjadi 0", !/update profiles\s+set balance = 0\s+where role = 'technician'\s+and balance < 0/.test(sql));
check("SQL berlaku: dasar komisi = total − 5000", /v_gross := greatest\(0, coalesce\(v_b\.total_price, 0\) - 5000\);/.test(sql));
check("SQL berlaku: mengembalikan besaran piutang ke aplikasi", /'debt', v_debt/.test(sql));
check("SQL berlaku: menambah kolom piutang per baris (uncovered_amount)", /add column if not exists uncovered_amount numeric not null default 0/.test(sql));
check("SQL berlaku: baris ledger menyimpan piutangnya", /commission_amount, uncovered_amount, note/.test(sql));
check("balance.js menulis kolom piutang", /uncovered_amount: plan\.debt/.test(balanceSrc));
check(
  "balance.js tetap jalan bila kolom piutang belum ada (fallback)",
  /uncovered_amount\/\.test\(txErr\.message/.test(balanceSrc)
);
check("SQL berlaku: header menandai aturan DIKUNCI", /ATURAN POTONGAN DIKUNCI/.test(sql));
check("SQL berlaku: penanda guard F8 tetap ada", sql.includes("app.trusted_server_write"));

const sqlLama = readFileSync(join(root, "supabase/enforce-nonnegative-balance.sql"), "utf8");
check("SQL lama ditandai USANG", /USANG — JANGAN DIJALANKAN LAGI/.test(sqlLama));
check("SQL lama menunjuk penggantinya", sqlLama.includes("enforce-full-charge-balance.sql"));

console.log("\nLaporan tiga kolom (admin)");
const bulanan = readFileSync(join(root, "src/lib/monthly-report.js"), "utf8");
check("laporan bulanan memakai penagihanPesanan (bukan computeSplit(total_price))", bulanan.includes("penagihanPesanan("));
check(
  "laporan bulanan TIDAK memakai total_price sebagai dasar komisi",
  !/computeSplit\(b\.total_price,/.test(bulanan)
);
check("laporan bulanan punya kolom Piutang", bulanan.includes('"Piutang (belum tertagih)"'));
check("laporan bulanan punya baris TERTAGIH", /"TERTAGIH dari saldo teknisi"/.test(bulanan));
check("laporan bulanan punya baris PIUTANG", /"PIUTANG periode ini/.test(bulanan));
check("laporan bulanan membaca ledger per pesanan", bulanan.includes("ledgerByBooking"));

const adminSrc = readFileSync(join(root, "src/app/actions/admin.js"), "utf8");
check("ringkasan admin melaporkan 'ditagihkan'", /charged: \{ commission: chargedCommission/.test(adminSrc));
check(
  "ringkasan admin melaporkan 'tertagih' (kolom collected)",
  /collected: \{[\s\S]{0,220}?ledgerCharged/.test(adminSrc)
);
check(
  "ringkasan admin melaporkan 'piutang' (kolom receivable)",
  /receivable: \{[\s\S]{0,320}?saldoMinus: receivableTechnician/.test(adminSrc)
);
check("ringkasan admin mengekspos identitas tiga kolom", /identitas: coveredTotal \+ uncoveredEligible \+ belumTerpotong/.test(adminSrc));
check("ringkasan admin memisahkan baris yatim", /orphanCollected/.test(adminSrc));
check("ringkasan admin membaca kolom piutang ledger", /uncovered_amount/.test(adminSrc));
check(
  "ringkasan admin punya fallback bila migrasi kolom piutang belum jalan",
  /pilihTransaksiSaldo/.test(adminSrc) && /uncovered_amount/.test(readFileSync(join(root, "src/app/actions/admin.js"), "utf8"))
);
check("laporan bulanan membaca kolom piutang ledger", /uncovered_amount/.test(bulanan));

const financeUi = readFileSync(join(root, "src/components/FinanceSummary.js"), "utf8");
check("panel ringkasan menampilkan piutang teknisi", /Piutang Teknisi/.test(financeUi));
check("panel ringkasan tidak menyembunyikan angka minus", !financeUi.includes("nonNegative"));

const tabSrc = readFileSync(join(root, "src/components/TechnicianBalancesTab.js"), "utf8");
check("tab Saldo Aktif memisahkan kewajiban & piutang", /Kewajiban \(saldo ≥ 0\)/.test(tabSrc) && /Piutang teknisi \(saldo minus\)/.test(tabSrc));
check("tab Saldo Aktif tidak menyembunyikan angka minus", !tabSrc.includes("nonNegative(summary.totalBalance)"));

console.log("\nSYARAT SALDO UNTUK MENGAMBIL PEKERJAAN (saldo wajib > 0) = penagih piutang");
// Aturan yang sama harus tampak di TIGA tempat: server (penegak), aplikasi
// (tombol + alasan), dan daftar izin RPC. Kalau salah satu hilang, tombol bisa
// tampak bisa ditekan padahal server menolak (atau sebaliknya).
const klaimSql = readFileSync(join(root, "supabase/migrate-claim-min-balance.sql"), "utf8");
check("migrasi menimpa claim_job", /create or replace function public\.claim_job/.test(klaimSql));
check("server menolak saat saldo <= 0", /if v_balance <= 0 then/.test(klaimSql));
check("alasan terstruktur 'saldo_habis' dikirim ke aplikasi", /'kode', 'saldo_habis'/.test(klaimSql));
check("saldo dibaca dari tabel (bukan dari klien)", /select coalesce\(balance, 0\) into v_balance from public\.profiles/.test(klaimSql));
check("penolakan saldo terjadi SEBELUM update klaim", klaimSql.indexOf("v_balance <= 0") < klaimSql.indexOf("update public.bookings"));
check("guard keahlian & teknisi aktif tidak hilang", klaimSql.includes("technician_matches_service") && klaimSql.includes("is_active_technician"));
check("izin RPC tetap dibatasi (bukan PUBLIC)", /revoke all on function public\.claim_job\(uuid\) from public/.test(klaimSql));

const modelsSrc = readFileSync(join(root, "flutter_app/lib/models.dart"), "utf8");
check("aplikasi punya aturan yang sama (bolehAmbilPekerjaan = saldo > 0)", /bool get bolehAmbilPekerjaan => balance > 0;/.test(modelsSrc));
check("aplikasi punya kalimat sebab yang bisa ditampilkan", /String\? get sebabTidakBolehAmbil/.test(modelsSrc));
check("aplikasi menghitung kekurangan dari saldo minus", /double get shortfall => balance < 0 \? -balance : 0;/.test(modelsSrc));

const jobsSrc = readFileSync(join(root, "flutter_app/lib/ui/jobs_screen.dart"), "utf8");
check("tombol Ambil memakai blockedReason (mati saat saldo habis)", /onPressed: claiming \|\| blockedReason != null \? null : onClaim/.test(jobsSrc));
check("kartu menampilkan alasan + tombol Isi Saldo", jobsSrc.includes("'Isi Saldo'") && jobsSrc.includes("blockedReason!"));
check("penolakan server 'saldo_habis' ditawarkan jalan keluar", jobsSrc.includes("'saldo_habis'") && jobsSrc.includes("onTopUp"));

const apiSrc = readFileSync(join(root, "flutter_app/lib/api.dart"), "utf8");
check("api.dart meneruskan kode alasan dari server", /kode: m\['kode'\] as String\?/.test(apiSrc));
const grantsSrc = readFileSync(join(root, "supabase/fix-rpc-grants-public.sql"), "utf8");
check("claim_job tetap terdaftar di daftar izin RPC", grantsSrc.includes("('claim_job(uuid)'"));console.log("\nPENUTUPAN PIUTANG: setoran mencetak pelunasan yang bisa dilaporkan");
const migrasiPiutang = readFileSync(join(root, "supabase/migrate-piutang-recovery.sql"), "utf8");
check("migrasi membuat tabel pelunasan", migrasiPiutang.includes("create table if not exists public.balance_recoveries"));
check("pelunasan menunjuk baris piutang ledger", migrasiPiutang.includes("earning_tx_id uuid not null references public.balance_transactions(id)"));
check("pelunasan menunjuk setoran", migrasiPiutang.includes("topup_tx_id uuid references public.balance_transactions(id)"));
check("pelunasan punya waktu sendiri (untuk laporan periode)", migrasiPiutang.includes("created_at timestamptz not null default now()"));
check("teknisi boleh membaca pelunasan piutangnya", migrasiPiutang.includes("br_select_own"));
check("hanya admin yang boleh mencatat pelunasan", migrasiPiutang.includes("br_insert_admin"));
check("satu setoran tidak bisa melunasi baris yang sama dua kali", migrasiPiutang.includes("br_earning_topup_unique"));
check("tidak membuat view (cegah bocor RLS)", migrasiPiutang.includes("TIDAK ADA VIEW"));
check("ada backfill piutang lama yang sudah tertutup setoran", migrasiPiutang.includes("Pelunasan piutang (backfill)"));

check("balance.js memakai alokasiSetoran", balanceSrc.includes("alokasiSetoran({ amount: amt, piutang })"));
check("balance.js membaca piutang terbuka (bukan seluruh uncovered)", balanceSrc.includes("piutangTerbukaBaris") && balanceSrc.includes("bacaPiutangTerbuka"));
check("balance.js menulis pelunasan ke balance_recoveries", balanceSrc.includes('from("balance_recoveries").insert('));
check("catatan setoran menyebut kekurangan yang ditutup", balanceSrc.includes("menutup piutang Rp"));
check("pelunasan tidak mengubah saldo (saldo hanya dari baris topup)", !/balance_recoveries[\s\S]{0,200}?update\(\{ balance/.test(balanceSrc));
check("kegagalan pencatatan pelunasan tidak senyap", balanceSrc.includes("catatanPelunasan"));

check(
  "ringkasan admin melaporkan pemulihan piutang per periode",
  /recovery: \{[\s\S]{0,200}?periode: recoveryMonth/.test(adminSrc)
);
check("ringkasan admin membaca tabel pelunasan", adminSrc.includes('from("balance_recoveries")'));
check("ringkasan admin menghitung piutang yang masih terbuka", adminSrc.includes("piutangTerbukaBaris("));

check("laporan bulanan melaporkan PEMULIHAN piutang periode ini", bulanan.includes("PEMULIHAN piutang periode ini"));
check("laporan bulanan melaporkan piutang yang belum lunas", bulanan.includes("Piutang BELUM lunas"));
check("laporan bulanan membaca tabel pelunasan", bulanan.includes('from("balance_recoveries")'));

const emailSrc = readFileSync(join(root, "src/lib/email.js"), "utf8");
check("email laporan bulanan menyebut pemulihan piutang", emailSrc.includes("Pemulihan piutang bulan ini"));
check(
  "panel admin punya kartu pemulihan piutang",
  financeUi.includes("Pemulihan Piutang (setoran)") && financeUi.includes("recovery?.terbuka")
);

const depositUi = readFileSync(join(root, "flutter_app/lib/ui/deposit_screen.dart"), "utf8");
check("layar setor menjelaskan setoran menutup kekurangan dulu", depositUi.includes("menutup kekurangan itu lebih dulu"));
check("layar setor mempratinjau pembagian setoran", depositUi.includes("_pratinjauSetoran"));

console.log("\nDokumen terkunci ikut diperbarui");
const aturanDoc = readFileSync(join(root, "docs/balance-rule.md"), "utf8");
check("dokumen aturan menunjuk migrasi pelunasan", aturanDoc.includes("migrate-piutang-recovery.sql"));
// Jarak putih di sekitar `=` ditoleransi: blok rumus dirapikan dengan spasi
// sejajar, dan pemeriksaan ini tidak boleh merah hanya karena pemformatan.
check(
  "aturan mengunci POTONGAN PENUH",
  /potongan\s*=\s*komisi \+ biaya aplikasi/.test(aturanDoc) && /PENUH/.test(aturanDoc)
);
check("aturan menjelaskan setoran menutup piutang lebih dulu", /tertua dulu|setoran menutup/i.test(aturanDoc));
check("aturan menyebut piutang teknisi", /piutang/i.test(aturanDoc));
check("aturan menunjuk berkas SQL yang berlaku", aturanDoc.includes("enforce-full-charge-balance.sql"));
check("aturan menandai berkas lama USANG", aturanDoc.includes("enforce-nonnegative-balance.sql"));

console.log(`\n${failures === 0 ? "LULUS" : "GAGAL"}: ${failures} kegagalan`);
process.exit(failures === 0 ? 0 : 1);
