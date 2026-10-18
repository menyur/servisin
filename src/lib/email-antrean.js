/**
 * Antrean email UMUM (store-and-forward) — supaya email yang ditolak penyedia
 * secara SEMENTARA tidak hilang.
 *
 * KENAPA ADA (kejadian 16 Okt 2026, diperiksa langsung di API Resend):
 * sejak pukul 14:36 UTC semua kiriman berakhir `last_event: failed` dengan
 * `message_id` KOSONG — artinya pesannya tidak pernah diserahkan ke penyedia
 * pengiriman, bukan ditolak inbox penerima. Penyebabnya bukan autentikasi domain
 * (DKIM & SPF `fixify.id` terverifikasi, `sending: enabled`), bukan bounce
 * (satu-satunya bounce bulan itu terjadi 15 Okt), dan bukan reputasi pengirim:
 * kuota pengiriman HARIAN habis, dan Resend menjawab apa adanya —
 * `daily_quota_exceeded: You have reached your daily email sending quota.`
 *
 * Notifikasi admin sudah tahan terhadap ini (antrean admin_email_outbox menunda
 * barisnya sampai jendela berikutnya). Yang belum: email ke PELANGGAN/TEKNISI
 * yang dikirim fire-and-forget — konfirmasi pesanan, penugasan teknisi, struk,
 * tanggapan laporan, pengingat saldo. Sebelum ini hasil kirimnya diabaikan, jadi
 * emailnya lenyap tanpa jejak dan tanpa percobaan ulang.
 *
 * Modul ini menyimpan pesan yang SUDAH DIRENDER (to + subject + html) lalu
 * mengirimnya ulang setelah jendela jeda lewat — kebijakan jedanya memakai
 * modul yang sama dengan antrean admin (src/lib/email-retry.js), jadi
 * "penolakan sementara" tidak pernah berarti "menyerah" di dua tempat dengan
 * aturan berbeda.
 *
 * Penolakan PERMANEN (hard bounce: alamat tidak ada, domain pengirim belum
 * terverifikasi, kunci ditolak) tidak pernah masuk antrean sama sekali dan — bila
 * barisnya sudah ada — langsung dihentikan tanpa diulang (lihat `catatKegagalan`).
 * Bukti dari API Resend 17 Okt 2026: 17 dari 100 kiriman terakhir berakhir
 * `bounced` karena alamat uji `…@example.invalid` (domain tanpa MX) ikut masuk ke
 * daftar `to` — satu penerima palsu menggagalkan SELURUH pesan, sehingga admin
 * tidak menerima notifikasinya sementara reputation pengirim dicemari bounce.
 *
 * YANG SENGAJA TIDAK DIANTREKAN — pesan dengan tautan berbatas waktu (reset
 * kata sandi, verifikasi pendaftaran, konfirmasi hapus akun). Tautannya
 * kedaluwarsa dalam 1 jam, sedangkan jendela kuota harian bisa ~10 jam: email
 * yang datang terlambat justru MENYESATKAN (tautan mati). Untuk golongan itu
 * pengirimannya tetap langsung dan kegagalannya dilaporkan ke pengguna supaya ia
 * bisa mencoba lagi.
 *
 * KOMPATIBILITAS: sebelum migrasi supabase/migrate-email-outbox-umum.sql
 * dijalankan, tabelnya tidak ada → penyimpanan dilewati dan perilakunya persis
 * seperti sebelumnya (hanya dicatat di log sekali).
 */
import { createAdminClient } from "./supabase/admin.js";
import { alasanSementara, alasanUntukPanel, kebijakanUlang } from "./email-retry.js";
import { kirimLewatResend } from "./email-transport.js";
import { saringAlamatUji } from "./email-uji.js";

let tabelSiap = null; // null = belum diperiksa, true/false = hasil pemeriksaan
let sudahDiperingatkan = false;

function klien() {
  try {
    return createAdminClient();
  } catch {
    return null; // env belum lengkap (mis. di lingkungan tanpa Supabase)
  }
}

/** Apakah tabel antrean ada? Diperiksa sekali per proses. */
async function antreanAda(admin) {
  if (tabelSiap !== null) return tabelSiap;
  try {
    const { error } = await admin.from("email_outbox").select("id").limit(1);
    tabelSiap = !error;
    if (error && !sudahDiperingatkan) {
      sudahDiperingatkan = true;
      console.warn(
        "[email-antrean] tabel email_outbox belum ada — email yang ditolak sementara TIDAK diantrekan. Jalankan supabase/migrate-email-outbox-umum.sql."
      );
    }
  } catch {
    tabelSiap = false;
  }
  return tabelSiap;
}

/**
 * Kirim sekarang; bila penyedia menolak karena sebab SEMENTARA (kuota harian /
 * rate limit), simpan pesannya untuk dikirim ulang otomatis.
 *
 * @param {{to: string|string[], subject: string, html: string, attachments?: object[]}} params
 * @param {(params: object) => Promise<object>} kirim fungsi kirim langsung (sendMail)
 * @returns {Promise<object>} hasil kirim, ditambah `tertunda: true` bila disimpan.
 */
export async function kirimAtauAntre(params, kirim) {
  const hasil = await kirim(params);
  if (!hasil?.error || hasil.simulated || !alasanSementara(hasil.error)) return hasil;

  const admin = klien();
  if (!admin || !(await antreanAda(admin))) return hasil;

  const penerima = saringAlamatUji(hasil.to ?? params.to);
  if (penerima.length === 0) return hasil; // gerbang data uji sudah menanganinya

  const { data, error } = await admin
    .from("email_outbox")
    .insert({
      to_emails: penerima,
      subject: params.subject,
      html: params.html,
      attachments: params.attachments?.length ? params.attachments : null,
      // Percobaan pertama SUDAH terpakai (dan gagal), jadi hitungannya mulai 1.
      attempts: 1,
      last_error: alasanUntukPanel(hasil.error, 1, kebijakanUlang(hasil.error, 1)),
      last_attempt_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (!sudahDiperingatkan) {
      sudahDiperingatkan = true;
      console.warn("[email-antrean] gagal menyimpan pesan tertunda:", error.message);
    }
    return hasil;
  }

  console.log(
    `[email-antrean] ditolak sementara (${hasil.error}) — pesan disimpan & akan dikirim ulang otomatis (id ${data?.id}).`
  );
  return { ...hasil, tertunda: true, antreanId: data?.id ?? null };
}

/**
 * Catat kegagalan pada baris antrean. Aksi mengikuti kebijakan bersama
 * (src/lib/email-retry.js):
 *   - "tunda"    → defer_email (claim dibatalkan, percobaan tidak terpakai),
 *   - "menyerah" → give_up_email (berhenti SEKARANG karena penolakan permanen),
 *   - "gagal"    → fail_email dengan jeda bertingkat.
 *
 * "menyerah" khusus untuk alasan MENETAP (alamat tidak ada / domain pengirim
 * belum terverifikasi / kunci ditolak). Bukan sekadar memperpanjang jeda:
 * mencoba ulang alamat yang tidak ada menghasilkan bounce keras baru pada akun
 * pengirim, dan reputasi pengirim yang rusak membuat email pelanggan sungguhan
 * ikut masuk spam atau ditolak.
 */
async function catatKegagalan(admin, item, alasan, kebijakan) {
  const pesan = alasanUntukPanel(alasan, item.attempts, kebijakan);
  if (kebijakan.aksi === "tunda") {
    return admin.rpc("defer_email", {
      p_id: item.id,
      p_error: pesan,
      p_delay_seconds: kebijakan.jedaDetik,
    });
  }
  if (kebijakan.aksi === "menyerah") {
    return admin.rpc("give_up_email", { p_id: item.id, p_error: pesan });
  }
  return admin.rpc("fail_email", {
    p_id: item.id,
    p_error: pesan,
    p_delay_seconds: kebijakan.jedaDetik || 0,
  });
}

/**
 * Sapu antrean: coba kirim ulang pesan yang jendelanya sudah lewat.
 * Aman dijalankan bersamaan (RPC memakai FOR UPDATE SKIP LOCKED) dan dari mana
 * saja: route worker, cron, atau Database Webhook.
 *
 * @param limit jumlah baris yang dicoba dalam satu sapuan
 * @param opsi `admin`/`kirim` bisa disuntikkan (dipakai uji otomatis supaya
 *   kebijakan pengiriman ulang bisa dibuktikan tanpa database maupun jaringan)
 * @returns {Promise<{ok: boolean, sent: number, pending: number, skipped?: string}>}
 */
export async function sapuEmailTertunda(limit = 10, opsi = {}) {
  const admin = opsi.admin ?? klien();
  const kirim = opsi.kirim ?? kirimLewatResend;
  if (!admin) return { ok: false, sent: 0, pending: 0, skipped: "env-belum-lengkap" };

  const { data: batch, error } = await admin.rpc("take_email_batch", { p_limit: limit });
  if (error) return { ok: false, sent: 0, pending: 0, skipped: error.message };
  if (!batch || batch.length === 0) return { ok: true, sent: 0, pending: 0 };

  let sent = 0;
  let pending = 0;
  await Promise.all(
    batch.map(async (item) => {
      try {
        const res = await kirim({
          to: item.to_emails,
          subject: item.subject,
          html: item.html,
          attachments: item.attachments || undefined,
        });
        if (res.error) {
          pending += 1;
          await catatKegagalan(
            admin,
            item,
            res.error,
            kebijakanUlang(res.error, item.attempts, { maksPercobaan: item.max_attempts })
          );
          return;
        }
        // Baris dihapus HANYA bila penghapusannya benar-benar berhasil; kalau
        // tidak, emailnya sudah terkirim dan ping berikutnya bisa mengirim dobel.
        const { error: hapusErr } = await admin.rpc("complete_email", { p_id: item.id });
        if (hapusErr) {
          pending += 1;
          await admin.rpc("give_up_email", {
            p_id: item.id,
            p_error:
              `Email SUDAH terkirim tetapi baris antrean gagal dihapus (${hapusErr.message}). ` +
              "JANGAN kirim ulang tanpa memeriksa kotak masuk penerima — bisa jadi email dobel.",
          });
          return;
        }
        sent += 1;
      } catch (err) {
        pending += 1;
        console.warn("[email-antrean] gagal kirim ulang:", err?.message);
        await catatKegagalan(admin, item, err?.message || "gagal proses tak dikenal", {
          aksi: "gagal",
          jedaDetik: 0,
          sementara: false,
        });
      }
    })
  );

  return { ok: true, sent, pending };
}
