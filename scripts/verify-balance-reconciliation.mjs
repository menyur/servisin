// ============================================================================
// verify-balance-reconciliation.mjs — jaga REKONSILIASI SALDO HARIAN.
//
// Kegagalan yang dijaga (senyap, dan selalu soal uang):
//   1. Saldo profil dan Σ mutasi berselisih tanpa ada yang tahu. Dulu hanya
//      terlihat kalau teknisi membuka layar Saldo atau admin menjalankan probe
//      manual — bisa berbulan-bulan.
//   2. Pembacaan ledger TERPOTONG batas PostgREST lalu dilaporkan sebagai
//      selisih di SETIAP teknisi (alarm palsu lebih buruk daripada tanpa alarm).
//   3. Cron yang tidak terjadwal, atau yang lupa auth bersama — endpoint mati
//      atau justru terbuka.
//   4. Cron yang MENGOREKSI saldo sendiri, menutupi penyebab selisihnya.
//
// Pemakaian:
//   npm run verify:rekonsiliasi          (offline, tanpa jaringan)
//   npm run verify:rekonsiliasi-live     (baca data sungguhan, read-only)
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (berkas) => readFileSync(path.join(ROOT, berkas), "utf8");
const LIVE = process.argv.includes("--live");

const {
  hitungRekonsiliasiSaldo,
  cariPotonganBelumTercatat,
  bacaSemuaHalaman,
  jalankanRekonsiliasiSaldo,
  TOLERANSI_SELISIH,
} = await import("../src/lib/balance-reconciliation.js");
const { rencanaKoreksiSaldo } = await import("../src/lib/pricing.js");
const { ADMIN_NOTIFY_EVENTS } = await import("../src/lib/admin-notify-events.js");
const { PUSH_EVENTS } = await import("../src/lib/push.js");

let lulus = 0;
const gagal = [];
const cek = (nama, kondisi, mengapa) => {
  if (kondisi) {
    lulus += 1;
    console.log(`  lulus  ${nama}`);
  } else {
    gagal.push(`${nama} — ${mengapa}`);
    console.log(`  GAGAL  ${nama}${mengapa ? ` — ${mengapa}` : ""}`);
  }
};

const teknisi = (id, balance, name = id.toUpperCase()) => ({ id, name, email: `${id}@fixity.invalid`, balance });
const mutasi = (technician_id, amount, extra = {}) => ({
  technician_id,
  amount,
  type: amount >= 0 ? "topup" : "earning",
  created_at: "2026-10-20T10:00:00Z",
  ...extra,
});

/** Klien Supabase tiruan: cukup untuk rantai select/eq/not/order/range. */
function klienTiruan({ profiles = [], ledger = [], bookings = [], adminEmails = [] } = {}) {
  const isi = { profiles, balance_transactions: ledger, bookings };
  return {
    from(tabel) {
      const rows = isi[tabel] || [];
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        order: () => q,
        range: async (dari, sampai) => ({ data: rows.slice(dari, sampai + 1), error: null }),
      };
      return q;
    },
    rpc: async () => ({ data: adminEmails, error: null }),
  };
}

console.log("Verifikasi rekonsiliasi saldo harian");
console.log("=".repeat(72));

console.log("\nA. Invarian saldo = Σ mutasi (aturan murni)");
{
  const cocok = hitungRekonsiliasiSaldo({
    teknisi: [teknisi("a", 100000)],
    ledger: [mutasi("a", 60000), mutasi("a", 40000)],
  });
  cek(
    "saldo sama dengan jumlah mutasi → tidak ada temuan",
    cocok.jumlahBerselisih === 0 && cocok.cocok === 1 && cocok.totalSelisihAbs === 0,
    JSON.stringify(cocok.berselisih)
  );

  const naik = hitungRekonsiliasiSaldo({
    teknisi: [teknisi("a", 150000)],
    ledger: [mutasi("a", 100000)],
  });
  cek(
    "saldo lebih besar dari mutasi terdeteksi dengan nominal tepat",
    naik.jumlahBerselisih === 1 && naik.berselisih[0].selisih === 50000,
    `selisih=${naik.berselisih[0]?.selisih}`
  );

  const turun = hitungRekonsiliasiSaldo({
    teknisi: [teknisi("a", 0)],
    ledger: [mutasi("a", 100000)],
  });
  cek(
    "saldo lebih kecil dari mutasi terdeteksi sebagai selisih negatif",
    turun.berselisih[0]?.selisih === -100000,
    `selisih=${turun.berselisih[0]?.selisih}`
  );

  const tanpaMutasi = hitungRekonsiliasiSaldo({
    teknisi: [teknisi("a", 0), teknisi("b", 25000)],
    ledger: [],
  });
  cek(
    "teknisi bersaldo 0 tanpa mutasi tidak dianggap bermasalah",
    tanpaMutasi.jumlahBerselisih === 1 && tanpaMutasi.berselisih[0].id === "b",
    "saldo 0 tanpa riwayat adalah kondisi normal teknisi baru"
  );

  const urut = hitungRekonsiliasiSaldo({
    teknisi: [teknisi("a", 5000), teknisi("b", 0), teknisi("c", 100)],
    ledger: [mutasi("b", 90000)],
  });
  cek(
    "temuan diurutkan dari selisih TERBESAR",
    urut.berselisih.map((x) => x.id).join(",") === "b,a,c",
    urut.berselisih.map((x) => x.id).join(",")
  );
  cek(
    "total selisih absolut = Σ |selisih| tiap teknisi",
    urut.totalSelisihAbs === 90000 + 5000 + 100,
    `total=${urut.totalSelisihAbs}`
  );
}

console.log("\nB. Ambang & derau pembulatan");
{
  const bedaSebundar = hitungRekonsiliasiSaldo({
    teknisi: [teknisi("a", 100000)],
    ledger: [mutasi("a", 100001)],
  });
  cek(
    `selisih Rp 1 tetap dilaporkan pada ambang default (${TOLERANSI_SELISIH} rupiah)`,
    bedaSebundar.jumlahBerselisih === 1,
    "selisih sekecil apa pun adalah uang yang tidak tercatat"
  );
  cek(
    "ambang lebih longgar (Rp 2) mengabaikan selisih Rp 1",
    hitungRekonsiliasiSaldo({
      teknisi: [teknisi("a", 100000)],
      ledger: [mutasi("a", 100001)],
      toleransi: 2,
    }).jumlahBerselisih === 0
  );
  cek(
    "pecahan < Rp 1 tidak membangunkan admin",
    hitungRekonsiliasiSaldo({
      teknisi: [teknisi("a", 100000)],
      ledger: [mutasi("a", 100000.4)],
    }).jumlahBerselisih === 0
  );
}

console.log("\nC. Pesanan selesai yang belum pernah dipotong");
{
  const hasil = cariPotonganBelumTercatat({
    pesananSelesai: [
      { id: "b1", code: "SV-1", technician_id: "a", completed_at: "2026-10-01T00:00:00Z" },
      { id: "b2", code: "SV-2", technician_id: "a", completed_at: "2026-10-02T00:00:00Z" },
    ],
    ledger: [{ type: "earning", booking_id: "b1", amount: -15000 }],
  });
  cek(
    "hanya pesanan tanpa baris potongan yang dilaporkan",
    hasil.jumlah === 1 && hasil.contoh[0].kode === "SV-2",
    JSON.stringify(hasil.contoh)
  );
  cek(
    "contoh dibatasi agar email tetap terbaca",
    cariPotonganBelumTercatat({
      pesananSelesai: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, code: `SV-${i}` })),
      ledger: [],
      batasContoh: 5,
    }).contoh.length === 5
  );
}

console.log("\nD. Pembacaan berhalaman (anti alarm palsu)");
{
  const baris = Array.from({ length: 2500 }, (_, i) => ({ id: `t${i}` }));
  const buat = (data, gagalDi = -1) => {
    let n = 0;
    return () => {
      const halaman = n++;
      return {
        range: async (dari, sampai) => {
          if (halaman === gagalDi) return { data: null, error: { message: "jaringan putus" } };
          return { data: data.slice(dari, Math.min(sampai + 1, dari + 1000)), error: null };
        },
      };
    };
  };
  const penuh = await bacaSemuaHalaman(buat(baris), { pageSize: 1000 });
  cek(
    "2.500 baris terbaca utuh lewat beberapa halaman",
    penuh.data?.length === 2500 && !penuh.terpotong,
    `terbaca=${penuh.data?.length}`
  );
  cek(
    "halaman kedua yang gagal membuat SELURUH hasil gagal (tidak ada data separuh)",
    Boolean((await bacaSemuaHalaman(buat(baris, 1), { pageSize: 1000 })).error),
    "data separuh = selisih palsu di semua teknisi"
  );
  const terpotong = await bacaSemuaHalaman(buat(baris), { pageSize: 1000, maksBaris: 2000 });
  cek(
    "menyentuh batas keamanan ditandai `terpotong`",
    terpotong.terpotong === true && terpotong.data.length === 2000,
    "tanpa penanda, hasil tidak lengkap tampak seperti selisih"
  );
}

console.log("\nE. Cron: kapan mengirim, kapan diam");
{
  const seimbang = klienTiruan({
    profiles: [teknisi("a", 100000)],
    ledger: [mutasi("a", 100000)],
    adminEmails: ["admin@fixity.invalid"],
  });
  const diam = await jalankanRekonsiliasiSaldo(seimbang, { sekarang: new Date("2026-10-24T00:00:00Z") });
  cek(
    "semua cocok → TIDAK ada email (cron tidak berisik)",
    diam.dikirim === false && diam.alasan === "semua-cocok",
    JSON.stringify({ dikirim: diam.dikirim, alasan: diam.alasan })
  );

  const tanpaPotongan = klienTiruan({
    profiles: [teknisi("a", 100000)],
    ledger: [mutasi("a", 100000)],
    bookings: [{ id: "b9", code: "SV-9", technician_id: "a", completed_at: "2026-10-01T00:00:00Z" }],
    adminEmails: [],
  });
  const belumDitagih = await jalankanRekonsiliasiSaldo(tanpaPotongan, {});
  cek(
    "saldo cocok tetapi ada pesanan belum dipotong → tetap perlu tindakan",
    belumDitagih.jumlahBerselisih === 0 &&
      belumDitagih.potongan.jumlah === 1 &&
      belumDitagih.perluTindakan === true,
    JSON.stringify({ potongan: belumDitagih.potongan?.jumlah, perlu: belumDitagih.perluTindakan })
  );

  const selisih = klienTiruan({
    profiles: [teknisi("a", 120000)],
    ledger: [mutasi("a", 100000)],
    adminEmails: [],
  });
  const tanpaPenerima = await jalankanRekonsiliasiSaldo(selisih, {});
  cek(
    "selisih terdeteksi walau email admin belum ada",
    tanpaPenerima.perluTindakan === true &&
      tanpaPenerima.jumlahBerselisih === 1 &&
      tanpaPenerima.alasan === "tanpa-email-admin",
    JSON.stringify({ alasan: tanpaPenerima.alasan, jumlah: tanpaPenerima.jumlahBerselisih })
  );

  const ditahan = await jalankanRekonsiliasiSaldo(selisih, { kirim: false });
  cek(
    "`kirim:false` menghitung tanpa mengirim apa pun (dipakai probe)",
    ditahan.dikirim === false && ditahan.alasan === "kirim-dimatikan" && ditahan.jumlahBerselisih === 1
  );

  const kering = await jalankanRekonsiliasiSaldo(selisih, { dry: true });
  cek("`dry` juga tidak mengirim", kering.dikirim === false && kering.alasan === "dry");

  const bacaKosong = () => {
    const b = {
      select: () => b,
      eq: () => b,
      not: () => b,
      order: () => b,
      range: async () => ({ data: [], error: null }),
    };
    return b;
  };
  const bacaRusak = () => {
    const b = {
      select: () => b,
      eq: () => b,
      not: () => b,
      order: () => b,
      range: async () => ({ data: null, error: { message: 'relation "balance_transactions" does not exist' } }),
    };
    return b;
  };
  const tanpaTabel = await jalankanRekonsiliasiSaldo(
    {
      from: (tabel) => (tabel === "balance_transactions" ? bacaRusak() : bacaKosong()),
      rpc: async () => ({ data: [], error: null }),
    },
    {}
  );
  cek(
    "tabel ledger belum ada → error dengan petunjuk migrasi (bukan selisih palsu)",
    /migrate-technician-balance/.test(tanpaTabel.error || ""),
    tanpaTabel.error
  );
}

console.log("\nF. Wiring: jadwal, auth, preferensi, dan larangan mengoreksi sendiri");
{
  const route = baca("src/app/api/cron/balance-reconciliation/route.js");
  cek(
    "endpoint memakai autentikasi cron bersama",
    /cronAuthorized\(request\)/.test(route) && !/headers\.get\("x-cron-secret"\)/.test(route),
    "endpoint baru tanpa auth bersama membuka pembacaan saldo seluruh teknisi"
  );
  cek(
    "endpoint memakai modul rekonsiliasi, bukan logika sendiri",
    /jalankanRekonsiliasiSaldo\(createAdminClient\(\)/.test(route)
  );
  const vercel = baca("vercel.json");
  cek(
    "jadwal harian terdaftar di Vercel",
    /"\/api\/cron\/balance-reconciliation"/.test(vercel) && /"0 16 \* \* \*"/.test(vercel),
    "endpoint yang tidak terjadwal tidak pernah berjalan otomatis"
  );
  cek(
    "route terdaftar di penjaga auth cron",
    /cron\/balance-reconciliation\/route\.js/.test(baca("scripts/verify-cron-auth.mjs")),
    "route baru harus ikut diperiksa verify:cron-auth"
  );
  cek(
    "peristiwa email bisa dimatikan per admin di tab Notif Email Admin",
    ADMIN_NOTIFY_EVENTS.some((e) => e.key === "balance_mismatch")
  );

  const modul = baca("src/lib/balance-reconciliation.js");
  cek(
    "cron TIDAK pernah mengubah saldo/ledger sendiri",
    !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(modul),
    "koreksi otomatis menutupi penyebab selisih yang justru perlu dilihat"
  );

  const email = baca("src/lib/email.js");
  cek(
    "email memuat saldo, Σ mutasi, dan selisih per teknisi",
    /sendAdminBalanceMismatchEmail/.test(email) &&
      /Saldo profil/.test(email) &&
      /Σ mutasi/.test(email) &&
      /escape|escHtml\(t\.nama\)/.test(email),
    "angka yang tidak disebut tidak bisa ditindaklanjuti"
  );
  cek(
    "email menyebut pesanan selesai yang belum dipotong",
    /belum punya baris potongan/.test(email)
  );
}

console.log("\nG. Koreksi saldo turun (jalan perbaikan bila saldo > Σ mutasi)");
{
  const turun = rencanaKoreksiSaldo({ balance: 150000, delta: -50000 });
  cek(
    "koreksi turun: baris ledger = perubahan saldo (invarian kembali utuh)",
    turun.delta === -50000 && turun.amount === -50000 && turun.resultingBalance === 100000,
    JSON.stringify(turun)
  );
  cek(
    "saldo tetap positif → bukan piutang baru",
    turun.debt === 0,
    `debt=${turun.debt}`
  );
  const lewatNol = rencanaKoreksiSaldo({ balance: 20000, delta: -50000 });
  cek(
    "koreksi melewati nol melaporkan piutang yang terjadi",
    lewatNol.resultingBalance === -30000 && lewatNol.debt === 30000,
    JSON.stringify(lewatNol)
  );
  cek(
    "koreksi Rp 0 ditolak (tidak mengotori riwayat)",
    rencanaKoreksiSaldo({ balance: 1000, delta: 0 }).valid === false
  );

  const sql = baca("supabase/migrate-admin-balance-adjustment.sql");
  cek(
    "RPC mengunci baris profil (dua koreksi bersamaan tidak saling menimpa)",
    /for update/.test(sql)
  );
  cek(
    "hanya admin, dan alasannya wajib",
    /if not public\.is_admin\(\)/.test(sql) && /length\(v_catatan\) < 5/.test(sql),
    "tanpa alasan, koreksi tidak bisa dibedakan dari perubahan saldo tanpa catatan"
  );
  cek(
    "baris ledger bertipe adjustment dan sebesar perubahan saldo",
    /'adjustment'/.test(sql) && /set balance = v_saldo \+ v_delta/.test(sql)
  );
  cek(
    "RPC tidak terbuka untuk anon/publik",
    /revoke all on function public\.admin_adjust_technician_balance\(uuid, numeric, text\) from public/.test(sql) &&
      /from anon/.test(sql) &&
      /grant execute on function public\.admin_adjust_technician_balance\(uuid, numeric, text\) to authenticated/.test(sql)
  );

  const libSaldo = baca("src/lib/balance.js");
  cek(
    "jalur server memakai RPC (bukan dua query terpisah yang bisa pecah di tengah)",
    /sesuaikanSaldoTeknisi/.test(libSaldo) &&
      /rpc\("admin_adjust_technician_balance"/.test(libSaldo) &&
      !/from\("balance_transactions"\)\s*\n?\s*\.insert/.test(libSaldo.split("sesuaikanSaldoTeknisi")[1]?.split("creditTechnicianBalance")[0] || ""),
    "insert ledger + update saldo terpisah bisa menghasilkan selisih baru"
  );

  const audit = baca("supabase/migrate-balance-adjustment-audit.sql");
  cek(
    "audit menyimpan admin pelaku di baris ledger (created_by)",
    /add column if not exists created_by uuid references public\.profiles\(id\)/.test(audit) &&
      /created_by\)[\s\S]{0,120}v_pelaku/.test(audit) &&
      /v_pelaku uuid := auth\.uid\(\)/.test(audit),
    "tanpa kolom pelaku, audit hanya bisa dijawab dari log aplikasi — atau tidak sama sekali"
  );
  cek(
    "baris lama tanpa pelaku tidak ditebak (created_by NULL)",
    /on delete set null/.test(audit) && /is null/.test(audit),
    "menebak pelaku lebih buruk daripada mengaku tidak tercatat"
  );

  const aksi = baca("src/app/actions/admin.js");
  cek(
    "riwayat koreksi memuat alasan + nama admin pelaku",
    /const adjustments = koreksiTampil\.map/.test(aksi) &&
      /admin_name: r\.created_by/.test(aksi) &&
      /reason: alasanPenyesuaian\(r\.note\)/.test(aksi) &&
      /created_by, created_at/.test(aksi),
    "riwayat tanpa alasan/pelaku tidak bisa dipakai untuk audit"
  );
  cek(
    "kolom created_by dibaca dengan fallback (tab tidak kosong sebelum migrasi audit)",
    /created_by/i.test(aksi) && /txRes\.error[\s\S]{0,80}created_by/.test(aksi)
  );

  cek(
    "aksi admin dijaga requireAdmin dan mengabari teknisi",
    /export async function koreksiSaldoTeknisiAdmin/.test(aksi) &&
      /koreksiSaldoTeknisiAdmin[\s\S]{0,300}requireAdmin\(/.test(aksi) &&
      /event: "balance_adjusted"/.test(aksi),
    "saldo berkurang tanpa pemberitahuan terbaca sebagai uang hilang"
  );
  cek(
    "peristiwa push balance_adjusted terdaftar",
    Object.prototype.hasOwnProperty.call(PUSH_EVENTS, "balance_adjusted")
  );

  const tab = baca("src/components/TechnicianBalancesTab.js");
  cek(
    "panel menampilkan riwayat koreksi: waktu, teknisi, perubahan, alasan, admin",
    /Riwayat koreksi saldo/.test(tab) &&
      /Perubahan/.test(tab) &&
      /Alasan/.test(tab) &&
      /Admin/.test(tab) &&
      /tidak tercatat/.test(tab),
    "riwayat yang tidak terlihat di panel tidak menghilangkan kebutuhan buka SQL"
  );
  cek(
    "panel admin punya tombol SESUAIKAN SALDO di setiap baris teknisi",
    (tab.match(/Sesuaikan saldo/g) || []).length >= 2 && /SlidersHorizontal/.test(tab),
    "tombol yang hanya muncul untuk saldo 0/minus tidak menolong selisih arah sebaliknya"
  );
  cek(
    "modal punya arah Kurangi + pratinjau saldo akhir dari aturan yang sama dengan server",
    /Kurangi saldo/.test(tab) && /rencanaKoreksiSaldo\(/.test(tab) && /koreksiSaldoTeknisiAdmin\(/.test(tab),
    "tanpa pratinjau, admin tidak melihat akibat koreksi sebelum menyimpan"
  );
}

if (LIVE) {
  console.log("\nH. Data sungguhan (read-only, tanpa email)");
  const { loadEnv, makeAdminClient, makeUserClient, createTempUser, deleteTempUsers, sleep } = await import(
    "./lib/probe-env.mjs"
  );
  const env = loadEnv();
  const admin = makeAdminClient(env);
  const hasil = await jalankanRekonsiliasiSaldo(admin, { dry: true });
  if (hasil.error) {
    cek("pemeriksaan berjalan pada database nyata", false, hasil.error);
  } else {
    cek(
      "pemeriksaan berjalan pada database nyata",
      typeof hasil.totalTeknisi === "number" && hasil.dihitungPada,
      hasil.dihitungPada
    );
    console.log(
      `         teknisi=${hasil.totalTeknisi} cocok=${hasil.cocok} berselisih=${hasil.jumlahBerselisih} ` +
        `(total Rp ${hasil.totalSelisihAbs.toLocaleString("id-ID")}) · mutasi=${hasil.jumlahMutasi} · ` +
        `potongan belum tercatat=${hasil.potongan?.jumlah ?? "?"}`
    );
    for (const t of hasil.berselisih.slice(0, 5)) {
      console.log(
        `         → ${t.nama}: saldo Rp ${t.saldo.toLocaleString("id-ID")} vs ledger Rp ${t.ledger.toLocaleString("id-ID")} ` +
          `(selisih Rp ${t.selisih.toLocaleString("id-ID")})`
      );
    }
    cek(
      "hasilnya deterministik saat dijalankan dua kali",
      JSON.stringify((await jalankanRekonsiliasiSaldo(admin, { dry: true })).berselisih) ===
        JSON.stringify(hasil.berselisih),
      "angka yang berubah antar jalankan berarti pembacaannya tidak lengkap"
    );
  }

  // ---- H2. Koreksi saldo NYATA: tulis → periksa → bersihkan ----
  // Membuktikan janji yang paling mudah bohong: "baris ledger dan saldo berubah
  // bersama". Semua data uji dibuat di sini dan dihapus di blok finally.
  console.log("\n H2. Koreksi saldo pada database nyata");
  const { creditTechnicianBalance, sesuaikanSaldoTeknisi } = await import("../src/lib/balance.js");
  let teknisi = null;
  let adminUser = null;
  try {
    teknisi = await createTempUser(admin, "technician", "koreksi-tech");
    adminUser = await createTempUser(admin, "admin", "koreksi-admin");

    const masuk = await creditTechnicianBalance(admin, teknisi.id, 100000, "Setor uji koreksi saldo");
    cek("saldo awal uji terisi Rp 100.000", masuk.ok && Number(masuk.balance) === 100000, JSON.stringify(masuk));

    const techClient = makeUserClient(env);
    const techSign = await techClient.auth.signInWithPassword({
      email: teknisi.email,
      password: teknisi.password,
    });
    if (techSign.error) throw new Error(`sign-in teknisi uji gagal: ${techSign.error.message}`);
    await sleep(300);
    const ditolak = await techClient.rpc("admin_adjust_technician_balance", {
      p_technician: teknisi.id,
      p_delta: -40000,
      p_note: "Coba koreksi sendiri",
    });
    cek(
      "teknisi TIDAK bisa mengoreksi saldonya sendiri",
      ditolak.data?.ok === false || Boolean(ditolak.error),
      ditolak.data?.error || ditolak.error?.message || ""
    );

    const adminClient = makeUserClient(env);
    const adminSign = await adminClient.auth.signInWithPassword({
      email: adminUser.email,
      password: adminUser.password,
    });
    if (adminSign.error) throw new Error(`sign-in admin uji gagal: ${adminSign.error.message}`);
    await sleep(300);

    const nol = await adminClient.rpc("admin_adjust_technician_balance", {
      p_technician: teknisi.id,
      p_delta: 0,
      p_note: "Koreksi nol",
    });
    cek("koreksi Rp 0 ditolak server", nol.data?.ok === false, nol.data?.error || nol.error?.message || "");

    const pendek = await adminClient.rpc("admin_adjust_technician_balance", {
      p_technician: teknisi.id,
      p_delta: -1000,
      p_note: "abc",
    });
    cek(
      "alasan kurang dari 5 karakter ditolak server",
      pendek.data?.ok === false,
      pendek.data?.error || pendek.error?.message || ""
    );

    // Jalur yang dipakai panel admin (pembungkus lib → RPC), bukan hanya RPC-nya.
    const res = await sesuaikanSaldoTeknisi(adminClient, teknisi.id, -40000, "Koreksi uji — selisih rekonsiliasi");
    cek(
      "admin bisa menurunkan saldo Rp 100.000 → Rp 60.000",
      res.ok === true && res.balanceAfter === 60000 && res.balanceBefore === 100000,
      JSON.stringify(res)
    );

    const profil = await admin.from("profiles").select("balance").eq("id", teknisi.id).single();
    const mutasi = await admin
      .from("balance_transactions")
      .select("type, amount, note, created_by")
      .eq("technician_id", teknisi.id);
    const totalMutasi = (mutasi.data || []).reduce((s, t) => s + Number(t.amount || 0), 0);
    cek(
      "saldo = Σ mutasi setelah koreksi (invarian utuh, cron besok diam)",
      Number(profil.data?.balance) === 60000 && totalMutasi === 60000,
      `saldo=${profil.data?.balance} ledger=${totalMutasi}`
    );
    const barisKoreksi = (mutasi.data || []).find((t) => t.type === "adjustment");
    cek(
      "baris koreksi bertipe adjustment dan menyimpan alasannya",
      Boolean(barisKoreksi) && Number(barisKoreksi.amount) === -40000 && /selisih rekonsiliasi/.test(barisKoreksi.note || ""),
      JSON.stringify((mutasi.data || []).map((t) => [t.type, t.amount]))
    );
    cek(
      "admin pelakunya tercatat di baris ledger (audit tanpa buka SQL)",
      barisKoreksi?.created_by === adminUser.id,
      `created_by=${barisKoreksi?.created_by} vs admin=${adminUser.id}`
    );
  } finally {
    const hapus = await deleteTempUsers(admin, [teknisi, adminUser].filter(Boolean));
    cek(
      "akun & data uji koreksi dibersihkan",
      hapus.every((h) => h.ok),
      JSON.stringify(hapus)
    );
  }
}

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
