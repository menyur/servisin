// ============================================================================
// verify-customer-self-service.mjs — buktikan RPC layanan-mandiri pelanggan
// BENAR-BENAR JALAN di database, bukan hanya tercermin di klien Flutter/JS.
//
// Klien (Dart/JS) hanya MENIRU aturan ini untuk memberi pesan lebih awal; satu-
// satunya penegak yang sesungguhnya adalah fungsi security definer di Supabase.
// Probe ini memanggil fungsi itu apa adanya lewat sesi pengguna sah — jadi bila
// berkas migrasi belum dijalankan, atau penjaganya bocor, skrip ini GAGAL.
//
// Semua data dibuat dari nol dan DIBERSIHKAN SENDIRI (aman diulang):
//   2 pelanggan + 1 teknisi + 1 admin sementara, 6 pesanan uji, 1 baris
//   technician_locations, klaim garansi + kunjungan ulangnya. Nilai
//   `services.warranty_days` layanan uji DAN setelan garansi global
//   (`app_settings.warranty_enabled` / `warranty_days`) dikembalikan seperti
//   semula — probe ini memang sengaja mematikan saklarnya untuk menguji.
//
// TANPA SPAM KE ADMIN (penting): trigger DB mengantre email ke admin SUNGGUHAN
// untuk tiap baris uji — `trg_admin_email_booking` (pesanan) dan
// `trg_admin_email_new_user` (pendaftar), dan `trg_admin_email_outbox_kick`
// memanggil worker lewat pg_net SEKETIKA. Jadi "membersihkan di akhir" saja
// tidak cukup: emailnya bisa sudah terkirim sebelum kita sempat menghapus.
// Dua langkah menutupnya:
//   (a) akun uji dibuat dengan role `admin` — role ini SENGAJA diabaikan
//       `queue_admin_email_new_user` (hanya customer/technician) — lalu role
//       sebenarnya dipasang lewat service-role (trigger-nya after insert, jadi
//       perubahan role tidak mengantre apa pun);
//   (b) baris antrean untuk tiap pesanan uji dihapus SEGERA setelah dibuat
//       lewat RPC, lalu diulang saat pembersihan akhir.
// Sisa jendela lomba yang belum bisa ditutup: satu pesanan uji bisa sangat
// singkat terlihat worker bila koneksinya lebih cepat dari penghapusan kita.
//
// Yang dibuktikan:
//   A. booking_slot_start()      — awal slot = jam dinding Asia/Jakarta.
//   B. cancel_booking()          — penjaga: alasan, pemilik, status, jadwal
//                                  sudah jalan, bukti bayar menunggu (belum ada
//                                  alur refund); sukses → status cancelled +
//                                  jejak, teknisi yang sudah ditugaskan TETAP.
//   C. reschedule_booking()      — format jam, wajib masa depan, batas 90 hari,
//                                  batas 3 kali, teknisi tidak dilepas.
//   D. booking_technician_info() — jarak + umur lokasi + kontak (hanya selama
//                                  pesanan aktif), dan TIDAK PERNAH
//                                  membocorkan koordinat teknisi.
//   E. create_warranty_claim()   — syarat selesai + masa garansi + satu klaim
//      / booking_warranty_info()   per pesanan; sisa hari dihitung benar.
//   F. decide_warranty_claim()   — hanya admin; SETUJU → kunjungan ulang
//                                  berharga 0 ke teknisi yang sama (komisi 0,
//                                  garansi dibiayai platform).
//   G. setelan garansi global    — durasi standar menang atas angka per
//      (app_settings)              layanan, layanan bertanda 0 dikecualikan,
//                                  saklar mati menolak klaim BARU (+ alasan yang
//                                  tepat), dan klaim yang sudah masuk tetap bisa
//                                  diputuskan admin walau garansi dimatikan.
//
// Exit: 0 lulus · 1 ada regresi (atau migrasi belum dijalankan) · 3 tanpa kredensial.
// Tidak pernah mencetak nilai rahasia. Jalankan: npm run verify:self-service
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  countRowsByIds,
  sleep,
} from "./lib/probe-env.mjs";

const MIGRATION_SELF = "supabase/migrate-customer-self-service.sql";
const MIGRATION_WARRANTY = "supabase/migrate-warranty-claims.sql";
const MIGRATION_WARRANTY_SETTINGS = "supabase/migrate-warranty-settings.sql";

const stamp = Date.now();
const bookingIds = [];
const missing = new Map(); // nama fungsi/kolom → berkas migrasi yang harus dijalankan
let failed = 0;
let checked = 0;
let skipped = 0;
let coordsSupported = true;

function check(label, ok, detail = "") {
  checked++;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Ringkasan isi jawaban RPC untuk baris info (tanpa pernah membocorkan rahasia). */
function own(res) {
  const data = res?.data;
  if (data == null) return errText(res?.error) || "-";
  return typeof data === "string" ? data : JSON.stringify(data);
}
function info(message) {
  console.log(`ℹ️  ${message}`);
}
function skip(label, why) {
  skipped++;
  console.log(`⏭️  ${label} — ${why}`);
}
function step(title) {
  console.log(`\n--- ${title} ---`);
}

/** Pesan galat PostgREST, apa adanya (tanpa pernah menampilkan kredensial). */
function errText(error) {
  if (!error) return "";
  return error.message || error.details || error.hint || String(error.code ?? "");
}

const ABSENT_RE = /could not find the function|does not exist|schema cache/i;

/** true bila galat berarti objek DB belum ada (migrasi belum dijalankan). */
function noteMissing(name, error, migration) {
  if (!error || !ABSENT_RE.test(errText(error))) return false;
  missing.set(name, migration);
  return true;
}

// ---------------------------------------------------------------------------
// Jam dinding WIB. Server Supabase berjalan di UTC; "besok" harus dihitung dari
// jam Indonesia, bukan dari UTC, supaya tanggal uji tidak bergeser 7 jam.
// ---------------------------------------------------------------------------
const WIB_MS = 7 * 3600 * 1000;
const wibNow = () => new Date(Date.now() + WIB_MS);
const dayOffset = (n) => new Date(wibNow().getTime() + n * 86400000).toISOString().slice(0, 10);
const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** Layanan uji: utamakan harga tetap (tanpa varian) agar alur paling ringkas. */
async function pickService(admin) {
  const cols = "id,name,base_price,category_id,warranty_days";
  let res = await admin.from("services").select(cols).eq("is_active", true).limit(60);
  let warrantyColumnPresent = true;
  if (res.error && ABSENT_RE.test(errText(res.error))) {
    // services.warranty_days belum ada → migrate-warranty-claims.sql belum jalan.
    missing.set("services.warranty_days", MIGRATION_WARRANTY);
    warrantyColumnPresent = false;
    res = await admin.from("services").select("id,name,base_price,category_id").eq("is_active", true).limit(60);
  }
  if (res.error) throw new Error(`gagal baca services: ${errText(res.error)}`);

  const list = (res.data ?? []).filter((s) => Number(s.base_price) > 0);
  if (!list.length) throw new Error("tidak ada layanan aktif berharga untuk uji");

  const { data: options } = await admin
    .from("service_options")
    .select("service_id,id,price")
    .eq("is_active", true);
  const optByService = new Map();
  for (const o of options ?? []) if (!optByService.has(o.service_id)) optByService.set(o.service_id, o);

  const flat = list.find((s) => !optByService.has(s.id));
  const row = flat ?? list.find((s) => optByService.has(s.id));
  if (!row) throw new Error("tidak ada layanan uji yang bisa dipakai");
  return {
    row,
    optionId: flat ? null : optByService.get(row.id).id,
    warrantyColumnPresent,
    warrantyDays: Number(row.warranty_days ?? 0),
  };
}

/**
 * Setelan garansi platform (baris tunggal `app_settings`). Migrasi
 * migrate-warranty-settings.sql menambahkan `warranty_enabled` & `warranty_days`;
 * bila kolomnya belum ada, itu dilaporkan sebagai migrasi yang belum dijalankan —
 * bukan seolah garansi di database rusak.
 *
 * @returns {Promise<{ok: false, error: string} | {ok: true, enabled: boolean, days: number}>}
 */
async function bacaSetelanGaransi(admin) {
  const { data, error } = await admin
    .from("app_settings")
    .select("warranty_enabled, warranty_days")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (ABSENT_RE.test(errText(error))) {
      missing.set("app_settings.warranty_enabled/warranty_days", MIGRATION_WARRANTY_SETTINGS);
      return { ok: false, error: errText(error) };
    }
    throw new Error(`gagal baca setelan garansi: ${errText(error)}`);
  }
  if (!data) return { ok: false, error: "baris app_settings id = 1 belum ada" };
  return { ok: true, enabled: !!data.warranty_enabled, days: Number(data.warranty_days ?? 0) };
}

/**
 * Buat akun uji TANPA mengantre email "pendaftar baru" ke admin sungguhan.
 *
 * `trg_admin_email_new_user` mengantre email untuk setiap baris profiles
 * ber-role customer/technician — kalau akun uji dibuat dengan role aslinya,
 * admin menerima email pendaftar palsu (`ss-cust-…@example.invalid`) tiap kali
 * probe dijalankan. Role `admin` sengaja diabaikan trigger itu, jadi akun
 * dibuat sebagai `admin` dulu; role sebenarnya dipasang lewat service-role
 * (dibolehkan guard_profile_privileged_fields karena auth.role()=service_role)
 * dan trigger-nya hanya `after insert` sehingga tidak mengantre apa pun.
 * Patch itu dijalankan SEBELUM apa pun memakai akunnya, jadi tidak ada momen
 * akun uji benar-benar ber-role admin di jalur uji.
 */
async function tempUser(admin, role, label) {
  const user = await resilient(`buat akun uji ${label}`, () => createTempUser(admin, "admin", label));
  const err = await patch("profiles", user.id, { role });
  if (err) throw new Error(`gagal memasang role ${role} pada akun uji ${label}: ${err}`);
  user.role = role;
  return user;
}

/**
 * Buang baris antrean email admin untuk satu baris uji (pesanan/akun), SEGERA
 * setelah baris itu dibuat. Dipanggil dua kali (saat buat + saat bersihkan)
 * karena worker bisa dipicu seketika oleh pg_net.
 */
async function dropQueuedAdminEmail(refId) {
  if (!refId) return;
  await resilient("buang antrean email uji", () =>
    adminClient.from("admin_email_outbox").delete().eq("ref_id", refId)
  );
}

async function createBooking(client, service, opts) {
  const args = {
    p_service_id: service.row.id,
    p_date: opts.date,
    p_time: opts.time,
    p_address: `Jl. Uji Mandiri ${stamp} No. 1 — baris otomatis, aman dihapus`,
    p_option_id: service.optionId ?? null,
    p_notes: opts.notes ?? "probe scripts/verify-customer-self-service.mjs",
    p_attachment: null,
    p_payment: "transfer",
    p_voucher_id: null,
  };
  if (opts.lat != null && opts.lng != null) {
    args.p_lat = opts.lat;
    args.p_lng = opts.lng;
  }

  let res = await rpc(client, "create_booking_security_definer", args);
  if (res.error && opts.lat != null && ABSENT_RE.test(errText(res.error))) {
    // DB masih memakai signature 9 argumen (migrate-booking-location belum jalan).
    const { p_lat, p_lng, ...rest } = args;
    coordsSupported = false;
    res = await rpc(client, "create_booking_security_definer", rest);
  }

  const booking = res.data?.booking;
  if (!booking?.id) {
    throw new Error(`gagal membuat pesanan uji: ${errText(res.error) || res.data?.error || "sebab tidak diketahui"}`);
  }
  bookingIds.push(booking.id);
  // Trigger `trg_admin_email_booking` sudah mengantre "pesanan baru" untuk baris
  // ini — buang sekarang, jangan tunggu pembersihan akhir.
  await dropQueuedAdminEmail(booking.id);
  return booking;
}

/** Klien service-role untuk fixture & pembersihan (diisi di main()). */
let adminClient = null;

/** Patch baris lewat service-role (fixture). Mengembalikan pesan galat/null. */
async function patch(table, id, values) {
  const res = await resilient(`patch ${table}`, () => adminClient.from(table).update(values).eq("id", id));
  return res.error ? errText(res.error) : null;
}

/** Panggilan RPC tahan gangguan jaringan sesaat (probe ini menulis lalu membersihkan data). */
function rpc(client, name, args) {
  return resilient(name, () => client.rpc(name, args));
}

// Kegagalan jaringan sesaat — bukan regresi. Data uji WAJIB ikut terbersihkan,
// jadi langkah yang menulis data diulang beberapa kali sebelum menyerah; bila
// tetap gagal, skrip berhenti sebagai GAGAL (tidak pernah mengaku lulus).
const TRANSIENT_RE = /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|terminated|50[234]|timeout/i;

async function resilient(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fn();
      if (res?.error && TRANSIENT_RE.test(errText(res.error)) && i < attempts) {
        console.log(`   ↻ ${label}: jaringan, ulang ${i}/${attempts - 1} — ${errText(res.error)}`);
        await sleep(700 * i);
        continue;
      }
      return res;
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (i < attempts && TRANSIENT_RE.test(msg)) {
        console.log(`   ↻ ${label}: jaringan, ulang ${i}/${attempts - 1} — ${msg}`);
        await sleep(700 * i);
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.log(`⚠️  Kredensial probe tidak tersedia (${err.missing?.join(", ") || err.message}).`);
    process.exit(3);
  }

  const admin = makeAdminClient(env);
  adminClient = admin;
  const clients = { cust: null, other: null, tech: null, admin: null };
  const tempUsers = [];
  let service = null;
  let tech = null;
  let adminUser = null;
  let customer = null;
  let warrantyOriginal = null;
  // Setelan garansi global sebelum probe menyentuhnya (dikembalikan di akhir).
  let warrantySettingsOriginal = null;
  // Durasi efektif & kesiapan setelan: tanpa setelan, angka yang diuji tidak
  // bisa dipastikan, jadi uji garansi DILEWATI dengan alasan yang jelas.
  let setelOk = false;
  let durasiEfektif = 0;
  let locationsOk = true;
  let proofColumnsOk = true;

  try {
    // ---------------- 1. Layanan + akun uji ----------------
    step("1. Layanan & akun uji sementara (2 pelanggan, 1 teknisi, 1 admin)");
    service = await pickService(admin);
    console.log(`   layanan uji: "${service.row.name}" · harga ${service.row.base_price} · warranty_days=${service.row.warranty_days ?? "(kolom belum ada)"}`);
    if (missing.has("services.warranty_days")) {
      info(`kolom services.warranty_days belum ada → jalankan ${MIGRATION_WARRANTY}`);
    }

    customer = await tempUser(admin, "customer", "ss-cust");
    const other = await tempUser(admin, "customer", "ss-other");
    tech = await tempUser(admin, "technician", "ss-tech");
    adminUser = await tempUser(admin, "admin", "ss-admin");
    tempUsers.push(customer, other, tech, adminUser);

    const FAKE_PHONE = `+6281${String(stamp).slice(-9)}`;
    const techErr = await patch("profiles", tech.id, {
      approval_status: "approved",
      phone: FAKE_PHONE,
      skill: service.row.category_id,
      service_area: `AreaUjiMandiri${stamp}`,
    });
    if (techErr) throw new Error(`gagal menyiapkan profil teknisi uji: ${techErr}`);

    for (const [key, user] of Object.entries({ cust: customer, other, tech, admin: adminUser })) {
      const c = makeUserClient(env);
      const { error } = await c.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw new Error(`sign-in ${user.label} gagal: ${error.message}`);
      clients[key] = c;
    }
    await sleep(500);
    console.log(`   sesi siap: pelanggan · pelanggan lain · teknisi · admin`);

    // ---------------- 2. Fungsi ada & penjaga dasar hidup ----------------
    step("2. Fungsi tersedia & menjawab (uuid sentinel)");
    const SENTINEL = "00000000-0000-0000-0000-000000000000";
    const sentinels = [
      ["cancel_booking", { p_booking: SENTINEL, p_reason: "uji probe" }, MIGRATION_SELF],
      ["reschedule_booking", { p_booking: SENTINEL, p_date: dayOffset(3), p_time: "09:00-11:00" }, MIGRATION_SELF],
      ["booking_technician_info", { p_booking: SENTINEL }, MIGRATION_SELF],
      ["create_warranty_claim", { p_booking: SENTINEL, p_reason: "uji probe" }, MIGRATION_WARRANTY],
      ["booking_warranty_info", { p_booking: SENTINEL }, MIGRATION_WARRANTY],
    ];
    for (const [name, args, migration] of sentinels) {
      const { data, error } = await rpc(clients.cust, name, args);
      if (noteMissing(name, error, migration)) {
        check(`${name}() tersedia`, false, `belum ada di DB → jalankan ${migration}`);
        continue;
      }
      check(
        `${name}() tersedia & menolak pesanan asing`,
        data?.ok === false && /tidak ditemukan/i.test(data?.error ?? ""),
        errText(error) || data?.error || JSON.stringify(data)
      );
    }
    const hasSelf = !missing.has("cancel_booking");
    const hasInfo = !missing.has("booking_technician_info");
    const hasWarranty = !missing.has("create_warranty_claim");

    // ---------------- 3. booking_slot_start: jam dinding WIB ----------------
    step("3. booking_slot_start() = jam dinding Asia/Jakarta");
    if (!hasSelf) {
      skip("awal slot dihitung benar", `${MIGRATION_SELF} belum dijalankan`);
    } else {
      const ok = await rpc(clients.cust, "booking_slot_start", { p_date: "2026-10-20", p_time: "08:00-10:00" });
      check(
        "'2026-10-20' + '08:00-10:00' → 08:00:00 (bukan 01:00 karena geser UTC)",
        String(ok.data ?? "").includes("2026-10-20") && String(ok.data ?? "").includes("08:00:00"),
        `${own(ok)} · ${errText(ok.error)}`
      );
      const unknown = await rpc(clients.cust, "booking_slot_start", { p_date: "2026-10-20", p_time: "pagi" });
      check(
        "bentuk jam tak dikenal → awal hari (pesanan lama tetap bisa dibatalkan)",
        String(unknown.data ?? "").includes("2026-10-20") && String(unknown.data ?? "").includes("00:00:00"),
        `${own(unknown)} · ${errText(unknown.error)}`
      );
    }

    // ---------------- 4. cancel_booking ----------------
    step("4. Batalkan sendiri (cancel_booking)");
    if (!hasSelf) {
      skip("seluruh uji pembatalan", `${MIGRATION_SELF} belum dijalankan`);
    } else {
      const b1 = await createBooking(clients.cust, service, {
        date: dayOffset(1),
        time: "08:00-10:00",
        notes: "probe cancel_booking",
      });
      check("pesanan uji pembatalan terbuat", Boolean(b1.id), `kode ${b1.code}`);

      // Penjaga alasan dijalankan SEBELUM pencarian baris.
      const shortReason = await rpc(clients.cust, "cancel_booking", { p_booking: b1.id, p_reason: "ab" });
      check(
        "alasan terlalu pendek ditolak",
        shortReason.data?.ok === false && /minimal 5/i.test(shortReason.data?.error ?? ""),
        errText(shortReason.error) || shortReason.data?.error
      );

      const notMine = await rpc(clients.other, "cancel_booking", { p_booking: b1.id, p_reason: "bukan milikku" });
      check(
        "pesanan milik orang lain tidak bisa dibatalkan",
        notMine.data?.ok === false && /tidak ditemukan/i.test(notMine.data?.error ?? ""),
        errText(notMine.error) || notMine.data?.error
      );

      const anon = await rpc(makeAnonClient(env), "cancel_booking", { p_booking: b1.id, p_reason: "tanpa sesi" });
      check(
        "tanpa sesi (anon) tidak bisa membatalkan",
        anon.data?.ok !== true && Boolean(errText(anon.error) || anon.data?.error),
        errText(anon.error) || anon.data?.error || "ok=true (BOCOR!)"
      );

      // Teknisi sudah ditugaskan → harus TETAP tercatat setelah pembatalan.
      const assignErr = await patch("bookings", b1.id, { technician_id: tech.id, status: "paid" });
      if (assignErr) throw new Error(`gagal menugaskan teknisi ke pesanan uji: ${assignErr}`);

      const done = await rpc(clients.cust, "cancel_booking", {
        p_booking: b1.id,
        p_reason: "berubah rencana, sudah pesan tanggal lain",
      });
      check("pembatalan sah oleh pemilik berhasil", done.data?.ok === true, errText(done.error) || done.data?.error);
      check("jawaban menyebut teknisi sudah ada (untuk pemberitahuan)", done.data?.had_technician === true, own(done));

      const { data: after } = await admin
        .from("bookings")
        .select("status,cancelled_at,cancelled_reason,technician_id")
        .eq("id", b1.id)
        .single();
      check("status jadi 'cancelled'", after?.status === "cancelled", `status=${after?.status}`);
      check("jejak pembatalan terisi (waktu + alasan)", Boolean(after?.cancelled_at) && /berubah rencana/.test(after?.cancelled_reason ?? ""), after?.cancelled_reason);
      check("teknisi yang sudah ditugaskan TETAP (riwayat admin utuh)", after?.technician_id === tech.id, `technician_id=${after?.technician_id}`);

      const twice = await rpc(clients.cust, "cancel_booking", { p_booking: b1.id, p_reason: "coba lagi ya" });
      check(
        "membatalkan dua kali ditolak",
        twice.data?.ok === false && /sudah dibatalkan/i.test(twice.data?.error ?? ""),
        errText(twice.error) || twice.data?.error
      );

      // ---------------- 5. Penjaga bukti bayar (belum ada alur refund) ----------------
      step("5. Bukti bayar yang menunggu konfirmasi memblokir pembatalan");
      const b2 = await createBooking(clients.cust, service, {
        date: dayOffset(1),
        time: "10:00-12:00",
        notes: "probe penjaga bukti bayar",
      });
      const proofErr = await patch("bookings", b2.id, {
        payment_proof_url: "https://example.invalid/bukti-uji.jpg",
        status: "paid",
      });
      if (proofErr && ABSENT_RE.test(proofErr)) {
        proofColumnsOk = false;
        skip("uji penjaga bukti bayar", "kolom payment_proof_url belum ada (migrate-payment-proofs)");
      } else if (proofErr) {
        throw new Error(`gagal menyiapkan bukti bayar uji: ${proofErr}`);
      } else {
        const blocked = await rpc(clients.cust, "cancel_booking", { p_booking: b2.id, p_reason: "mau batal saja" });
        check(
          "pembatalan DITOLAK saat bukti bayar belum ditolak admin",
          blocked.data?.ok === false && /bukti bayar/i.test(blocked.data?.error ?? ""),
          errText(blocked.error) || blocked.data?.error
        );

        const rejectErr = await patch("bookings", b2.id, { payment_rejected: true });
        if (rejectErr && ABSENT_RE.test(rejectErr)) {
          skip("pembatalan setelah bukti ditolak", "kolom payment_rejected belum ada");
        } else {
          const allowed = await rpc(clients.cust, "cancel_booking", { p_booking: b2.id, p_reason: "bukti ditolak admin" });
          check(
            "pembatalan BOLEH setelah bukti ditolak admin",
            allowed.data?.ok === true,
            errText(allowed.error) || allowed.data?.error
          );
        }
      }
    }

    // ---------------- 6. reschedule_booking ----------------
    step("6. Ubah jadwal sendiri (reschedule_booking)");
    if (!hasSelf) {
      skip("seluruh uji ubah jadwal", `${MIGRATION_SELF} belum dijalankan`);
    } else {
      const b3 = await createBooking(clients.cust, service, {
        date: dayOffset(2),
        time: "08:00-10:00",
        notes: "probe reschedule_booking",
      });
      check("pesanan uji ubah jadwal terbuat", Boolean(b3.id), `kode ${b3.code}`);
      const assignErr = await patch("bookings", b3.id, { technician_id: tech.id, status: "paid" });
      if (assignErr) throw new Error(`gagal menugaskan teknisi ke pesanan uji: ${assignErr}`);

      const badFormat = await rpc(clients.cust, "reschedule_booking", { p_booking: b3.id, p_date: dayOffset(3), p_time: "8-10" });
      check(
        "format jam tak dikenal ditolak",
        badFormat.data?.ok === false && /jadwal tidak dikenal/i.test(badFormat.data?.error ?? ""),
        errText(badFormat.error) || badFormat.data?.error
      );

      const past = await rpc(clients.cust, "reschedule_booking", { p_booking: b3.id, p_date: dayOffset(-1), p_time: "09:00-11:00" });
      check(
        "jadwal baru di masa lalu ditolak",
        past.data?.ok === false && /masa depan/i.test(past.data?.error ?? ""),
        errText(past.error) || past.data?.error
      );

      const far = await rpc(clients.cust, "reschedule_booking", { p_booking: b3.id, p_date: dayOffset(120), p_time: "09:00-11:00" });
      check(
        "jadwal baru lebih dari 90 hari ditolak",
        far.data?.ok === false && /90 hari/i.test(far.data?.error ?? ""),
        errText(far.error) || far.data?.error
      );

      const first = await rpc(clients.cust, "reschedule_booking", { p_booking: b3.id, p_date: dayOffset(3), p_time: "09:00-11:00" });
      check("ubah jadwal pertama berhasil", first.data?.ok === true, errText(first.error) || first.data?.error);
      const { data: afterFirst } = await admin
        .from("bookings")
        .select("booking_date,booking_time,reschedule_count,last_rescheduled_at,technician_id")
        .eq("id", b3.id)
        .single();
      check("tanggal & jam pesanan benar-benar berubah di DB", afterFirst?.booking_date === dayOffset(3) && afterFirst?.booking_time === "09:00-11:00", `${afterFirst?.booking_date} ${afterFirst?.booking_time}`);
      check("penghitung ubah jadwal naik + jejak waktu terisi", Number(afterFirst?.reschedule_count) === 1 && Boolean(afterFirst?.last_rescheduled_at), `count=${afterFirst?.reschedule_count}`);
      check("teknisi TIDAK dilepas saat jadwal diubah", afterFirst?.technician_id === tech.id, `technician_id=${afterFirst?.technician_id}`);

      for (const d of [4, 5]) {
        const r = await rpc(clients.cust, "reschedule_booking", { p_booking: b3.id, p_date: dayOffset(d), p_time: "09:00-11:00" });
        check(`ubah jadwal ke-${d - 2} berhasil`, r.data?.ok === true, errText(r.error) || r.data?.error);
      }
      const over = await rpc(clients.cust, "reschedule_booking", { p_booking: b3.id, p_date: dayOffset(6), p_time: "09:00-11:00" });
      check(
        "ubah jadwal ke-4 DITOLAK (batas 3 kali)",
        over.data?.ok === false && /3 kali/i.test(over.data?.error ?? ""),
        errText(over.error) || over.data?.error
      );
      const { data: afterLimit } = await admin.from("bookings").select("reschedule_count,booking_date").eq("id", b3.id).single();
      check("batas tidak bisa dilewati lewat percobaan tambahan", Number(afterLimit?.reschedule_count) === 3 && afterLimit?.booking_date === dayOffset(5), `count=${afterLimit?.reschedule_count} tanggal=${afterLimit?.booking_date}`);
    }

    // ---------------- 7. booking_technician_info ----------------
    step("7. Jarak & kontak teknisi (booking_technician_info)");
    if (!hasInfo) {
      skip("seluruh uji jarak/kontak", `${MIGRATION_SELF} belum dijalankan`);
    } else {
      const b4 = await createBooking(clients.cust, service, {
        date: dayOffset(1),
        time: "13:00-15:00",
        notes: "probe booking_technician_info",
        lat: -6.1205,
        lng: 106.151,
      });
      const assignErr = await patch("bookings", b4.id, { technician_id: tech.id, status: "paid" });
      if (assignErr) throw new Error(`gagal menugaskan teknisi ke pesanan uji: ${assignErr}`);

      if (!coordsSupported) {
        skip("uji jarak", "RPC create_booking belum menerima p_lat/p_lng (migrate-booking-location)");
      } else {
        const { error: locErr } = await admin
          .from("technician_locations")
          .upsert(
            { technician_id: tech.id, lat: -6.118, lng: 106.151, updated_at: new Date().toISOString() },
            { onConflict: "technician_id" }
          );
        if (locErr) {
          locationsOk = false;
          skip("uji jarak", `gagal menulis technician_locations (${errText(locErr)})`);
        }
      }

      const notMine = await rpc(clients.other, "booking_technician_info", { p_booking: b4.id });
      check(
        "pelanggan lain tidak bisa melihat info teknisi pesanan ini",
        notMine.data?.ok === false && /bukan milikmu/i.test(notMine.data?.error ?? ""),
        errText(notMine.error) || notMine.data?.error
      );

      const active = await rpc(clients.cust, "booking_technician_info", { p_booking: b4.id });
      check("pemilik mendapat info teknisi", active.data?.ok === true, errText(active.error) || active.data?.error);
      check("nama teknisi terisi", active.data?.technician?.name === `Probe ${tech.label}`, `name=${active.data?.technician?.name ?? "-"}`);
      check(
        "kontak terbuka selama pesanan aktif",
        active.data?.technician?.phone === FAKE_PHONE,
        `phone=${active.data?.technician?.phone ? "ada" : "kosong"}`
      );
      check("bendera 'active' benar untuk pesanan berjalan", active.data?.active === true, own(active));
      if (locationsOk && coordsSupported) {
        const d = Number(active.data?.distance_m);
        check(
          "jarak dihitung dari lokasi teknisi yang segar (≈280 m)",
          Number.isFinite(d) && d > 0 && d < 1000,
          `distance_m=${active.data?.distance_m ?? "null"} · umur=${active.data?.location_age_min ?? "?"} menit`
        );
      }
      const raw = JSON.stringify(active.data ?? {});
      check(
        "TIDAK ada koordinat teknisi yang ikut keluar",
        !/"(lat|lng|latitude|longitude|geog)"/.test(raw),
        raw.slice(0, 160)
      );

      const asTech = await rpc(clients.tech, "booking_technician_info", { p_booking: b4.id });
      check("teknisi yang ditugaskan boleh membaca info pesanannya sendiri", asTech.data?.ok === true, errText(asTech.error) || asTech.data?.error);

      const completeErr = await patch("bookings", b4.id, { status: "completed", completed_at: new Date().toISOString() });
      if (completeErr) throw new Error(`gagal menandai pesanan selesai: ${completeErr}`);
      const closed = await rpc(clients.cust, "booking_technician_info", { p_booking: b4.id });
      check(
        "kontak DITUTUP setelah pesanan selesai (pengalihan ke chat)",
        closed.data?.ok === true && closed.data?.active === false && closed.data?.technician?.phone === null,
        `active=${closed.data?.active} phone=${closed.data?.technician?.phone ?? "null"}`
      );
    }

    // ---------------- 8. Garansi pekerjaan ----------------
    step("8. Garansi pekerjaan (create/decide/booking_warranty_info)");
    if (!hasWarranty || !service.warrantyColumnPresent) {
      skip("seluruh uji garansi", `${MIGRATION_WARRANTY} belum dijalankan`);
    } else {
      // Durasi garansi yang BERLAKU sekarang datang dari setelan platform
      // (migrate-warranty-settings.sql); `services.warranty_days` hanya menandai
      // pengecualian (0 = layanan ini tidak bergaransi).
      const setel = await bacaSetelanGaransi(admin);
      setelOk = setel.ok;
      if (!setel.ok) {
        skip(
          "seluruh uji garansi",
          `${MIGRATION_WARRANTY_SETTINGS} belum dijalankan — durasi efektif tidak bisa dipastikan (${setel.error})`
        );
      } else if (!setel.enabled || setel.days <= 0) {
        // Garansi sedang dimatikan admin: uji ini perlu garansi menyala, jadi
        // dinyalakan sementara lalu dikembalikan di akhir.
        warrantySettingsOriginal = { enabled: setel.enabled, days: setel.days };
        const err = await patch("app_settings", 1, { warranty_enabled: true, warranty_days: 7 });
        if (err) {
          setelOk = false;
          skip("seluruh uji garansi", `gagal menyalakan setelan garansi global (${err})`);
        } else {
          setel.enabled = true;
          setel.days = 7;
          info("setelan garansi global semula nonaktif → aktif 7 hari selama uji (dikembalikan di akhir)");
        }
      }

      if (setelOk) durasiEfektif = setel.days;

      if (setelOk && service.warrantyDays <= 0) {
        warrantyOriginal = service.warrantyDays;
        const err = await patch("services", service.row.id, { warranty_days: 7 });
        if (err) {
          durasiEfektif = 0;
          skip("seluruh uji garansi", `gagal menyalakan warranty_days layanan uji (${err})`);
        } else {
          service.warrantyDays = 7;
          info("services.warranty_days layanan uji semula 0 → 7 selama uji (dikembalikan di akhir)");
        }
      }

      if (durasiEfektif > 0 && service.warrantyDays > 0) {
        const days = durasiEfektif;
        const b5 = await createBooking(clients.cust, service, {
          date: dayOffset(1),
          time: "08:00-10:00",
          notes: "probe klaim garansi",
        });
        const assignErr = await patch("bookings", b5.id, { technician_id: tech.id, status: "completed", completed_at: new Date().toISOString() });
        if (assignErr) throw new Error(`gagal menyiapkan pesanan selesai: ${assignErr}`);

        const before = await rpc(clients.cust, "booking_warranty_info", { p_booking: b5.id });
        check("pesanan selesai & bergaransi → layak diklaim", before.data?.ok === true && before.data?.eligible === true, `eligible=${before.data?.eligible} days_left=${before.data?.days_left}`);
        check(`sisa masa garansi terbaca ≈ ${days} hari`, Number(before.data?.days_left) === days, `days_left=${before.data?.days_left}`);
        check("belum ada klaim pada pesanan ini", before.data?.claim === null, own(before));

        const short = await rpc(clients.cust, "create_warranty_claim", { p_booking: b5.id, p_reason: "ab" });
        check(
          "keterangan terlalu pendek ditolak",
          short.data?.ok === false && /minimal 5/i.test(short.data?.error ?? ""),
          errText(short.error) || short.data?.error
        );

        const claimed = await rpc(clients.cust, "create_warranty_claim", {
          p_booking: b5.id,
          p_reason: "AC kembali berisik sejak sehari setelah dikerjakan",
        });
        check("klaim garansi sah diterima", claimed.data?.ok === true, errText(claimed.error) || claimed.data?.error);
        check("jawaban membawa hari garansi yang berlaku", Number(claimed.data?.warranty_days) === days, own(claimed));
        const claimId = claimed.data?.claim_id;

        const again = await rpc(clients.cust, "create_warranty_claim", { p_booking: b5.id, p_reason: "mau klaim lagi dong" });
        check(
          "klaim kedua untuk pesanan yang sama ditolak (satu klaim per pesanan)",
          again.data?.ok === false && /sudah pernah/i.test(again.data?.error ?? ""),
          errText(again.error) || again.data?.error
        );

        const afterClaim = await rpc(clients.cust, "booking_warranty_info", { p_booking: b5.id });
        check(
          "setelah diklaim → tidak lagi 'eligible' & klaim terbaca",
          afterClaim.data?.eligible === false && afterClaim.data?.claim?.status === "open",
          `eligible=${afterClaim.data?.eligible} status=${afterClaim.data?.claim?.status ?? "-"}`
        );

        const byCustomer = await rpc(clients.cust, "decide_warranty_claim", { p_claim: claimId, p_status: "approved" });
        check(
          "pelanggan TIDAK bisa memutuskan klaimnya sendiri",
          byCustomer.data?.ok !== true && /hanya admin/i.test(errText(byCustomer.error) || byCustomer.data?.error || ""),
          errText(byCustomer.error) || byCustomer.data?.error || "ok=true (BOCOR!)"
        );

        const badStatus = await rpc(clients.admin, "decide_warranty_claim", { p_claim: claimId, p_status: "mungkin" });
        check(
          "keputusan tak dikenal ditolak",
          badStatus.data?.ok === false && /approved|rejected/i.test(badStatus.data?.error ?? ""),
          errText(badStatus.error) || badStatus.data?.error
        );

        const revisitDate = dayOffset(2);
        const approved = await rpc(clients.admin, "decide_warranty_claim", {
          p_claim: claimId,
          p_status: "approved",
          p_note: "kunjungan ulang gratis",
          p_date: revisitDate,
          p_time: "10:00-12:00",
        });
        check(
          "admin menyetujui klaim → kunjungan ulang dibuat",
          approved.data?.ok === true && approved.data?.status === "approved" && Boolean(approved.data?.revisit_booking_id),
          errText(approved.error) || approved.data?.error || own(approved)
        );
        const revisitId = approved.data?.revisit_booking_id;
        if (revisitId) {
          bookingIds.push(revisitId);
          await dropQueuedAdminEmail(revisitId);
        }

        const { data: revisit } = revisitId
          ? await admin
              .from("bookings")
              .select("code,user_id,service_id,technician_id,warranty_of,status,total_price,app_fee,subtotal_price,booking_date,booking_time")
              .eq("id", revisitId)
              .single()
          : { data: null };
        check("kunjungan ulang berharga 0 (garansi dibiayai platform)", Number(revisit?.total_price) === 0 && Number(revisit?.app_fee) === 0 && Number(revisit?.subtotal_price) === 0, `total=${revisit?.total_price} app_fee=${revisit?.app_fee}`);
        check("kunjungan ulang langsung ditugaskan ke teknisi ASAL", revisit?.technician_id === tech.id, `technician_id=${revisit?.technician_id ?? "null"}`);
        check("kunjungan ulang tersambung ke pesanan asal (warranty_of)", revisit?.warranty_of === b5.id, `warranty_of=${revisit?.warranty_of ?? "null"}`);
        check("kunjungan ulang memakai pelanggan & layanan yang sama", revisit?.user_id === customer.id && revisit?.service_id === service.row.id);
        check("kunjungan ulang langsung berstatus 'paid' (masuk tugas teknisi)", revisit?.status === "paid", `status=${revisit?.status}`);
        check("jadwal kunjungan ulang sesuai pilihan admin", revisit?.booking_date === revisitDate && revisit?.booking_time === "10:00-12:00", `${revisit?.booking_date} ${revisit?.booking_time}`);

        const { data: claimRow } = await admin
          .from("warranty_claims")
          .select("status,revisit_booking_id,decided_by,decided_at,admin_note,technician_id")
          .eq("id", claimId)
          .single();
        check("baris klaim diperbarui lengkap", claimRow?.status === "approved" && claimRow?.revisit_booking_id === revisitId && claimRow?.decided_by === adminUser.id && Boolean(claimRow?.decided_at) && /gratis/.test(claimRow?.admin_note ?? ""), `status=${claimRow?.status} decided_by=${claimRow?.decided_by ? "ada" : "kosong"}`);
        check("klaim menyimpan teknisi asal (siapa yang mengerjakan)", claimRow?.technician_id === tech.id, `technician_id=${claimRow?.technician_id ?? "null"}`);

        const decideTwice = await rpc(clients.admin, "decide_warranty_claim", { p_claim: claimId, p_status: "rejected" });
        check(
          "klaim yang sudah diputuskan tidak bisa diputuskan lagi",
          decideTwice.data?.ok === false && /sudah diputuskan/i.test(decideTwice.data?.error ?? ""),
          errText(decideTwice.error) || decideTwice.data?.error
        );

        // Masa garansi yang sudah lewat.
        const b6 = await createBooking(clients.cust, service, {
          date: dayOffset(1),
          time: "16:00-18:00",
          notes: "probe garansi kedaluwarsa",
        });
        const expireErr = await patch("bookings", b6.id, {
          status: "completed",
          completed_at: hoursAgoIso((days + 1) * 24),
        });
        if (expireErr) throw new Error(`gagal menyiapkan pesanan kedaluwarsa: ${expireErr}`);
        const expired = await rpc(clients.cust, "create_warranty_claim", { p_booking: b6.id, p_reason: "masih rusak, minta dicek" });
        check(
          `klaim di luar masa garansi ${days} hari ditolak & ditandai kedaluwarsa`,
          expired.data?.ok === false && expired.data?.expired === true && new RegExp(`${days} hari`).test(expired.data?.error ?? ""),
          errText(expired.error) || expired.data?.error
        );
        const expiredInfo = await rpc(clients.cust, "booking_warranty_info", { p_booking: b6.id });
        check(
          "sisa hari = 0 dan tidak layak diklaim setelah kedaluwarsa",
          expiredInfo.data?.eligible === false && Number(expiredInfo.data?.days_left) === 0,
          `eligible=${expiredInfo.data?.eligible} days_left=${expiredInfo.data?.days_left}`
        );
      }
    }

    // ---------------- 9. Setelan garansi global (saklar & pengecualian) ----------------
    step("9. Pengaturan garansi global (saklar aktif/nonaktif & pengecualian layanan)");
    if (durasiEfektif <= 0) {
      skip("uji setelan garansi global", `${MIGRATION_WARRANTY_SETTINGS} belum dijalankan / durasi 0`);
    } else {
      const b7 = await createBooking(clients.cust, service, {
        date: dayOffset(3),
        time: "13:00-15:00",
        notes: "probe setelan garansi global",
      });
      const prepErr = await patch("bookings", b7.id, {
        technician_id: tech.id,
        status: "completed",
        completed_at: new Date().toISOString(),
      });
      if (prepErr) throw new Error(`gagal menyiapkan pesanan uji setelan garansi: ${prepErr}`);

      // (a) Durasi standar menang atas angka per layanan.
      const info7 = await rpc(clients.cust, "booking_warranty_info", { p_booking: b7.id });
      check(
        `durasi standar ${durasiEfektif} hari yang berlaku (bukan angka per layanan ${service.warrantyDays})`,
        Number(info7.data?.warranty_days) === durasiEfektif && info7.data?.warranty_enabled === true,
        `warranty_days=${info7.data?.warranty_days} enabled=${info7.data?.warranty_enabled}`
      );

      // (b) Layanan dikecualikan (services.warranty_days = 0) → ditolak dengan
      //     alasan layanan, BUKAN alasan "garansi dinonaktifkan".
      const exclErr = await patch("services", service.row.id, { warranty_days: 0 });
      if (exclErr) {
        skip("uji pengecualian layanan", `gagal menandai layanan uji tanpa garansi (${exclErr})`);
      } else {
        const excl = await rpc(clients.cust, "create_warranty_claim", {
          p_booking: b7.id,
          p_reason: "uji pengecualian layanan",
        });
        check(
          "layanan bertanda tanpa garansi → klaim ditolak dengan alasan layanan",
          excl.data?.ok === false &&
            /tidak bergaransi/i.test(excl.data?.error ?? "") &&
            excl.data?.warranty_disabled !== true,
          errText(excl.error) || excl.data?.error
        );
        const balik = await patch("services", service.row.id, { warranty_days: service.warrantyDays });
        if (balik) skip("kembalikan tanda garansi layanan uji", balik);
      }

      // (c) Saklar dimatikan → klaim BARU ditolak, informasi garansi jadi 0 hari.
      const offErr = await patch("app_settings", 1, { warranty_enabled: false });
      if (offErr) {
        skip("uji saklar garansi nonaktif", `gagal mematikan setelan garansi (${offErr})`);
      } else {
        const off = await rpc(clients.cust, "create_warranty_claim", {
          p_booking: b7.id,
          p_reason: "uji garansi dimatikan admin",
        });
        check(
          "saklar garansi dimatikan → klaim baru ditolak & ditandai dinonaktifkan",
          off.data?.ok === false && off.data?.warranty_disabled === true,
          errText(off.error) || off.data?.error
        );
        const offInfo = await rpc(clients.cust, "booking_warranty_info", { p_booking: b7.id });
        check(
          "saklar mati → informasi garansi 0 hari & tidak layak diklaim",
          Number(offInfo.data?.warranty_days) === 0 &&
            offInfo.data?.eligible === false &&
            offInfo.data?.warranty_enabled === false,
          `warranty_days=${offInfo.data?.warranty_days} eligible=${offInfo.data?.eligible} enabled=${offInfo.data?.warranty_enabled}`
        );
      }

      // (d) Dinyalakan lagi → durasi standar berlaku dan klaim diterima.
      const onErr = await patch("app_settings", 1, {
        warranty_enabled: true,
        warranty_days: durasiEfektif,
      });
      if (onErr) {
        skip("uji garansi dinyalakan kembali", `gagal menyalakan setelan garansi (${onErr})`);
      } else {
        const on = await rpc(clients.cust, "create_warranty_claim", {
          p_booking: b7.id,
          p_reason: "klaim setelah garansi dinyalakan kembali",
        });
        check(
          "garansi dinyalakan lagi → klaim diterima dengan durasi standar",
          on.data?.ok === true && Number(on.data?.warranty_days) === durasiEfektif,
          errText(on.error) || on.data?.error
        );

        // (e) Mematikan garansi TIDAK boleh meninggalkan klaim menggantung:
        //     klaim yang sudah masuk tetap bisa diputuskan admin.
        const claim7 = on.data?.claim_id;
        if (claim7) {
          const off2 = await patch("app_settings", 1, { warranty_enabled: false });
          if (off2) {
            skip("uji keputusan klaim saat garansi mati", off2);
          } else {
            const decide7 = await rpc(clients.admin, "decide_warranty_claim", {
              p_claim: claim7,
              p_status: "approved",
              p_note: "kunjungan ulang garansi (uji setelan)",
              p_date: dayOffset(4),
              p_time: "10:00-12:00",
            });
            check(
              "garansi dimatikan → klaim yang sudah masuk tetap bisa diputuskan admin",
              decide7.data?.ok === true,
              errText(decide7.error) || decide7.data?.error || own(decide7)
            );
            if (decide7.data?.revisit_booking_id) {
              bookingIds.push(decide7.data.revisit_booking_id);
              await dropQueuedAdminEmail(decide7.data.revisit_booking_id);
            }
          }
          await patch("app_settings", 1, { warranty_enabled: true, warranty_days: durasiEfektif });
        }
      }
    }

    for (const c of Object.values(clients)) if (c) await c.auth.signOut();
  } finally {
    step("Pembersihan data uji");
    if (bookingIds.length) {
      // Klaim & turunannya dibersihkan lebih dulu; kunjungan ulang ikut di dalam
      // bookingIds sehingga terhapus bersama pesanan asalnya. Semua langkah
      // penghapusan diulang bila jaringan sedang putus — sisa data uji di DB
      // nyata lebih buruk daripada probe yang berjalan sedikit lebih lama.
      await resilient("hapus klaim uji", () => admin.from("warranty_claims").delete().in("booking_id", bookingIds));
      for (const table of ["reviews", "vouchers", "balance_transactions", "chat_messages"]) {
        await resilient(`hapus ${table} uji`, () => admin.from(table).delete().in("booking_id", bookingIds));
      }
      await resilient("hapus pesanan uji", () => admin.from("bookings").delete().in("id", bookingIds));
    }
    // Antrean email admin milik baris uji (pesanan & akun) dibuang SEBELUM akun
    // dihapus, supaya worker yang menyapu di sela ini tidak menemukan apa pun
    // untuk dikirim.
    const probeRefs = [...bookingIds, ...tempUsers.map((u) => u.id)];
    if (probeRefs.length) {
      await resilient("buang antrean email uji", () => admin.from("admin_email_outbox").delete().in("ref_id", probeRefs));
    }
    if (tech) {
      await resilient("hapus lokasi teknisi uji", () => admin.from("technician_locations").delete().eq("technician_id", tech.id));
    }
    if (warrantyOriginal !== null && service) {
      const err = await patch("services", service.row.id, { warranty_days: warrantyOriginal });
      console.log(`   warranty_days layanan uji ${err ? `GAGAL dikembalikan (${err})` : `dikembalikan ke ${warrantyOriginal}`}`);
    }
    // Setelan garansi SELALU dikembalikan: uji di atas sengaja mematikan
    // saklarnya, dan garansi yang tertinggal mati di produksi bukan sekadar
    // "data uji tersisa" — pelanggan kehilangan haknya. Bila semula memang
    // menyala (tidak disimpan di warrantySettingsOriginal), pastikan menyala
    // lagi walau langkah uji terakhir gagal di tengah jalan.
    if (warrantySettingsOriginal) {
      const err = await patch("app_settings", 1, warrantySettingsOriginal);
      console.log(
        `   setelan garansi global ${err ? `GAGAL dikembalikan (${err})` : `dikembalikan ke ${warrantySettingsOriginal.enabled ? "aktif" : "nonaktif"} ${warrantySettingsOriginal.days} hari`}`
      );
    } else if (durasiEfektif > 0) {
      const err = await patch("app_settings", 1, {
        warranty_enabled: true,
        warranty_days: durasiEfektif,
      });
      console.log(
        `   setelan garansi global ${err ? `GAGAL dipastikan menyala (${err})` : `dipastikan menyala ${durasiEfektif} hari`}`
      );
    }

    const del = await resilient("hapus akun uji", () => deleteTempUsers(admin, tempUsers));
    for (const d of del) console.log(`   akun uji ${d.label}: ${d.ok ? "OK" : `GAGAL (${d.error})`}`);

    const sentinel = "00000000-0000-0000-0000-000000000000";
    const dummy = [sentinel];
    const bLeft = await resilient("hitung sisa", () => countRowsByIds(admin, "bookings", bookingIds.length ? bookingIds : dummy));
    const uLeft = await resilient("hitung sisa", () => countRowsByIds(admin, "profiles", tempUsers.map((u) => u.id)));
    console.log(`   sisa: bookings=${bLeft} profiles=${uLeft}`);
    check("tidak ada sisa baris uji (bookings/profiles)", bLeft + uLeft === 0);
    if (bLeft + uLeft > 0) {
      // Cetak id agar sisa bisa dibersihkan manual — jangan pernah bilang bersih
      // kalau masih ada baris tertinggal.
      const { data: leftover } = await resilient("daftar sisa", () =>
        admin.from("bookings").select("id,code").in("id", bookingIds.length ? bookingIds : dummy)
      );
      console.log(`   SISA BELUM TERHAPUS (bersihkan manual): ${(leftover ?? []).map((b) => b.code ?? b.id).join(", ") || "-"}`);
      console.log(`   akun uji belum terhapus: ${tempUsers.map((u) => u.id).join(", ")}`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(`Asersi: ${checked - failed}/${checked} lulus${skipped ? ` · ${skipped} dilewati` : ""}`);
  if (missing.size) {
    console.log("\nBerkas migrasi yang belum dijalankan (perlu dijalankan lebih dulu):");
    for (const [name, file] of missing) console.log(`   • ${name} → ${file}`);
    console.log(
      "   Urutannya WAJIB: migrate-customer-self-service.sql dulu, lalu migrate-warranty-claims.sql, " +
        "dan terakhir migrate-warranty-settings.sql (setelan garansi global)."
    );
  }
  if (failed) {
    console.log("\nKESIMPULAN: LAYANAN_MANDIRI_PELANGGAN_GAGAL — perbaiki fungsi/penjaga di atas, jangan melemahkan asersi.");
    process.exit(1);
  }
  console.log(
    "\nKESIMPULAN: LAYANAN_MANDIRI_PELANGGAN_LULUS — batal/ubah jadwal, jarak & kontak teknisi, garansi pekerjaan, " +
      "dan setelan garansi global (saklar + durasi standar) terbukti jalan lewat RPC yang sama dengan aplikasi."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
