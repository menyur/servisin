/**
 * Satu sumber notifikasi EMAIL ke admin — antrean `admin_email_outbox`.
 *
 * KENAPA ANTREAN (bukan kirim langsung di setiap aksi)
 *   Aplikasi Flutter menulis langsung ke Supabase (RPC `create_booking_…`,
 *   insert `reports`, insert `balance_deposits`) dan pendaftaran akun terjadi
 *   lewat `auth.signUp` — semuanya TANPA melewati server action Next.js.
 *   Kunci RESEND hanya ada di server web, jadi peristiwa-peristiwa itu tidak
 *   pernah bisa mengirim email sendiri. Karena Supabase (trigger) juga tidak
 *   boleh menyimpan rahasia, solusinya sama seperti `push_outbox`:
 *
 *     1. Trigger DB menulis SATU baris per peristiwa ke `admin_email_outbox`
 *        (migrasi supabase/migrate-admin-email-outbox.sql).
 *     2. Worker ini (route /api/admin-email-worker) mengambil batch dengan
 *        FOR UPDATE SKIP LOCKED, membaca konteksnya lewat service role, lalu
 *        mengirim email ke ADMIN YANG DIPILIH untuk peristiwa itu (pengaturan
 *        tab "Notif Email Admin"; tanpa opt-out = semua admin seperti dulu).
 *     3. Sukses → baris dihapus; gagal → attempts naik, dicoba ulang
 *        (worker berikutnya / jadwal pg_cron / webhook) DAN alasan dari penyedia
 *        email dicatat pada barisnya (last_error + last_attempt_at). Setelah
 *        percobaan habis barisnya TIDAK dibuang: ia muncul di tab "Notif Email
 *        Admin" sebagai "Email yang gagal terkirim", lengkap dengan tombol coba
 *        lagi/buang (migrasi supabase/migrate-admin-email-failures.sql).
 *        Sebelumnya barisnya dihapus dan sebabnya hanya ada di log server —
 *        kunci Resend yang tidak sah bisa mematikan SEMUA email admin tanpa
 *        jejak apa pun di panel maupun database.
 *
 * KAPAN SEBUAH PERCOBAAN DIBUANG (kejadian 16 Okt 2026, lihat
 * supabase/fix-admin-email-macet-dan-kuota.sql): percobaan TIDAK lagi dibuang
 * hanya karena penyedia email menolak. Kuota harian / rate limit adalah
 * penolakan SEMENTARA — kalau tiap ping (trigger pg_net, cron tiap menit,
 * aplikasi, panel) mengklaim ulang baris yang sama, lima percobaan habis dalam
 * hitungan detik dan gangguan sementara berubah menjadi email yang hilang.
 * Kebijakannya ada di src/lib/email-retry.js dan dikirim ke database lewat
 * `defer_admin_email` (tunda, claim dibatalkan) atau `fail_admin_email`
 * (gagal, dengan jeda bertingkat).
 *
 * Dengan begitu email admin terkirim untuk SEMUA jalur sekaligus — web maupun
 * aplikasi — tanpa email ganda dan tanpa mempercayai isi payload dari klien:
 * baris antrean hanya menyimpan id referensi, konteksnya dibaca di sini.
 *
 * KOMPATIBILITAS: sebelum migrasi dijalankan, `adminEmailOutboxReady()` bernilai
 * false dan pemanggil (server action web) mengirim email secara langsung
 * seperti sebelumnya — perilaku lama tidak hilang.
 *
 * PENERIMA: satu tempat menentukan penerima lewat `adminEmailsForEvent()` yang
 * membaca tabel `admin_notification_optouts`
 * (supabase/migrate-admin-notification-prefs.sql). Diatur admin di panel → tab
 * "Notif Email Admin".
 *
 * SUMBER UJI DILEWATI: peristiwa yang SUMBER-nya akun uji (`@example.invalid` —
 * konvensi akun sementara di scripts/lib/probe-env.mjs) tidak dikirim ke admin
 * sama sekali (lihat src/lib/email-uji.js). Kejadian 16 Okt 2026: skrip uji yang
 * membuat pesanan/laporan/pendaftaran menghabiskan kuota harian Resend —
 * belasan email nyata ke inbox admin dalam beberapa detik untuk data `Probe …`.
 * Baris antreannya tetap dibereskan (tanpa kiriman), jadi kuota tersisa untuk
 * notifikasi sungguhan.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { alasanUntukPanel, kebijakanUlang } from "@/lib/email-retry";
import { alamatUji } from "@/lib/email-uji";
import {
  sendAdminNewBookingEmail,
  sendAdminNewReportEmail,
  sendAdminNewDepositEmail,
  sendAdminNewWithdrawalEmail,
  sendAdminNewApplicantEmail,
  sendAdminNewCustomerEmail,
  sendAdminAccountDeletionEmail,
} from "@/lib/email";

/** Label metode pembayaran (paritas dengan panel admin). */
const PAY_LABEL = {
  cod: "Bayar di Tempat (COD)",
  transfer: "Transfer Bank",
  qris: "Transfer Bank",
  virtual_account: "Transfer Bank",
  e_wallet: "Transfer Bank",
};

/**
 * Peristiwa yang dikenal antrean: new_booking | new_report | new_deposit |
 * new_withdrawal | new_user | account_deletion. Daftar label + kunci yang dipakai PANEL ADMIN
 * (dan disaring per admin di sini) ada di src/lib/admin-notify-events.js.
 */

/**
 * Apakah jalur antrean sudah aktif (migrasi sudah dijalankan)?
 * RLS tabel mengembalikan 0 baris — BUKAN error — saat akses ditolak, jadi
 * "tabel ada" cukup dinilai dari tidak adanya error.
 * Tabel belum dibuat → error "relation does not exist" → false.
 */
export async function adminEmailOutboxReady(supabase) {
  try {
    const { error } = await supabase.from("admin_email_outbox").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Email semua admin (RPC security definer). */
async function adminEmails(admin) {
  const { data } = await admin.rpc("get_admin_emails");
  return (data || []).filter(Boolean);
}

/**
 * Email admin yang HARUS menerima SATU jenis peristiwa.
 *
 * Mengikuti pengaturan tab "Notif Email Admin" (tabel
 * admin_notification_optouts, migrasi supabase/migrate-admin-notification-prefs.sql):
 * admin yang dimatikan untuk peristiwa itu dibuang di DATABASE (RPC
 * admin_emails_for_event), jadi jalur web dan jalur antrean memakai aturan
 * identik dan klien tidak bisa menambah/menghapus penerima.
 *
 * RPC belum ada (migrasi belum dijalankan) → semua admin, yaitu perilaku lama; jadi
 * tidak ada email yang hilang sebelum migrasi. Error lain (mis. gangguan jaringan)
 * juga jatuh ke daftar semua admin — sengaja fail-open karena notifikasi admin
 * yang hilang senyap lebih merugikan daripada sesekali terkirim ke lebih banyak
 * admin.
 *
 * @param client klien Supabase BER-JWT atau service role (RPC-nya security
 *   definer, grant-nya sama dengan get_admin_emails).
 */
export async function adminEmailsForEvent(client, event) {
  try {
    const { data, error } = await client.rpc("admin_emails_for_event", { p_event: event });
    // PENTING: error → fallback (RPC/tabel belum ada), tetapi hasil KOSONG yang
    // sah (semua admin mematikan peristiwa ini) tetap dihormati — bukan fallback.
    if (!error && Array.isArray(data)) return data.filter(Boolean);
  } catch {
    /* jatuh ke daftar semua admin */
  }
  return adminEmails(client);
}

/**
 * Notifikasi admin dari SERVER ACTION web untuk satu peristiwa.
 *
 * Sudah ada antrean (migrasi dijalankan) → trigger DB yang memasukkan barisnya
 * saat insert; di sini cukup menyapu antrean supaya email TIDAK terkirim dua
 * kali (langsung + lewat antrean).
 * Belum ada antrean → kirim langsung seperti sebelumnya, jadi perilaku lama
 * tetap utuh sebelum migrasi dijalankan.
 *
 * Selalu fire-and-forget: kegagalan email tidak boleh menggagalkan aksi utama.
 *
 * @param supabase klien pemanggil (dipakai memeriksa keberadaan antrean)
 * @param directSend fungsi yang mengirim email langsung (dipanggil hanya bila
 *   antrean belum ada)
 * @param {{sumberEmail?: string}} opsi email SUMBER peristiwa. Bila itu akun uji
 *   (`@example.invalid`, lihat src/lib/email-uji.js), emailnya TIDAK dikirim
 *   sama sekali: penerimanya admin asli, jadi menyaring penerima tidak cukup —
 *   yang menghabiskan kuota harian adalah peristiwa dari data uji (149 dari 195
 *   email pada 16 Okt 2026). Gerbang yang sama sudah ada di antrean; dipasang di
 *   sini juga supaya jalur LANGSUNG (sebelum migrasi antrean dijalankan, dan
 *   peristiwa yang tidak punya trigger antrean) tidak jadi celah.
 * @returns {"outbox"|"direct"|"uji"} jalur yang dipakai.
 */
export async function notifyAdminsOrDirect(supabase, directSend, opsi = {}) {
  if (alamatUji(opsi.sumberEmail)) {
    console.warn(`[admin-email] dilewati — sumber akun uji (${opsi.sumberEmail})`);
    return "uji";
  }
  let ready = false;
  try {
    ready = await adminEmailOutboxReady(supabase);
  } catch {
    ready = false;
  }
  // Menyapu antrean HANYA bisa dengan service role (RPC-nya tidak diberikan ke
  // anon/authenticated). Kalau kuncinya tidak ada di deployment ini, jangan
  // menggantungkan pengiriman pada antrean — kalau tidak, email admin hilang
  // diam-diam (antrean terisi, worker menolak akses). Kirim langsung saja.
  if (ready && hasServiceRole()) {
    drainAdminEmailOutbox().catch(() => {});
    return "outbox";
  }
  if (ready) {
    console.warn(
      "[admin-email] antrean ada tetapi SUPABASE_SERVICE_ROLE_KEY tidak terbaca — memakai pengiriman langsung."
    );
  }
  try {
    await directSend();
  } catch (err) {
    console.warn("[admin-email] kirim langsung gagal:", err?.message);
  }
  return "direct";
}

/** Apakah kredensial untuk menyapu antrean (service role) tersedia di sini? */
function hasServiceRole() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Sapu antrean: kirim email untuk setiap baris yang siap. Aman dijalankan
 * bersamaan (FOR UPDATE SKIP LOCKED) dan dari mana saja — route worker,
 * server action web, cron pg_cron, atau Database Webhook.
 *
 * @returns {Promise<{ok:boolean, sent:number, pending:number, skipped?:string}>}
 *   Selalu selesai tanpa melempar: kegagalan email tidak boleh menggagalkan
 *   aksi utama pengguna.
 */
/**
 * Kirim email admin untuk SATU peristiwa secara langsung (tanpa antrean).
 * Dipakai jalur fallback: server action web saat antrean belum ada, dan route
 * /api/notify-admin-event yang dipanggil aplikasi setelah membuat
 * pesanan/laporan/setoran.
 *
 * Isi email tetap dibangun dari DATABASE (bukan dari data yang dikirim klien) —
 * klien hanya menyebut id, jadi tidak bisa memalsukan isi notifikasi.
 *
 * @returns hasil `sendMail` ({simulated}/{error}) atau {skipped: alasan}.
 */
export async function sendAdminEventEmail(event, refId) {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { skipped: "env-belum-lengkap" };
  }
  const res = await deliver(admin, { event, ref_id: refId });
  return res === "skip" ? { skipped: "tidak-ada-yang-dikirim" } : res;
}

/**
 * Jalur peristiwa dari KLIEN (aplikasi Flutter): antrean ada → cukup disapu
 * (baris sudah dimasukkan trigger DB, jadi tidak ada email dobel); antrean
 * belum ada → kirim langsung supaya notifikasi tetap sampai sebelum migrasi
 * dijalankan. Pemanggil (route) sudah memverifikasi kepemilikan barisnya.
 */
export async function notifyAdminEventFromClient(supabase, event, refId) {
  // Pengajuan TARIK saldo belum punya trigger antrean (berbeda dengan setoran),
  // jadi tidak ada baris yang bisa disapu. Kalau tetap lewat
  // `notifyAdminsOrDirect`, fungsi itu mengira antrean yang mengirim dan email
  // admin hilang diam-diam. Kirim langsung — sama seperti jalur web
  // (`notifyAdminsBalanceRequest` untuk withdrawal).
  if (event === "new_withdrawal") return sendAdminEventEmail(event, refId);
  return notifyAdminsOrDirect(supabase, () => sendAdminEventEmail(event, refId));
}

export async function drainAdminEmailOutbox(limit = 20) {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, sent: 0, pending: 0, skipped: "env-belum-lengkap" };
  }

  const { data: batch, error } = await admin.rpc("take_admin_email_batch", {
    p_limit: limit,
  });
  if (error) {
    // Antrean belum ada (migrasi belum dijalankan) atau worker dijalankan
    // tanpa service role. Bukan kegagalan alur — cukup dilewati.
    return { ok: false, sent: 0, pending: 0, skipped: error.message };
  }
  if (!batch || batch.length === 0) {
    return { ok: true, sent: 0, pending: 0 };
  }

  let sent = 0;
  let pending = 0;
  let dilewati = 0;
  await Promise.all(
    batch.map(async (item) => {
      try {
        // Penerima ditentukan PER PERISTIWA di dalam deliver() (pengaturan panel
        // admin): admin yang mematikan jenis peristiwa ini tidak dikirimi.
        const res = await deliver(admin, item);
        // Sumber uji (akun probe tanpa inbox) → tidak ada yang perlu dikirim.
        // Barisnya tetap dibereskan supaya antrean bersih, TANPA memakai kuota
        // email dan tanpa menambah email data uji ke inbox admin.
        if (res !== "skip" && res?.skipped === "sumber-uji") {
          dilewati += 1;
          console.warn("[admin-email] dilewati (sumber akun uji):", item.event, res.email);
          const { error: hapusUjiErr } = await admin.rpc("complete_admin_email", { p_id: item.id });
          if (hapusUjiErr) {
            // Barisnya bukan email yang perlu dikirim; kalau penghapusannya gagal
            // jangan biarkan percobaannya terpakai sampai "menyerah" — tandai
            // berhenti sekarang, alasannya jelas, dan admin bisa membuangnya.
            await catatKegagalan(admin, item, `Peristiwa dari akun uji — baris antrean gagal dihapus (${hapusUjiErr.message}).`, {
              aksi: "menyerah",
              sementara: false,
            });
          }
          return;
        }
        // "Tidak ada penerima" BUKAN sukses: emailnya tidak sampai ke siapa pun
        // dan penyebabnya adalah pilihan di tab "Notif Email Admin". Dulu baris
        // seperti ini dihapus ("terkirim"), sehingga setelan yang mematikan
        // semua penerima tampak tidak berakibat apa-apa.
        const tanpaPenerima = res !== "skip" && res?.skipped === "no-recipient";
        const gagalKirim = res !== "skip" && Boolean(res?.error);
        if (tanpaPenerima || gagalKirim) {
          const alasan = gagalKirim
            ? res.error
            : "Tidak ada admin yang menerima peristiwa ini — periksa tab \"Notif Email Admin\".";
          const kebijakan = kebijakanUlang(alasan, item.attempts, {
            maksPercobaan: item.max_attempts,
          });
          pending += 1;
          console.warn(
            "[admin-email] kirim gagal:",
            item.event,
            alasan,
            kebijakan.sementara
              ? `→ SEMENTARA: ditunda ±${Math.round(kebijakan.jedaDetik / 60)} menit (percobaan tidak dihitung)`
              : `→ jeda ±${Math.round(kebijakan.jedaDetik / 60)} menit sebelum percobaan berikutnya`
          );
          await catatKegagalan(admin, item, alasan, kebijakan);
          return;
        }
        if (res?.simulated) {
          console.warn("[admin-email] email disimulasikan (RESEND_API_KEY belum diisi):", item.event);
        }
        // Baris dihapus HANYA bila penghapusannya benar-benar berhasil. Dulu
        // galatnya tidak diperiksa: email terkirim, barisnya tetap tinggal, lalu
        // ping berikutnya mengirim ulang dan menaikkan `attempts` sampai
        // antreannya macet (11 baris seperti itu di produksi 16 Okt 2026).
        const { error: hapusErr } = await admin.rpc("complete_admin_email", { p_id: item.id });
        if (hapusErr) {
          pending += 1;
          const alasan =
            `Email SUDAH terkirim tetapi baris antrean gagal dihapus (${hapusErr.message}). ` +
            "JANGAN kirim ulang tanpa memeriksa kotak masuk admin — bisa jadi email dobel.";
          console.warn("[admin-email]", alasan, item.event);
          await catatKegagalan(admin, item, alasan, { aksi: "menyerah", sementara: false });
          return;
        }
        sent += 1;
      } catch (err) {
        pending += 1;
        console.warn("[admin-email] gagal proses:", item.event, err?.message);
        await catatKegagalan(admin, item, err?.message || "gagal proses tak dikenal");
      }
    })
  );

  return { ok: true, sent, pending, dilewati };
}

/**
 * Catat alasan kegagalan PADA BARIS ANTREAN (alasan + waktu percobaan terakhir)
 * supaya tidak ikut hilang bersama log server. Dulu, setelah lima percobaan,
 * barisnya dihapus dan sebabnya hanya tersisa di log Vercel.
 *
 * Aman kalau migrasi belum dijalankan: RPC-nya belum ada, dan kegagalan
 * pencatatan tidak boleh menggagalkan (atau menghentikan) alur pengiriman —
 * perilaku lama tetap berlaku, hanya tanpa jejak.
 *
 * @param kebijakan hasil kebijakanUlang() (src/lib/email-retry.js): "tunda"
 *   memakai defer_admin_email (claim dibatalkan, percobaan tidak dibuang),
 *   "menyerah" memakai give_up_admin_email (email sudah terkirim), selain itu
 *   fail_admin_email dengan jeda bertingkat.
 */
async function catatKegagalan(admin, item, alasan, kebijakan = { aksi: "gagal", jedaDetik: 0 }) {
  const pesan = alasanUntukPanel(alasan, item.attempts, kebijakan);
  try {
    let error;
    if (kebijakan.aksi === "tunda") {
      // Penolakan SEMENTARA (kuota/rate limit): claim dibatalkan di database
      // (`attempts - 1`) dan barisnya menunggu jendela berikutnya. Kalau ini
      // dihitung sebagai percobaan gagal, kuota harian yang pulih sendiri akan
      // tetap berakhir "menyerah" — persis 10 email yang hilang 16 Okt 2026.
      ({ error } = await admin.rpc("defer_admin_email", {
        p_id: item.id,
        p_error: pesan,
        p_delay_seconds: kebijakan.jedaDetik,
      }));
    } else if (kebijakan.aksi === "menyerah") {
      // Emailnya SUDAH terkirim tetapi barisnya tidak bisa dihapus: tandai
      // menyerah sekarang juga supaya ping berikutnya tidak mengirim ulang
      // (email dobel) hanya karena percobaan barisnya masih tersisa.
      ({ error } = await admin.rpc("give_up_admin_email", { p_id: item.id, p_error: pesan }));
    } else {
      ({ error } = await admin.rpc("fail_admin_email", {
        p_id: item.id,
        p_error: pesan,
        p_delay_seconds: kebijakan.jedaDetik || 0,
      }));
    }
    if (error && !/function|does not exist|schema cache/i.test(error.message || "")) {
      console.warn("[admin-email] gagal mencatat alasan kegagalan:", error.message);
    }
  } catch (err) {
    console.warn("[admin-email] gagal mencatat alasan kegagalan:", err?.message);
  }
}

/**
 * Bangun isi email dari keadaan DB saat ini (bukan dari payload klien), lalu
 * kirim ke penerima yang DIPILIH admin untuk peristiwa itu (adminEmailsForEvent).
 * Kembalian: hasil `sendMail` ({simulated}/{error}, termasuk {skipped:
 * "no-recipient"} bila tak ada penerima) atau "skip" bila tidak ada yang perlu
 * dikirim (baris sudah terhapus / event tak dikenal / role tak perlu
 * diberitakan) — pemanggil menghapus baris antrean untuk "skip".
 */
async function deliver(admin, item) {
  const ref = item.ref_id;
  switch (item.event) {
    case "new_booking": {
      const { data: b } = await admin
        .from("bookings")
        .select(
          "code, booking_date, booking_time, address, payment_method, total_price, services(name), profiles!bookings_user_id_fkey(name, phone, email)"
        )
        .eq("id", ref)
        .maybeSingle();
      if (!b) return "skip";
      if (alamatUji(b.profiles?.email)) return { skipped: "sumber-uji", email: b.profiles?.email };
      const emails = await adminEmailsForEvent(admin, "new_booking");
      return sendAdminNewBookingEmail(emails, {
        code: b.code,
        service_name: b.services?.name || "Layanan",
        customer_name: b.profiles?.name || "-",
        customer_phone: b.profiles?.phone || "",
        booking_date: b.booking_date,
        booking_time: b.booking_time,
        address: b.address,
        payment_method: PAY_LABEL[b.payment_method] || b.payment_method || "-",
        total_price: b.total_price,
      });
    }

    case "new_report": {
      const { data: r } = await admin
        .from("reports")
        .select("title, content, author_role, author_id, bookings(code)")
        .eq("id", ref)
        .maybeSingle();
      if (!r) return "skip";
      const { data: author } = await admin
        .from("profiles")
        .select("name, email")
        .eq("id", r.author_id)
        .maybeSingle();
      if (alamatUji(author?.email)) return { skipped: "sumber-uji", email: author?.email };
      const emails = await adminEmailsForEvent(admin, "new_report");
      return sendAdminNewReportEmail(emails, {
        author_role: r.author_role,
        title: r.title,
        content: r.content,
        author_name: author?.name || "-",
        author_email: author?.email || "",
        booking_code: r.bookings?.code || null,
      });
    }

    case "new_deposit": {
      const { data: d } = await admin
        .from("balance_deposits")
        .select("amount, proof_url, technician_id")
        .eq("id", ref)
        .maybeSingle();
      if (!d) return "skip";
      const { data: tech } = await admin
        .from("profiles")
        .select("name, email, balance")
        .eq("id", d.technician_id)
        .maybeSingle();
      if (alamatUji(tech?.email)) return { skipped: "sumber-uji", email: tech?.email };
      // Bucket balance-proofs PRIVAT → kolom menyimpan path. Admin butuh
      // tautan yang bisa dibuka, jadi buat signed URL (1 jam) bila perlu.
      let proofUrl = d.proof_url;
      if (proofUrl && !String(proofUrl).startsWith("http")) {
        const { data: signed } = await admin.storage
          .from("balance-proofs")
          .createSignedUrl(proofUrl, 3600);
        proofUrl = signed?.signedUrl || null;
      }
      const emails = await adminEmailsForEvent(admin, "new_deposit");
      return sendAdminNewDepositEmail(emails, {
        tech_name: tech?.name || "Teknisi",
        tech_email: tech?.email || "-",
        current_balance: tech?.balance || 0,
        amount: d.amount,
        proofUrl,
      });
    }

    case "new_withdrawal": {
      // Pengajuan tarik saldo dari aplikasi (Flutter): saldo sudah ditahan
      // saat baris dibuat, jadi email ini yang memancing admin mentransfer.
      const { data: w } = await admin
        .from("balance_withdrawals")
        .select("amount, bank_name, account_number, account_holder, technician_id")
        .eq("id", ref)
        .maybeSingle();
      if (!w) return "skip";
      const { data: tech } = await admin
        .from("profiles")
        .select("name, email, balance")
        .eq("id", w.technician_id)
        .maybeSingle();
      if (alamatUji(tech?.email)) return { skipped: "sumber-uji", email: tech?.email };
      const emails = await adminEmailsForEvent(admin, "new_withdrawal");
      return sendAdminNewWithdrawalEmail(emails, {
        tech_name: tech?.name || "Teknisi",
        tech_email: tech?.email || "-",
        current_balance: tech?.balance || 0,
        amount: w.amount,
        bank_name: w.bank_name,
        account_number: w.account_number,
        account_holder: w.account_holder,
      });
    }

    case "new_user": {
      const { data: p } = await admin
        .from("profiles")
        .select("name, email, phone, role, address, skill, ktp_url")
        .eq("id", ref)
        .maybeSingle();
      if (!p) return "skip";
      if (alamatUji(p.email)) return { skipped: "sumber-uji", email: p.email };
      if (p.role === "technician") {
        const emails = await adminEmailsForEvent(admin, "new_technician");
        return sendAdminNewApplicantEmail(emails, {
          name: p.name,
          email: p.email,
          phone: p.phone,
          address: p.address,
          skill: p.skill || "-",
          ktpUrl: p.ktp_url,
        });
      }
      if (p.role === "customer") {
        const emails = await adminEmailsForEvent(admin, "new_customer");
        return sendAdminNewCustomerEmail(emails, {
          name: p.name,
          email: p.email,
          phone: p.phone,
          address: p.address,
        });
      }
      return "skip"; // mis. admin dibuat manual — tidak perlu diberitakan
    }

    case "account_deletion": {
      // Permintaan hapus akun (aplikasi MAUPUN halaman web) — lihat
      // supabase/migrate-account-deletion.sql (trigger mengisi baris antrean).
      const { data: a } = await admin
        .from("account_deletion_requests")
        .select("id, email, sumber, alasan, status, created_at, user_id")
        .eq("id", ref)
        .maybeSingle();
      if (!a) return "skip";
      // Sudah dijalankan/dibatalkan sebelum sempat dikirim → tidak perlu diberitakan.
      if (a.status !== "diminta") return "skip";
      if (alamatUji(a.email)) return { skipped: "sumber-uji", email: a.email };
      const { data: pelapor } = a.user_id
        ? await admin.from("profiles").select("role").eq("id", a.user_id).maybeSingle()
        : { data: null };
      const emails = await adminEmailsForEvent(admin, "account_deletion");
      return sendAdminAccountDeletionEmail(emails, {
        id: a.id,
        email: a.email,
        sumber: a.sumber,
        alasan: a.alasan,
        created_at: a.created_at,
        role: pelapor?.role ?? "-",
      });
    }

    default:
      console.warn("[admin-email] event tidak dikenal:", item.event);
      return "skip";
  }
}
