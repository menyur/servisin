/**
 * Biaya aplikasi BAWAAN (rupiah) — dipakai saat setelan admin belum terbaca
 * (migrasi belum dijalankan, env kosong, atau query gagal).
 *
 * Nilai yang BENAR-BENAR berlaku datang dari `app_settings.app_fee` (diisi admin
 * di panel → tab "Biaya Aplikasi", dibaca lewat src/lib/app-fee.js dan
 * `public.app_fee_efektif()` di database). Setiap pesanan juga MENYIMPAN tarif
 * yang ditagihkan padanya (`bookings.app_fee`), jadi mengubah tarif hanya
 * berlaku untuk pesanan BARU — pesanan lama tetap memakai angka saat ia dibuat
 * (itu bagian dari tagihan yang sudah disepakati pelanggan dan dasar komisi
 * teknisi). Konstanta ini bukan "tarif yang berlaku", melainkan jaring
 * pengaman supaya harga tidak pernah jatuh ke 0 karena gangguan pembacaan.
 */
/**
 * Keterangan harga pada SEMUA layanan: nominal katalog adalah harga jasa,
 * tidak termasuk sparepart/suku cadang/bahan yang dipakai teknisi. Satu
 * sumber untuk landing page, formulir booking, dan struk.
 */
export const HARGA_JASA_NOTE =
  "Harga jasa — di luar sparepart, suku cadang, dan bahan.";

export const APP_FEE = 5000;

/** Batas tarif biaya aplikasi yang boleh disetel admin (0 = dimatikan). */
export const APP_FEE_MAKS = 1000000;

/**
 * Jepit nilai tarif ke bilangan bulat 0..APP_FEE_MAKS.
 *
 * Dipakai BAIK oleh pembaca setelan (src/lib/app-fee.js) maupun UI admin, jadi
 * angka yang ditampilkan, disimpan, dan ditagihkan tidak pernah berbeda. Nilai
 * tak masuk akal (NaN, negatif, teks) jatuh ke `bawaan`, bukan ke 0 — kalau
 * tidak, salah ketik sekali di panel bisa membuat biaya aplikasi hilang senyap
 * dari semua pesanan berikutnya.
 */
export function normalisasiAppFee(nilai, bawaan = APP_FEE) {
  const n = Number(nilai);
  if (!Number.isFinite(n)) {
    const b = Number(bawaan);
    return Number.isFinite(b) ? Math.max(0, Math.min(APP_FEE_MAKS, Math.round(b))) : APP_FEE;
  }
  return Math.max(0, Math.min(APP_FEE_MAKS, Math.round(n)));
}


// Komisi platform default (% yang dipotong dari nilai pekerjaan selesai teknisi).
// Per-teknisi bisa dioverride lewat kolom profiles.commission_rate.
export const DEFAULT_COMMISSION_RATE = 10;

/**
 * Nilai pekerjaan yang jadi DASAR komisi: total bayar dikurangi biaya
 * aplikasi — SATU SUMBER untuk web, RPC DB, dan aplikasi agar angka
 * komisi di laporan selalu sama dengan yang benar-benar dipotong.
 */
export function commissionBase(totalPrice, appFee = APP_FEE) {
  return Math.max(0, Number(totalPrice) - normalisasiAppFee(appFee));
}

/**
 * Pecah nilai pekerjaan menjadi komisi platform & pendapatan bersih teknisi.
 * rate: persen (mis. 10 = 10%).
 */
export function computeSplit(grossValue, rate = DEFAULT_COMMISSION_RATE) {
  const gross = Number(grossValue) || 0;
  const pct = Math.min(Math.max(Number(rate) || 0, 0), 100);
  const commission = Math.round((gross * pct) / 100);
  return { gross, commission, net: gross - commission };
}

/**
 * Rincian tagihan satu pesanan: subtotal layanan + biaya aplikasi − diskon.
 *
 * `appFee` WAJIB diisi tarif yang sedang berlaku (src/lib/app-fee.js) di jalur
 * yang menagihkan (booking web & tampilan harga). Tanpa argumen, nilainya
 * kembali ke APP_FEE — perilaku lama, aman untuk pemanggil yang belum sempat
 * diperbarui, tetapi JANGAN diandalkan di jalur yang benar-benar menagih.
 */
export function calculateTotal(subtotal, discount = 0, appFee = APP_FEE) {
  const s = Number(subtotal) || 0;
  const fee = normalisasiAppFee(appFee);
  const disc = Math.max(0, Math.min(Number(discount) || 0, s + fee)); // diskon tak melebihi total
  return {
    subtotal: s,
    appFee: fee,
    discount: disc,
    total: s + fee - disc,
  };
}

export function formatRupiah(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function genBookingCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
 return `SV-${n}`;
}

// ============================================================
// Insentif penilaian: pelanggan yang menilai pesanan selesai
// mendapat voucher diskon otomatis.
//
// REVIEW_INCENTIVE_DAYS = 0 → voucher terbit SEGERA begitu penilaian baru
// dikirim (dari web maupun aplikasi Flutter). Nilai > 0 mengembalikan syarat
// "menilai setelah N hari baru dapat voucher". Hanya penilaian BARU yang
// berhak — memperbarui penilaian lama tidak memberi voucher lagi (dijaga
// unique index vouchers_review_incentive_booking_uidx).
// ============================================================
export const REVIEW_INCENTIVE_DAYS = 0;
export const REVIEW_INCENTIVE_AMOUNT = 2000;
export const VOUCHER_VALIDITY_DAYS = 90;

/**
 * Rencanakan potongan saldo dengan KEBIJAKAN "POTONGAN PENUH" — saldo teknisi
 * BOLEH minus.
 *
 * Saat pesanan selesai, saldo dipotong penuh sebesar komisi + biaya aplikasi,
 * sebanyak apa pun saldo yang ada. Kalau saldo tidak cukup, saldo menjadi
 * MINUS dan nilai itu adalah PIUTANG teknisi ke platform — bukan kerugian
 * platform yang hilang tanpa jejak.
 *
 * MENGAPA BUKAN "dipotong sebanyak saldo tersedia" (kebijakan lama): teknisi
 * mengendalikan sendiri besar setorannya, sementara syarat mengambil pekerjaan
 * hanya `saldo > 0` (Rp 1 sudah lolos). Dengan pemotongan sebatas saldo, satu
 * pekerjaan bernilai Rp 105.000 bisa diselesaikan hanya dengan setoran Rp 1.000
 * dan platform kehilangan Rp 14.000 tanpa jejak di laporan — dan tidak bisa
 * direkonsiliasi karena selisihnya tidak tersimpan di baris mana pun.
 *
 * Dipakai jalur server-side (src/lib/balance.js) dan ditiru di RPC DB
 * `set_job_status` (supabase/enforce-full-charge-balance.sql) — rumusnya harus
 * sama agar saldo dan ledger tetap cocok di kedua jalur.
 *
 * Piutang terbatas satu pesanan: teknisi bersaldo minus tidak bisa mengambil
 * pekerjaan baru sebelum menyetor (gerbang `saldo > 0`), jadi utangnya tidak
 * pernah menumpuk lintas pekerjaan.
 *
 * @returns {{available:number, want:number, cut:number, commissionCut:number,
 *            feeCut:number, resultingBalance:number, debt:number,
 *            partial:boolean}} `debt` = besar piutang (0 bila saldo cukup),
 *   `partial` = penanda lama "saldo tidak cukup" (kini berarti saldo minus).
 */
export function planBalanceCut({ balance = 0, commission = 0, fee = 0 } = {}) {
  const available = Number(balance) || 0;
  const wantCommission = Math.max(0, Number(commission) || 0);
  const wantFee = Math.max(0, Number(fee) || 0);
  const want = wantCommission + wantFee;
  const cut = want; // POTONGAN PENUH — kebijakan piutang, bukan dibatasi saldo
  const resultingBalance = available - cut; // boleh negatif = piutang teknisi
  const debt = Math.max(0, -resultingBalance);
  return {
    available,
    want,
    cut,
    commissionCut: wantCommission,
    feeCut: wantFee,
    resultingBalance,
    debt,
    partial: debt > 0,
  };
}

/**
 * Rencana KOREKSI saldo manual oleh admin (naik atau turun).
 *
 * Kenapa ada: rekonsiliasi harian bisa menemukan `profiles.balance` lebih besar
 * daripada Σ mutasi — artinya saldo pernah berubah tanpa baris ledger. "Tambah
 * Saldo" hanya bisa menaikkan, jadi tanpa koreksi turun selisih seperti itu
 * tidak punya jalan perbaikan dari panel.
 *
 * Aturan yang dikunci di sini (dipakai server, UI, dan probe):
 *   * `amount` baris ledger SELALU sama dengan `delta` — kalau berbeda satu
 *     rupiah saja, invarian `saldo = Σ mutasi` pecah lagi di hari berikutnya;
 *   * koreksi bertanda (negatif = menurunkan), jadi satu fungsi cukup;
 *   * delta 0 bukan koreksi: menulis baris Rp 0 hanya mengotori riwayat.
 *
 * `debt` = besar piutang bila koreksi membuat saldo menjadi minus (boleh, sesuai
 * kebijakan potongan penuh — tapi admin harus melihat akibatnya SEBELUM simpan).
 */
export function rencanaKoreksiSaldo({ balance = 0, delta = 0 } = {}) {
  const saldo = Math.round(Number(balance) || 0);
  const d = Math.round(Number(delta) || 0);
  const hasil = saldo + d;
  return {
    saldo,
    delta: d,
    amount: d,
    resultingBalance: hasil,
    debt: Math.max(0, -hasil),
    valid: d !== 0,
  };
}

/**
 * Penagihan satu pesanan selesai: komisi + biaya aplikasi yang HARUS masuk ke
 * platform ("ditagihkan"), terlepas dari apakah saldo teknisi cukup saat itu.
 *
 * SATU SUMBER untuk laporan tiga kolom admin:
 *   ditagihkan (dari bookings) = tertagih (dari ledger) + piutang (saldo minus).
 * Dipakai laporan bulanan CSV, ringkasan keuangan, dan penguncian lewat probe.
 */
export function penagihanPesanan({ totalPrice = 0, appFee = 0, rate = DEFAULT_COMMISSION_RATE } = {}) {
  // Dasar komisi = total − biaya aplikasi PESANAN ITU.
  // Sebelumnya `commissionBase(totalPrice)` dipanggil tanpa `appFee`, sehingga
  // yang dikurangkan selalu bawaan 5.000 — begitu admin menyetel biaya lain
  // (mis. 10.000), "ditagihkan" di laporan bulanan & panel admin kelebihan
  // 5.000 per pesanan, dan laporan tidak lagi cocok dengan ledger.
  const { commission } = computeSplit(commissionBase(totalPrice, appFee), rate);
  const fee = Math.max(0, Number(appFee) || 0);
  return { commission, fee, want: commission + fee };
}

/**
 * Potongan KOMISI riil dari satu baris ledger `balance_transactions`
 * (type 'earning'). `commission_amount` menyimpan porsi komisi; bila kolom itu
 * kosong (baris lama), seluruh |amount| dianggap komisi.
 *
 * SATU SUMBER untuk laporan admin (ringkasan keuangan & Saldo Aktif) agar
 * angka komisi/biaya app tidak pernah berbeda antar tampilan.
 */
export function ledgerCommission(tx) {
  const amt = Math.abs(Number(tx?.amount) || 0);
  if (tx?.commission_amount == null) return amt;
  return Math.max(0, Math.min(Number(tx.commission_amount) || 0, amt));
}

/**
 * Porsi BIAYA APLIKASI yang ikut dipotong dari saldo teknisi pada satu baris
 * ledger 'earning' = |amount| − komisi. 0 untuk baris yang bukan potongan
 * (top-up, penarikan, penyesuaian) atau saat potongan sebagian hanya menutup
 * komisi.
 *
 * Kebijakan platform: saat pesanan selesai, saldo dipotong KOMISI + BIAYA
 * APLIKASI pelanggan (`bookings.app_fee`) — lihat src/lib/balance.js dan
 * supabase/enforce-nonnegative-balance.sql.
 */
export function ledgerAppFee(tx) {
  if (!(Number(tx?.amount) < 0)) return 0;
  return Math.max(0, Math.abs(Number(tx.amount) || 0) - ledgerCommission(tx));
}

/**
 * Besar PIUTANG teknisi (positif) ketika saldo minus; 0 bila tidak.
 * Dipakai UI teknisi/admin untuk memasangkan saldo minus dengan penjelasan
 * "komisi + biaya app melebihi setoran".
 */
export function balanceShortfall(balance) {
  return Math.max(0, -(Number(balance) || 0));
}

/**
 * Alokasi SETORAN untuk menutup PIUTANG teknisi — setoran menutup kekurangan
 * lebih dulu, TERTUA DULU (FIFO).
 *
 * Masuk: `amount` = besar setoran (rupiah) dan `piutang` = daftar piutang
 * terbuka per pesanan `[{ id, booking_id, outstanding, created_at }]`.
 * Keluar: `alokasi` = pasangan piutang yang dilunasi + besarnya, `dilunasi` =
 * total yang menutup piutang, `sisa` = bagian setoran yang menjadi saldo aktif.
 *
 * Dipakai jalur server (src/lib/balance.js → creditTechnicianBalance) supaya
 * tiap rupiah piutang punya pasangan penerimaan, dan dilaporkan sebagai
 * "pemulihan piutang" di laporan admin per periode. Tanpa alokasi ini, setoran
 * hanya menurunkan angka minus di neraca tanpa bisa dipasangkan ke pesanan mana
 * pun — laporan periode berikutnya tampak seolah tidak ada uang masuk.
 *
 * Batas yang dijaga: tidak pernah mengalokasikan lebih dari besar setoran, dan
 * tidak pernah melebihi sisa piutang satu baris (jadi mengulang alokasi aman).
 */
export function alokasiSetoran({ amount = 0, piutang = [] } = {}) {
  let sisa = Math.max(0, Math.round(Number(amount) || 0));
  const alokasi = [];
  // Tertua dulu: umur piutang menentukan urutan pelunasan (piutang lama tidak
  // boleh tertinggal di belakang piutang baru).
  const urut = [...piutang].sort((a, b) =>
    String(a?.created_at ?? "").localeCompare(String(b?.created_at ?? ""))
  );
  for (const p of urut) {
    if (sisa <= 0) break;
    const id = p?.id ?? p?.earning_tx_id ?? null;
    const terbuka = Math.max(0, Math.round(Number(p?.outstanding) || 0));
    if (!id || terbuka <= 0) continue;
    const pakai = Math.min(terbuka, sisa);
    alokasi.push({ id, booking_id: p?.booking_id ?? null, amount: pakai });
    sisa -= pakai;
  }
  const dilunasi = alokasi.reduce((s, a) => s + a.amount, 0);
  return { alokasi, dilunasi, sisa };
}

/**
 * Piutang satu baris ledger yang BELUM dilunasi = uncovered_amount − Σ pelunasan.
 * Dijepit ke 0..uncovered_amount supaya data lama yang aneh tidak pernah
 * menghasilkan piutang negatif di laporan.
 */
export function piutangTerbukaBaris({ uncovered = 0, dilunasi = 0 } = {}) {
  const total = Math.max(0, Math.round(Number(uncovered) || 0));
  const sudah = Math.max(0, Math.round(Number(dilunasi) || 0));
  return Math.max(0, total - sudah);
}

// ============================================================
// UMUR PIUTANG — piutang yang tak kunjung dibayar harus terlihat menua.
//
// Piutang dari kebijakan potongan penuh dibayar lewat setoran sebelum teknisi
// boleh bekerja lagi, tetapi teknisi yang BERHENTI tidak akan pernah menyetor:
// tanpa umur, piutang seperti itu terlihat sama segarnya dengan piutang hari ini.
// Keranjang umur + ambang jatuh tempo inilah dasar pengingat otomatis,
// tugas di panel "Hari Ini", dan keputusan penghapusan (write-off) eksplisit.
// ============================================================

/** Piutang lebih tua dari ini (hari) dianggap JATUH TEMPO. */
export const PIUTANG_TENGGAT_HARI = 30;

/** Jeda minimal antar pengingat otomatis untuk piutang yang sama (hari). */
export const PIUTANG_ULANG_INGAT_HARI = 7;

/**
 * Ambang jatuh tempo piutang (hari) — `PIUTANG_JATUH_TEMPO_HARI` bila diisi.
 *
 * SENGAJA hanya dipakai kode SERVER (aksi admin & cron pengingat): nilai env
 * non-publik tidak ikut ke bundel klien, jadi kalau dipakai di komponen klien
 * angkanya akan berbeda dari server. UI selalu memakai angka yang dikirim server.
 */
export function ambangPiutangHari() {
  const n = Number(typeof process !== "undefined" ? process.env?.PIUTANG_JATUH_TEMPO_HARI : NaN);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : PIUTANG_TENGGAT_HARI;
}

const HARI_MS = 86400000;

/** Umur satu piutang dalam hari penuh (0 bila tanggalnya tak terbaca). */
export function umurHariPiutang(createdAt, now = Date.now()) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Number(now) - t) / HARI_MS));
}

/**
 * Keranjang umur piutang + bagian yang jatuh tempo.
 *
 * `piutang` = daftar piutang terbuka per pesanan `[{ outstanding, created_at }]`.
 * Keranjang: 0–30 / 31–60 / 61–90 / >90 hari (batas atas inklusif pada tiap
 * keranjang, jadi tidak ada umur yang lolos tanpa keranjang).
 *
 * Dipakai laporan admin (ringkasan keuangan, CSV bulanan, tab Saldo Aktif),
 * panel "Hari Ini", dan pengingat otomatis — supaya angka umur tidak pernah
 * berbeda antar tampilan.
 */
export function keranjangUmurPiutang(piutang = [], { now = Date.now(), hariJatuhTempo = PIUTANG_TENGGAT_HARI } = {}) {
  const buckets = { h0_30: 0, h31_60: 0, h61_90: 0, hLebih90: 0 };
  const jatuhTempo = { total: 0, baris: 0, tertua: 0 };
  let total = 0;
  let baris = 0;
  let tertua = 0;
  const batas = Math.max(0, Number(hariJatuhTempo) || 0);
  for (const p of piutang) {
    const sisa = Math.max(0, Math.round(Number(p?.outstanding) || 0));
    if (sisa <= 0) continue;
    const umur = umurHariPiutang(p?.created_at, now);
    total += sisa;
    baris += 1;
    tertua = Math.max(tertua, umur);
    if (umur <= 30) buckets.h0_30 += sisa;
    else if (umur <= 60) buckets.h31_60 += sisa;
    else if (umur <= 90) buckets.h61_90 += sisa;
    else buckets.hLebih90 += sisa;
    if (umur > batas) {
      jatuhTempo.total += sisa;
      jatuhTempo.baris += 1;
      jatuhTempo.tertua = Math.max(jatuhTempo.tertua, umur);
    }
  }
  return { total, baris, tertua, buckets, jatuhTempo: { ...jatuhTempo, hari: batas } };
}

/**
 * PILIH siapa yang perlu DIINGATKAN karena piutangnya sudah jatuh tempo.
 *
 * Murni (tanpa DB/jaringan) supaya aturannya bisa dibuktikan offline: cron hanya
 * memakai hasilnya untuk mengirim push/email dan menandai `balance_reminder_at`.
 *
 * Aturan yang penting di sini:
 *   - hanya piutang yang SUDAH lewat `ambangHari` yang diingatkan (yang belum
 *     jatuh tempo dibiarkan — pengingat dini membuat teknisi mengabaikannya);
 *   - IDEMPOTEN: teknisi yang penandanya lebih baru dari `ulangHari` dilewati,
 *     jadi menjalankan cron dua kali tidak mengirim dua kali;
 *   - penanda rusak/kosong dianggap "belum pernah diingatkan" (lebih baik
 *     mengingatkan sekali daripada piutang hilang dari radar).
 *
 * `teknisi` = `[{ id, nama, email, saldo, masihAktif, reminderTerakhir, items }]`,
 * `items` = piutang terbuka `[{ outstanding, created_at }]` (lihat piutang.js).
 */
export function pilihPengingatPiutang({
  teknisi = [],
  ambangHari = PIUTANG_TENGGAT_HARI,
  ulangHari = PIUTANG_ULANG_INGAT_HARI,
  sekarang = Date.now(),
} = {}) {
  const ambang = Math.max(0, Math.round(Number(ambangHari) || 0));
  const ulang = Math.max(0, Math.round(Number(ulangHari) || 0));
  const kirim = [];
  const dilewati = [];
  const belumJatuhTempo = [];

  for (const t of teknisi) {
    const umur = keranjangUmurPiutang(t?.items || [], { now: sekarang, hariJatuhTempo: ambang });
    const nama = t?.nama || t?.email || String(t?.id ?? "-");
    if (umur.jatuhTempo.total <= 0) {
      belumJatuhTempo.push({ id: t?.id ?? null, nama, total: umur.total, tertua: umur.tertua, umur });
      continue;
    }

    // Selisih hari sejak penanda terakhir; rusak/kosong → belum pernah.
    const cap = t?.reminderTerakhir ? new Date(t.reminderTerakhir).getTime() : NaN;
    const sejak = Number.isFinite(cap) ? Math.floor((Number(sekarang) - cap) / HARI_MS) : Infinity;
    const dasar = { id: t?.id ?? null, nama, email: t?.email ?? null, saldo: Number(t?.saldo || 0), umur, tertua: umur.tertua };

    if (sejak < ulang) {
      dilewati.push({ ...dasar, hariSejakIngat: sejak, alasan: "baru diingatkan" });
      continue;
    }
    kirim.push({
      ...dasar,
      total: umur.total,
      jatuhTempo: umur.jatuhTempo.total,
      tertuaJatuhTempo: umur.jatuhTempo.tertua,
      hariSejakIngat: Number.isFinite(sejak) ? sejak : null,
    });
  }

  return { ambangHari: ambang, ulangHari: ulang, kirim, dilewati, belumJatuhTempo };
}

/**
 * Jepit ke 0 — HANYA untuk tata letak/tampilan yang memang tidak boleh minus
 * (mis. lebar bar). JANGAN dipakai untuk menyembunyikan saldo minus pada angka
 * laporan: saldo minus = piutang teknisi, dan itu harus tetap terbaca.
 */
export function nonNegative(n) {
  return Math.max(0, Number(n) || 0);
}
