// ============================================================================
// verify-booking-refunds.mjs — jaga alur pengembalian dana pesanan.
//
// Janji yang diuji:
//   1. Pembatalan setelah transfer TIDAK lagi diblokir (celah lama di
//      migrate-customer-self-service.sql), dan pembatalan itu membuat baris
//      refund otomatis — bukan uang yang hilang tanpa jejak.
//   2. Satu pesanan = satu refund (unique index): dua admin tidak bisa
//      mentransfer balik dua kali.
//   3. Keputusan (selesai/ditolak) hanya dari 'pending', dan pelanggan diberi
//      tahu lewat push.
//   4. Status refund terlihat pelanggan di detail pesanan & struk.
//
// Pemakaian:
//   npm run verify:refund            → statis + uji fungsi murni (tanpa jaringan)
//   npm run verify:refund -- --live  → ditambah probe database nyata
//
// Exit: 0 lulus · 1 ada temuan · 3 kredensial kurang (mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  alasanRefundSah,
  nominalRefundSah,
  ringkasRefund,
} from "../src/lib/booking-refund.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (berkas) => readFileSync(path.join(ROOT, berkas), "utf8");

let lulus = 0;
const gagal = [];
const cek = (nama, kondisi, mengapa) => {
  if (kondisi) {
    lulus += 1;
    console.log(`  lulus  ${nama}`);
  } else {
    gagal.push(`${nama} — ${mengapa}`);
    console.log(`  GAGAL  ${nama}`);
  }
};

// ---------------------------------------------------------------- migrasi ---
const sql = baca("supabase/migrate-booking-refunds.sql");

cek(
  "tabel booking_refunds dibuat",
  /create table if not exists public\.booking_refunds/.test(sql),
  "tanpa tabel, refund hanya ada di luar sistem"
);
cek(
  "satu pesanan hanya boleh punya SATU refund",
  /unique index if not exists booking_refunds_booking_id_key\s+on public\.booking_refunds \(booking_id\)/.test(
    sql
  ),
  "tanpa batasan ini dua admin bisa mentransfer balik dua kali"
);
cek(
  "status refund dibatasi pending/done/rejected",
  /status text not null default 'pending' check \(status in \('pending', 'done', 'rejected'\)\)/.test(
    sql
  ),
  "status bebas membuat laporan tidak bisa dijumlahkan"
);
cek(
  "nominal refund harus > 0",
  /amount numeric\(12,0\) not null check \(amount > 0\)/.test(sql),
  "refund 0/negatif hanya menyesatkan laporan"
);
cek(
  "bukti transfer balik + pelaku tercatat",
  /proof_url text/.test(sql) &&
    /created_by uuid/.test(sql) &&
    /decided_by uuid/.test(sql) &&
    /decided_at timestamptz/.test(sql),
  "tanpa bukti & pelaku, sengketa tidak bisa dijawab"
);
cek(
  "pelanggan hanya membaca refund pesanannya sendiri",
  /b\.id = booking_refunds\.booking_id and b\.user_id = auth\.uid\(\)/.test(sql),
  "data refund orang lain tidak boleh terbaca"
);
cek(
  "hanya admin yang boleh menulis refund dari klien",
  (sql.match(/with check \(public\.is_admin\(\)\)/g) || []).length >= 2,
  "pelanggan tidak boleh mengarang nominal refund"
);
cek(
  "pembatalan setelah transfer TIDAK lagi ditolak",
  !/Bukti bayarmu sudah diunggah/.test(sql.split("create or replace function public.cancel_booking")[1] || ""),
  "penjaga lama membuat pelanggan yang sudah transfer tidak bisa membatalkan"
);
cek(
  "pembatalan membuat baris refund otomatis (idempoten)",
  /insert into booking_refunds/.test(sql) &&
    /on conflict \(booking_id\) do nothing/.test(sql),
  "pelanggan menekan batal dua kali tidak boleh menciptakan dua kewajiban"
);
cek(
  "keputusan admin tidak ditimpa pembatalan ulang",
  /TIDAK ditimpa/.test(sql),
  "baris yang sudah selesai/ditolak tidak boleh kembali pending"
);
cek(
  "uang yang belum dikonfirmasi ditandai",
  /payment_confirmed boolean not null default false/.test(sql) &&
    /'cancel',\s*\(v_b\.status = 'paid'\)/.test(sql),
  "admin harus tahu bukti bayar masih menunggu konfirmasi sebelum transfer"
);
cek(
  "RPC status refund dibatasi pihak pesanan",
  /create or replace function public\.booking_refund_info/.test(sql) &&
    /v_b\.user_id <> auth\.uid\(\)/.test(sql) &&
    /not public\.is_admin\(\)/.test(sql),
  "teknisi/pelanggan lain tidak boleh membaca status refund orang lain"
);
cek(
  "izin RPC dicabut dari PUBLIC/anon",
  /revoke all on function public\.booking_refund_info\(uuid\) from public, anon, authenticated/.test(
    sql
  ) && /revoke all on function public\.cancel_booking\(uuid, text\) from public, anon, authenticated/.test(sql),
  "grant bawaan PUBLIC membuat RPC bisa dipanggil tanpa login"
);
cek(
  "bucket bukti refund PRIVAT",
  /values \('refund-proofs', 'refund-proofs', false\)/.test(sql),
  "bukti transfer memuat nomor rekening — jangan publik"
);
cek(
  "bucket hanya bisa dibaca admin & pemilik pesanan",
  /bucket_id = 'refund-proofs'/.test(sql) &&
    /b\.user_id = auth\.uid\(\)/.test(sql),
  "bukti transfer balik bukan untuk semua pengguna"
);

// ------------------------------------------------------- daftar izin RPC ---
const grants = baca("supabase/fix-rpc-grants-public.sql");
cek(
  "RPC refund tercatat di daftar izin",
  /'booking_refund_info\(uuid\)', 'authenticated, service_role'/.test(grants),
  "npm run verify:rpc-grants akan menganggapnya tidak terurus"
);

// --------------------------------------------------------- server actions ---
const aksi = baca("src/app/actions/admin.js");
cek(
  "aksi catat/selesaikan/tolak refund tersedia",
  /export async function createBookingRefundAdmin/.test(aksi) &&
    /export async function completeBookingRefundAdmin/.test(aksi) &&
    /export async function rejectBookingRefundAdmin/.test(aksi),
  "tanpa aksi ini baris refund tidak bisa diputuskan dari panel"
);
cek(
  "pembatalan admin mencatat kewajiban refund",
  /catatRefundPembatalan\(supabase, cur, admin\.id\)/.test(aksi),
  "pembatalan oleh admin juga harus mengembalikan uang, bukan hanya pelanggan"
);
cek(
  "keputusan hanya dari status pending",
  (aksi.match(/\.eq\("status", "pending"\)/g) || []).length >= 2,
  "menyelesaikan refund dua kali akan mencatat uang keluar ganda"
);
cek(
  "pelanggan menerima push saat status refund berubah",
  (aksi.match(/"refund_update"/g) || []).length >= 2,
  "status yang berubah diam-diam membuat pelanggan menanyakan uangnya"
);
cek(
  "ringkasan keuangan memisahkan kewajiban & uang keluar",
  /refunds: \{\s*\.\.\.ringkasRefund/.test(aksi) &&
    /supabase\.from\("booking_refunds"\)/.test(aksi),
  "kewajiban yang belum ditransfer bukan uang keluar"
);

const keuangan = baca("src/components/FinanceSummary.js");
cek(
  "kartu ringkasan menampilkan refund belum ditransfer",
  /Refund Pelanggan \(belum ditransfer\)/.test(keuangan),
  "tanpa kartu ini kewajiban refund hanya terlihat di tab terpisah"
);

const panel = baca("src/components/AdminDashboard.js");
cek(
  "panel admin punya tab Refund",
  /import RefundAdminTab/.test(panel) && /label=\{`Refund/.test(panel),
  "antrean refund harus punya tempat memutuskan"
);
cek(
  "kartu pesanan menampilkan status refund",
  /Pengembalian dana \{formatRupiah\(rf\.amount\)\}/.test(panel),
  "admin tidak perlu membuka tab lain untuk tahu uang sudah kembali"
);

const tab = baca("src/components/RefundAdminTab.js");
cek(
  "menyelesaikan refund butuh konfirmasi dua langkah",
  /konfirmasi === r\.id/.test(tab) && /Ya, dana sudah dikirim/.test(tab),
  "salah klik berarti uang dinyatakan keluar padahal belum ditransfer"
);
cek(
  "bukti transfer balik diunggah ke bucket privat",
  /from\(BUCKET\)\s*\.upload/.test(tab) && /const BUCKET = "refund-proofs"/.test(tab),
  "bukti harus tersimpan sebagai objek, bukan tautan luar"
);

// ------------------------------------------------------------- aplikasi -----
const models = baca("flutter_app/lib/models.dart");
cek(
  "aplikasi punya model status refund",
  /class BookingRefund/.test(models) && /factory BookingRefund\.fromRpc/.test(models),
  "tanpa model, status refund tidak bisa ditampilkan"
);
cek(
  "aturan batal di aplikasi tidak lagi memblokir bukti bayar",
  !/belum ada alur refund/.test(models),
  "tombol yang lebih ketat daripada server membuat fitur refund tidak terpakai"
);
const detail = baca("flutter_app/lib/ui/order_detail_screen.dart");
cek(
  "detail pesanan menampilkan kartu pengembalian dana",
  /_kartuRefund\(\)/.test(detail) && /Menunggu transfer balik/.test(models),
  "pelanggan harus bisa melihat status uangnya di pesanan"
);
const struk = baca("flutter_app/lib/ui/receipt_screen.dart");
cek(
  "struk memuat baris pengembalian dana",
  /'Pengembalian dana',/.test(struk),
  "struk adalah bukti yang disimpan pelanggan"
);
const api = baca("flutter_app/lib/api.dart");
cek(
  "aplikasi memanggil RPC status refund",
  /rpc\('booking_refund_info'/.test(api),
  "status refund tidak boleh ditebak dari status pesanan"
);
const inbox = baca("flutter_app/lib/inbox.dart");
cek(
  "kabar refund masuk kotak masuk pelanggan, bukan teknisi",
  /InboxKind\.refund/.test(inbox) &&
    /if \(!technician\) \{\s*for \(final r in refunds/.test(inbox) &&
    /refundInboxNotice\(/.test(inbox),
  "status uang harus terlihat tanpa membuka tiap pesanan"
);
cek(
  "keputusan admin atas refund muncul sebagai kabar BARU",
  /String refundNoticeVersion/.test(inbox) && /seen\[key\] != version/.test(inbox),
  "versi kabar harus berubah saat status pengembalian dana berubah"
);
cek(
  "aplikasi membaca refund milik pelanggan untuk kotak masuk",
  /static Future<List<BookingRefund>> fetchMyRefunds/.test(api) &&
    /\.from\('booking_refunds'\)/.test(api),
  "tanpa query, kabar refund tidak pernah muncul di kotak masuk"
);
cek(
  "keputusan refund memperbarui angka lonceng secara realtime",
  /onRefundUpdate/.test(api) &&
    /table: 'booking_refunds'/.test(api) &&
    /onRefundUpdate/.test(baca("flutter_app/lib/ui/common.dart")),
  "tanpa langganan, angka baru muncul setelah aplikasi di-resume"
);

// Pembatalan pesanan yang sudah ditugaskan = kabar bagi TEKNISI, dengan
cek(
  "teknisi diberi tahu dampak pembatalan ke saldo",
  /commissionedBookingIds/.test(inbox) &&
    /Saldo kamu tidak berubah/.test(inbox) &&
    /TIDAK dikembalikan otomatis/.test(inbox) &&
    /fetchMyCommissionedBookingIds/.test(api),
  "tanpa penjelasan, teknisi menebak apakah komisinya ikut hilang"
);
const blokBatal = (inbox.match(/case BookingStatus\.cancelled:[\s\S]{0,800}?return \(/) || [""])[0];
cek(
  "kabar pembatalan teknisi tidak memuat nominal refund pelanggan",
  blokBatal.length > 0 && !/formatRupiah|r\.amount|refund_amount/.test(blokBatal),
  "nominal refund adalah data pelanggan, bukan hak teknisi"
);

// Push pembatalan ke teknisi harus memakai kalimat yang SAMA dengan kotak
// masuk — dua kanal dengan kalimat berbeda terasa seperti dua aturan saldo.
const cancelNotice = baca("src/lib/cancel-notice.js");
const routeChange = baca("src/app/api/notify-booking-change/route.js");
const adminSrc = baca("src/app/actions/admin.js");
const kalimatSama = [
  "Komisi hanya dipotong setelah pekerjaan selesai — cek layar Saldo untuk memastikan.",
  "Komisi pesanan ini sudah terpotong dan TIDAK dikembalikan otomatis — hubungi admin bila perlu penyesuaian saldo.",
  "Saldo kamu tidak berubah: komisi baru dipotong setelah pekerjaan selesai.",
].every((t) => inbox.includes(t) && cancelNotice.includes(t));
cek(
  "push pembatalan memakai kalimat dampak saldo yang sama dengan kotak masuk",
  kalimatSama &&
    /technicianCancelNotice/.test(routeChange) &&
    /technicianCancelNotice/.test(adminSrc),
  "satu kejadian, dua kanal — kalimatnya tidak boleh berbeda"
);
cek(
  "pembatalan dari pelanggan DAN admin sama-sama memberi tahu teknisi",
  /technicianCancelNotice/.test(routeChange) &&
    /cur\.technician_id[\s\S]{0,700}technicianCancelNotice/.test(adminSrc),
  "admin membatalkan lewat panel tidak boleh membuat teknisi tetap datang"
);
cek(
  "push pembatalan teknisi tidak memuat nominal refund pelanggan",
  !/formatRupiah|refund_amount|r\.amount/.test(cancelNotice) &&
    !/formatRupiah|refund_amount|r\.amount/.test(
      (routeChange.match(/if \(event === "order_cancelled"\)[\s\S]{0,1200}/) || [""])[0]
    ),
  "nominal refund adalah data pelanggan, bukan hak teknisi"
);
cek(
  "teknisi bisa mematikan push pembatalan di Pengaturan Notifikasi",
  (baca("flutter_app/lib/ui/notification_settings_screen.dart").match(/order_cancelled/g) || [])
    .length >= 2,
  "push yang tidak bisa dimatikan melanggar pilihan pengguna"
);

// --------------------------------------------------------- fungsi murni -----
cek(
  "nominal nol/negatif ditolak",
  !nominalRefundSah(0) && !nominalRefundSah(-5000) && nominalRefundSah("25000"),
  "refund 0 bukan refund"
);
cek("alasan < 5 karakter ditolak", !alasanRefundSah("ok") && alasanRefundSah("dana dikembalikan"));
const ringkas = ringkasRefund([
  { amount: 100000, status: "pending", created_at: new Date().toISOString() },
  { amount: 50000, status: "done", decided_at: new Date().toISOString() },
  { amount: 75000, status: "done", decided_at: "2020-01-01T00:00:00Z" },
  { amount: 30000, status: "rejected" },
]);
cek(
  "ringkasan memisahkan kewajiban dari uang keluar",
  ringkas.pendingAmount === 100000 &&
    ringkas.pendingCount === 1 &&
    ringkas.doneTotal === 125000 &&
    ringkas.donePeriode === 50000 &&
    ringkas.rejectedCount === 1,
  `hasil: ${JSON.stringify(ringkas)}`
);

// ----------------------------------------------------------------- e2e ------
/**
 * Alur nyata: pelanggan membatalkan pesanan yang bukti transfernya sudah
 * diunggah → server WAJIB membuat baris refund. Inilah janji utama berkas ini;
 * tanpa uji ini, "refund otomatis" hanya klaim di komentar.
 *
 * Semua baris uji dihapus di blok `finally`, termasuk akun sementara.
 */
async function e2e() {
  const probe = await import("./lib/probe-env.mjs");
  const env = probe.loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("\n(tanpa kredensial — e2e dilewati)");
    process.exit(3);
  }

  const admin = probe.makeAdminClient(env);
  const users = [];
  let bookingId = null;

  try {
    const [{ data: svc }, cust, lain, adminUji] = await Promise.all([
      admin.from("services").select("id").limit(1).maybeSingle(),
      probe.createTempUser(admin, "customer", "refund-e2e"),
      probe.createTempUser(admin, "customer", "refund-lain"),
      probe.createTempUser(admin, "admin", "refund-admin"),
    ]);
    users.push(cust, lain, adminUji);
    if (!svc?.id) throw new Error("tidak ada layanan untuk fixture pesanan");

    const tanggal = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const kode = `RF-E2E-${Date.now()}`;
    const { data: booking, error: insErr } = await admin
      .from("bookings")
      .insert({
        code: kode,
        user_id: cust.id,
        service_id: svc.id,
        booking_date: tanggal,
        booking_time: "08:00-10:00",
        address: "PROBE REFUND — baris uji otomatis, aman dihapus",
        notes: "probe scripts/verify-booking-refunds.mjs --e2e",
        subtotal_price: 150000,
        app_fee: 5000,
        total_price: 155000,
        payment_method: "transfer",
        payment_proof_url: "probe/bukti-transfer.jpg",
        payment_amount: 155000,
        status: "pending",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`insert pesanan uji gagal: ${insErr.message}`);
    bookingId = booking.id;

    const pembeli = probe.makeUserClient(env);
    const masuk = await pembeli.auth.signInWithPassword({ email: cust.email, password: cust.password });
    if (masuk.error) throw new Error(`signIn pelanggan gagal: ${masuk.error.message}`);

    const batal = await pembeli.rpc("cancel_booking", {
      p_booking: bookingId,
      p_reason: "rencana berubah (probe refund)",
    });
    cek(
      "e2e: pembatalan setelah transfer DIIZINKAN",
      batal.error == null && batal.data?.ok === true,
      batal.error?.message || JSON.stringify(batal.data)
    );
    cek(
      "e2e: nominal refund = jumlah yang diklaim pelanggan",
      Number(batal.data?.refund_amount) === 155000,
      `refund_amount=${batal.data?.refund_amount}`
    );

    const { data: refund, error: refErr } = await admin
      .from("booking_refunds")
      .select("id, amount, status, source, payment_confirmed, user_id")
      .eq("booking_id", bookingId)
      .maybeSingle();
    cek(
      "e2e: baris refund dibuat otomatis & menunggu transfer",
      !refErr && refund?.status === "pending" && refund?.source === "cancel",
      refErr?.message || JSON.stringify(refund)
    );
    cek(
      "e2e: bukti bayar yang belum dikonfirmasi ditandai",
      refund?.payment_confirmed === false && refund?.user_id === cust.id,
      `payment_confirmed=${refund?.payment_confirmed}`
    );

    const info = await pembeli.rpc("booking_refund_info", { p_booking: bookingId });
    cek(
      "e2e: pelanggan melihat status refund pesanannya",
      info.data?.ok === true && info.data?.refund?.status === "pending",
      info.error?.message || JSON.stringify(info.data)
    );

    // Query PERSIS yang dipakai kotak masuk Flutter (Api.fetchMyRefunds) —
    // termasuk embed `booking:bookings(code, services(name))`. Kalau bentuk
    // embed ini ditolak PostgREST, kabar refund hilang dari kotak masuk.
    const kabar = await pembeli
      .from("booking_refunds")
      .select(
        "id, booking_id, amount, status, reason, note, rejection_reason, proof_url, payment_confirmed, created_at, decided_at, " +
          "booking:bookings(code, services(name))"
      )
      .eq("user_id", cust.id)
      .order("created_at", { ascending: false })
      .limit(100);
    cek(
      "e2e: kotak masuk pelanggan membaca refund + kode pesanan",
      !kabar.error &&
        kabar.data?.length === 1 &&
        kabar.data[0].booking?.code === kode &&
        kabar.data[0].amount === 155000,
      kabar.error?.message || JSON.stringify(kabar.data)
    );

    const orangLain = probe.makeUserClient(env);
    await orangLain.auth.signInWithPassword({ email: lain.email, password: lain.password });
    const infoLain = await orangLain.rpc("booking_refund_info", { p_booking: bookingId });
    cek(
      "e2e: pelanggan LAIN tidak bisa membaca status refund",
      infoLain.data?.ok === false,
      JSON.stringify(infoLain.data)
    );

    // Query yang dipakai panel admin — menguji bentuk embed PostgREST, bukan
    // hanya tabelnya. Salah nama relasi = tab Refund kosong saat produksi.
    const queries = await admin
      .from("booking_refunds")
      .select(
        "*, bookings!booking_refunds_booking_id_fkey(code, status, total_price, booking_date, booking_time, address, profiles!bookings_user_id_fkey(name, email, phone)), " +
          "created_by_admin:profiles!booking_refunds_created_by_fkey(name), " +
          "decided_by_admin:profiles!booking_refunds_decided_by_fkey(name)"
      )
      .eq("booking_id", bookingId)
      .maybeSingle();
    cek(
      "e2e: query panel admin (embed pesanan & pelaku) valid",
      !queries.error && queries.data?.bookings?.profiles?.name != null,
      queries.error?.message || "tanpa nama pelanggan"
    );

    // Keputusan dijalankan lewat SESI ADMIN (RLS policy), bukan service role:
    // itulah jalur yang dipakai panel. Service role akan lulus walau policy
    // insert/update admin hilang — kegagalan yang baru terlihat di produksi.
    const panel = probe.makeUserClient(env);
    const masukAdmin = await panel.auth.signInWithPassword({
      email: adminUji.email,
      password: adminUji.password,
    });
    cek("e2e: sesi admin uji bisa masuk", !masukAdmin.error, masukAdmin.error?.message || "");

    const daftarPanel = await panel
      .from("booking_refunds")
      .select("id, status, amount")
      .eq("booking_id", bookingId);
    cek(
      "e2e: admin bisa membaca antrean refund lewat RLS",
      !daftarPanel.error && daftarPanel.data?.length === 1,
      daftarPanel.error?.message || "baris tidak terbaca"
    );

    const selesai = await panel
      .from("booking_refunds")
      .update({ status: "done", decided_at: new Date().toISOString(), decided_by: adminUji.id })
      .eq("id", refund.id)
      .eq("status", "pending")
      .select("status, decided_by")
      .maybeSingle();
    cek(
      "e2e: keputusan hanya dari pending & status tersimpan",
      !selesai.error && selesai.data?.status === "done" && selesai.data?.decided_by === adminUji.id,
      selesai.error?.message || "status tidak berubah"
    );

    // Pelanggan TIDAK boleh menulis refundnya sendiri (mis. menaikkan nominal).
    const tulisPelanggan = await pembeli
      .from("booking_refunds")
      .update({ amount: 999999 })
      .eq("id", refund.id)
      .select("amount");
    const { data: tetap } = await admin
      .from("booking_refunds")
      .select("amount")
      .eq("id", refund.id)
      .single();
    cek(
      "e2e: pelanggan tidak bisa mengubah nominal refund",
      (tulisPelanggan.error != null || (tulisPelanggan.data || []).length === 0) &&
        Number(tetap?.amount) === 155000,
      `amount sekarang=${tetap?.amount}`
    );

    // Policy INSERT admin (dipakai "Catat pengembalian manual").
    const { data: bookingDua, error: errDua } = await admin
      .from("bookings")
      .insert({
        code: `${kode}-2`,
        user_id: lain.id,
        service_id: svc.id,
        booking_date: tanggal,
        booking_time: "13:00-15:00",
        address: "PROBE REFUND 2 — baris uji otomatis, aman dihapus",
        subtotal_price: 1000,
        total_price: 1000,
        status: "cancelled",
      })
      .select("id")
      .single();
    if (errDua) throw new Error(`insert pesanan uji kedua gagal: ${errDua.message}`);
    const catat = await panel
      .from("booking_refunds")
      .insert({
        booking_id: bookingDua.id,
        user_id: lain.id,
        amount: 1000,
        reason: "probe catat manual oleh admin",
        source: "admin",
        created_by: adminUji.id,
      })
      .select("id")
      .single();
    cek(
      "e2e: admin bisa mencatat refund manual lewat RLS",
      !catat.error && Boolean(catat.data?.id),
      catat.error?.message || "baris tidak dibuat"
    );

    const orangLainDua = probe.makeUserClient(env);
    await orangLainDua.auth.signInWithPassword({ email: lain.email, password: lain.password });
    const catatPelanggan = await orangLainDua.from("booking_refunds").insert({
      booking_id: bookingDua.id,
      user_id: lain.id,
      amount: 5000,
      reason: "probe pelanggan mengarang refund",
    });
    cek(
      "e2e: pelanggan tidak bisa mencatat refund sendiri",
      Boolean(catatPelanggan.error),
      "insert pelanggan berhasil — RLS bolong"
    );

    if (bookingDua?.id) await admin.from("bookings").delete().eq("id", bookingDua.id);

    const infoAkhir = await pembeli.rpc("booking_refund_info", { p_booking: bookingId });
    cek(
      "e2e: pelanggan melihat dana sudah dikembalikan",
      infoAkhir.data?.refund?.status === "done",
      JSON.stringify(infoAkhir.data)
    );

    // Status TERBARU harus terbaca kotak masuk (dan tidak bocor ke pelanggan lain).
    const kabarAkhir = await pembeli
      .from("booking_refunds")
      .select("id, status, decided_at")
      .eq("user_id", cust.id);
    cek(
      "e2e: kotak masuk membaca status refund terbaru",
      kabarAkhir.data?.length === 1 &&
        kabarAkhir.data[0].status === "done" &&
        kabarAkhir.data[0].decided_at != null,
      JSON.stringify(kabarAkhir.data)
    );
    const kabarLain = await orangLain
      .from("booking_refunds")
      .select("id")
      .eq("user_id", cust.id);
    cek(
      "e2e: kotak masuk pelanggan lain tidak memuat refund ini",
      (kabarLain.data || []).length === 0,
      JSON.stringify(kabarLain.data)
    );
  } catch (e) {
    cek("e2e: alur refund berjalan", false, e.message);
  } finally {
    if (bookingId) await admin.from("bookings").delete().eq("id", bookingId);
    await probe.deleteTempUsers(admin, users);
  }
}

// ---------------------------------------------------------------- live ------
const live = process.argv.includes("--live") || process.argv.includes("--e2e");
if (live) {
  const probe = await import("./lib/probe-env.mjs");
  const env = probe.loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("\n(tanpa kredensial — probe live dilewati)");
    process.exit(3);
  }
  const admin = probe.makeAdminClient(env);
  const anon = probe.makeAnonClient(env);

  const tabel = await admin.from("booking_refunds").select("id", { count: "exact", head: true });
  cek("live: tabel booking_refunds ada", !tabel.error, tabel.error?.message || "");

  const bucket = await admin.storage.getBucket("refund-proofs");
  cek(
    "live: bucket refund-proofs ada & privat",
    !bucket.error && bucket.data?.public === false,
    bucket.error?.message || `public=${bucket.data?.public}`
  );

  const rpcAnon = await anon.rpc("booking_refund_info", {
    p_booking: "00000000-0000-0000-0000-000000000000",
  });
  const pesan = rpcAnon.data?.error || rpcAnon.error?.message || "";
  cek(
    "live: anon tidak bisa memakai RPC refund",
    Boolean(rpcAnon.error) || rpcAnon.data?.ok !== true || /login/i.test(pesan),
    `jawaban: ${JSON.stringify(rpcAnon.data)}`
  );

  const insertAnon = await anon.from("booking_refunds").insert({
    booking_id: "00000000-0000-0000-0000-000000000000",
    amount: 1,
    reason: "probe izin",
  });
  cek(
    "live: anon tidak bisa menulis refund",
    Boolean(insertAnon.error),
    "insert anon berhasil — RLS bolong"
  );
}

if (process.argv.includes("--e2e")) {
  console.log("\nAlur nyata (e2e)");
  await e2e();
}

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
