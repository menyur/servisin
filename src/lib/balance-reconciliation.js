/**
 * REKONSILIASI SALDO HARIAN — penjaga invarian `saldo teknisi = Σ mutasi`.
 *
 * Masalah yang diselesaikan: saldo di `profiles.balance` dan buku besar
 * `balance_transactions` bisa berselisih tanpa ada yang tahu. Selisih itu baru
 * terlihat kalau teknisi kebetulan membuka layar Saldo (kartu "Ada selisih …")
 * atau admin menjalankan probe manual — dua kejadian yang bisa tidak pernah
 * terjadi selama berbulan-bulan. Padahal selisih di sini selalu berarti UANG:
 * saldo naik tanpa baris mutasi (koreksi langsung di database), potongan yang
 * gagal tertulis, atau setoran yang tercatat dua kali.
 *
 * Berkas ini memisahkan dua lapisan supaya bisa dibuktikan tanpa database:
 *   1. ATURAN MURNI — `hitungRekonsiliasiSaldo()` dan
 *      `cariPotonganBelumTercatat()`. Tanpa I/O, tanpa waktu implisit.
 *   2. I/O — pembacaan berhalaman (`.range`) lalu pemanggilan email admin.
 *      Pembacaan WAJIB berhalaman: PostgREST memotong hasil (default 1000
 *      baris), dan potongan yang tidak terbaca akan tampak sebagai selisih di
 *      SETIAP teknisi — alarm palsu yang lebih buruk daripada tidak ada alarm.
 *
 * Dijalankan oleh `/api/cron/balance-reconciliation` (jadwal di vercel.json).
 * Tidak pernah MENGUBAH saldo: tugasnya melaporkan, bukan mengoreksi sendiri.
 * Koreksi otomatis akan menutupi penyebabnya, dan penyebab itulah yang perlu
 * dilihat manusia.
 */
import { sendAdminBalanceMismatchEmail } from "./email.js";

/**
 * Selisih di bawah Rp 1 dianggap derau pembulatan, bukan temuan.
 * Nominal saldo disimpan sebagai `numeric`; penjumlahan di JS bisa menyisakan
 * pecahan seperti 0.0000001 yang tidak layak membangunkan admin.
 */
export const TOLERANSI_SELISIH = 1;

/** Batas baris yang ditampilkan di email (sisanya cukup dihitung). */
export const BATAS_TAMPIL_EMAIL = 20;

/**
 * Bandingkan saldo profil dengan jumlah seluruh mutasinya.
 *
 * @param {object}   opsi
 * @param {Array}    opsi.teknisi  baris `profiles` ({ id, name, balance })
 * @param {Array}    opsi.ledger   baris `balance_transactions`
 *                                 ({ technician_id, amount, type, created_at })
 * @param {number}   opsi.toleransi rupiah; selisih < ini diabaikan
 * @param {Date|string|number} opsi.sekarang waktu pemeriksaan (dicatat di hasil)
 * @returns {{
 *   dihitungPada: string, toleransi: number, totalTeknisi: number,
 *   jumlahMutasi: number, cocok: number, jumlahBerselisih: number,
 *   totalSelisihAbs: number, berselisih: Array<object>
 * }}
 */
export function hitungRekonsiliasiSaldo({
  teknisi = [],
  ledger = [],
  toleransi = TOLERANSI_SELISIH,
  sekarang = new Date(),
} = {}) {
  const ambang = Number.isFinite(Number(toleransi)) ? Math.max(0, Number(toleransi)) : TOLERANSI_SELISIH;

  // Buku besar per teknisi: total, jumlah baris, mutasi terakhir.
  const buku = new Map();
  for (const t of ledger) {
    if (!t || !t.technician_id) continue;
    const isi = buku.get(t.technician_id) || { total: 0, jumlah: 0, terakhir: null };
    isi.total += Number(t.amount) || 0;
    isi.jumlah += 1;
    const waktu = t.created_at ? new Date(t.created_at).getTime() : null;
    if (waktu !== null && !Number.isNaN(waktu) && (isi.terakhir === null || waktu > isi.terakhir)) {
      isi.terakhir = waktu;
    }
    buku.set(t.technician_id, isi);
  }

  const semua = teknisi.map((p) => {
    const isi = buku.get(p.id) || { total: 0, jumlah: 0, terakhir: null };
    const saldo = Math.round(Number(p.balance) || 0);
    const totalLedger = Math.round(isi.total);
    return {
      id: p.id,
      nama: p.name || p.email || String(p.id).slice(0, 8),
      email: p.email || null,
      saldo,
      ledger: totalLedger,
      selisih: saldo - totalLedger,
      jumlahMutasi: isi.jumlah,
      terakhir: isi.terakhir ? new Date(isi.terakhir).toISOString() : null,
    };
  });

  const berselisih = semua
    .filter((x) => Math.abs(x.selisih) >= ambang && x.selisih !== 0)
    .sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih));

  return {
    dihitungPada: new Date(sekarang).toISOString(),
    toleransi: ambang,
    totalTeknisi: semua.length,
    jumlahMutasi: ledger.length,
    cocok: semua.length - berselisih.length,
    jumlahBerselisih: berselisih.length,
    totalSelisihAbs: berselisih.reduce((s, x) => s + Math.abs(x.selisih), 0),
    berselisih,
  };
}

/**
 * Pesanan selesai yang belum punya baris potongan (`earning`) di buku besar.
 *
 * Ini selisih yang berbeda jenis tapi sama akibatnya: komisi + biaya aplikasi
 * yang seharusnya dipotong tidak pernah masuk laporan karena tidak ada barisnya.
 * Dipisahkan dari `hitungRekonsiliasiSaldo` supaya saldo yang masih "cocok"
 * tidak menyembunyikan pesanan yang belum pernah ditagih.
 */
export function cariPotonganBelumTercatat({ pesananSelesai = [], ledger = [], batasContoh = 10 } = {}) {
  const sudah = new Set();
  for (const t of ledger) {
    if (t && t.type === "earning" && t.booking_id) sudah.add(t.booking_id);
  }
  const belum = pesananSelesai
    .filter((b) => b && b.id && !sudah.has(b.id))
    .map((b) => ({
      id: b.id,
      kode: b.code || null,
      selesaiPada: b.completed_at || null,
      technician_id: b.technician_id || null,
    }))
    .sort((a, b) => String(a.selesaiPada || "").localeCompare(String(b.selesaiPada || "")));

  return {
    jumlah: belum.length,
    contoh: belum.slice(0, Math.max(0, Number(batasContoh) || 0)),
  };
}

/**
 * Baca SEMUA baris lewat `.range()`, halaman demi halaman.
 *
 * `buat()` harus mengembalikan query baru setiap kali (builder Supabase tidak
 * boleh dipakai ulang setelah dijalankan). Bila satu halaman gagal, hasilnya
 * `error` — pemanggil TIDAK boleh melanjutkan dengan data sebagian, karena
 * data sebagian berarti selisih palsu untuk semua teknisi.
 *
 * @param {() => object} buat
 * @param {{pageSize?: number, maksBaris?: number}} opsi
 * @returns {Promise<{data?: Array, terpotong?: boolean, error?: string}>}
 */
export async function bacaSemuaHalaman(buat, { pageSize = 1000, maksBaris = 200000 } = {}) {
  const ukuran = Math.max(1, Number(pageSize) || 1000);
  const batas = Math.max(ukuran, Number(maksBaris) || 200000);
  const hasil = [];

  for (let dari = 0; dari < batas; dari += ukuran) {
    const { data, error } = await buat().range(dari, dari + ukuran - 1);
    if (error) return { error: error.message || String(error) };
    const halaman = data || [];
    hasil.push(...halaman);
    if (halaman.length < ukuran) return { data: hasil };
  }
  // Sampai di sini artinya batas keamanan tercapai: hasil TIDAK lengkap.
  return { data: hasil, terpotong: true };
}

/** Semua teknisi beserta saldonya. */
export async function bacaTeknisiSaldo(supabase) {
  return bacaSemuaHalaman(() =>
    supabase
      .from("profiles")
      .select("id, name, email, balance")
      .eq("role", "technician")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
  );
}

/** Seluruh buku besar saldo. */
export async function bacaBukuBesarSaldo(supabase) {
  return bacaSemuaHalaman(() =>
    supabase
      .from("balance_transactions")
      .select("id, technician_id, booking_id, type, amount, created_at")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
  );
}

/** Pesanan selesai yang sudah punya teknisi (kandidat potongan komisi). */
export async function bacaPesananSelesai(supabase) {
  return bacaSemuaHalaman(() =>
    supabase
      .from("bookings")
      .select("id, code, technician_id, completed_at")
      .eq("status", "completed")
      .not("technician_id", "is", null)
      .order("completed_at", { ascending: true })
      .order("id", { ascending: true })
  );
}

/**
 * Email admin penerima peringatan.
 * Memakai RPC penyaring preferensi (tab "Notif Email Admin") bila ada; bila
 * migrasinya belum dijalankan, jatuh ke seluruh admin — notifikasi keuangan
 * yang hilang senyap lebih merugikan daripada sesekali terkirim kelebih banyak.
 */
async function ambilEmailAdmin(supabase) {
  try {
    const { data, error } = await supabase.rpc("admin_emails_for_event", { p_event: "balance_mismatch" });
    if (!error && Array.isArray(data)) return data.filter(Boolean);
  } catch {
    /* lanjut ke daftar semua admin */
  }
  try {
    const { data, error } = await supabase.rpc("get_admin_emails");
    if (!error && Array.isArray(data)) return data.filter(Boolean);
  } catch {
    /* tidak ada penerima */
  }
  return [];
}

/**
 * Jalankan pemeriksaan (dan, bila perlu, kirim peringatan ke admin).
 *
 * @param {object} supabase klien service role (dipanggil dari cron)
 * @param {object} opsi
 * @param {boolean} opsi.kirim  false = hitung saja tanpa mengirim email
 * @param {boolean} opsi.dry    true  = jangan kirim DAN jangan menandai apa pun
 * @param {boolean} opsi.paksa  kirim juga saat semua cocok (untuk menguji jalur email)
 * @param {number}  opsi.toleransi rupiah
 * @param {Date}    opsi.sekarang
 */
export async function jalankanRekonsiliasiSaldo(
  supabase,
  { kirim = true, dry = false, paksa = false, toleransi, sekarang = new Date() } = {}
) {
  const [tek, led, pes] = await Promise.all([
    bacaTeknisiSaldo(supabase),
    bacaBukuBesarSaldo(supabase),
    bacaPesananSelesai(supabase),
  ]);

  if (tek.error) return { error: `gagal membaca saldo teknisi: ${tek.error}` };
  if (led.error) {
    return {
      error: /relation|does not exist/i.test(led.error)
        ? "Tabel balance_transactions belum ada — jalankan supabase/migrate-technician-balance.sql."
        : `gagal membaca buku besar saldo: ${led.error}`,
    };
  }

  const rekon = hitungRekonsiliasiSaldo({
    teknisi: tek.data || [],
    ledger: led.data || [],
    toleransi,
    sekarang,
  });

  // Pesanan selesai gagal dibaca BUKAN alasan menggagalkan seluruh pemeriksaan:
  // invarian saldo tetap bisa dinilai, dan itu bagian yang paling mahal.
  const potongan = pes.error
    ? { error: pes.error, jumlah: 0, contoh: [] }
    : cariPotonganBelumTercatat({ pesananSelesai: pes.data || [], ledger: led.data || [] });

  const perluTindakan = rekon.jumlahBerselisih > 0 || potongan.jumlah > 0;
  const dasar = {
    ...rekon,
    potongan,
    perluTindakan,
    // true = pembacaan menyentuh batas keamanan → angka tidak boleh dipercaya
    terpotong: Boolean(tek.terpotong || led.terpotong || pes.terpotong),
  };

  if (!perluTindakan && !paksa) return { ...dasar, dikirim: false, alasan: "semua-cocok" };
  if (dry) return { ...dasar, dikirim: false, alasan: "dry" };
  if (!kirim) return { ...dasar, dikirim: false, alasan: "kirim-dimatikan" };

  const penerima = await ambilEmailAdmin(supabase);
  if (!penerima.length) return { ...dasar, dikirim: false, alasan: "tanpa-email-admin" };

  const hasilEmail = await sendAdminBalanceMismatchEmail(penerima, {
    ...dasar,
    batasTampil: BATAS_TAMPIL_EMAIL,
    paksa,
  });

  return {
    ...dasar,
    dikirim: true,
    penerima: penerima.length,
    simulasi: Boolean(hasilEmail?.simulated),
    emailError: hasilEmail?.error || null,
  };
}
