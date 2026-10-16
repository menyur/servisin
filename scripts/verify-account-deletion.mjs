#!/usr/bin/env node
// ============================================================================
// verify-account-deletion.mjs — buktikan JALUR HAPUS AKUN benar-benar berjalan
// di database dan di Admin API, bukan sekadar tercermin di UI.
//
// Kenapa probe ini penting: halaman /hapus-akun dan tombol di aplikasi hanya
// MEMINTA. Yang menentukan adalah fungsi security definer di Supabase
// (supabase/migrate-account-deletion.sql) plus pencabutan akses lewat GoTrue.
// Kalau penjaganya bocor, permintaan bisa berjalan saat masih ada pesanan
// menggantung; kalau pencabutannya gagal, akun "terhapus" masih bisa dipakai
// masuk. Dua-duanya tidak terlihat dari layar, dan dua-duanya berbahaya.
//
// Semua data dibuat dari nol dan DIBERSIHKAN SENDIRI (aman diulang):
//   1 pelanggan bersih + 1 pelanggan jalur web + 1 teknisi bersaldo + 1 admin,
//   2 pesanan, 1 baris chat, 1 token FCM, dan beberapa permintaan hapus.
//
// TANPA SPAM KE ADMIN (penting): trigger pada tabel permintaan mengantre email
// admin (`event=account_deletion`) untuk SETIAP permintaan yang berstatus
// 'diminta', dan `trg_admin_email_outbox_kick` memanggil worker lewat pg_net
// SEKETIKA — jadi "membersihkan di akhir" saja tidak cukup. Dua langkah:
//   (a) akun uji dibuat ber-role `admin` lebih dulu (trigger pendaftar baru
//       sengaja mengabaikan admin) lalu role sebenarnya dipasang via service
//       role — pola yang sama dengan verify-customer-self-service.mjs;
//   (b) baris antrean untuk tiap permintaan uji dihapus SEGERA setelah dibuat.
// Sisa jendela lomba yang belum bisa ditutup: satu email bisa sangat singkat
// terlihat worker bila koneksinya lebih cepat dari penghapusan kita.
//
// Yang dibuktikan:
//   A. request_account_deletion   — jalur aplikasi; idempoten; ditolak saat ada
//                                   pesanan aktif / saldo belum nol / akun admin.
//   B. my_account_deletion        — status & alasan penghalang untuk UI.
//   C. cancel_account_deletion    — pengguna bisa membatalkan.
//   D. RLS                        — pengguna lain tidak bisa melihat/menulis
//                                   permintaan orang lain; bukan admin tidak
//                                   bisa mengeksekusi; anon tidak punya izin.
//   E. JALUR WEB (token)          — permintaan 'menunggu_konfirmasi', token
//                                   tersimpan sebagai HASH, salah token ditolak,
//                                   konfirmasi sekali pakai, jeda per alamat,
//                                   dan jawaban anti-enumerasi untuk surel tak
//                                   terdaftar.
//   F. eksekusi                   — profil dianonimkan, konten pribadi dihapus,
//                                   pesanan DIPERTAHANKAN tanpa isi pribadi,
//                                   permintaan 'selesai', surel auth jadi
//                                   tombstone + akun di-banned (login gagal).
//
// Exit: 0 lulus · 1 ada regresi · 2 migrasi belum dijalankan · 3 tanpa kredensial.
// Tidak pernah mencetak nilai rahasia. Jalankan: npm run verify:hapus-akun
// ============================================================================
import { readFileSync } from "node:fs";
import { loadEnv, makeAdminClient, makeAnonClient, createTempUser, deleteTempUsers, sleep } from "./lib/probe-env.mjs";
import {
  mintaHapusAkunWeb,
  konfirmasiHapusAkun,
  periksaTautanKonfirmasi,
  eksekusiHapusAkun,
  hashToken,
  tokenSah,
  pathBerkas,
  maskEmail,
  lupakanRiwayatJeda,
  JANJI_HARI,
  PESAN_BLOKIR,
  pesanBlokir,
  RENCANA_HAPUS,
  ringkasKelayakan,
  ringkasEksekusi,
  KODE_BLOKIR_INTERNAL,
} from "../src/lib/account-deletion.js";

const MIGRATION = "supabase/migrate-account-deletion.sql";

const pembersihAkun = [];
const permintaanIds = [];
const bookingIds = [];
let gagal = 0;
let diperiksa = 0;

function cek(label, ok, detail = "") {
  diperiksa++;
  if (!ok) gagal++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
function info(pesan) {
  console.log(`ℹ️  ${pesan}`);
}
function langkah(judul) {
  console.log(`\n--- ${judul} ---`);
}
function errText(err) {
  if (!err) return "";
  return err.message || err.details || err.hint || String(err.code ?? "");
}
const TAK_ADA = /does not exist|could not find the function|schema cache/i;

/** Mask yang aman dicetak di log (tidak pernah alamat utuh / isi baris). */
const aman = (nilai, n = 24) => String(nilai ?? "-").slice(0, n);

async function main() {
  const env = loadEnv();
  const admin = makeAdminClient(env);
  const anon = makeAnonClient(env);

  // ---------------------------------------------------------------------------
  langkah("Preflight");
  // ---------------------------------------------------------------------------
  const pre = await admin.from("account_deletion_requests").select("id").limit(1);
  if (pre.error) {
    if (TAK_ADA.test(errText(pre.error))) {
      console.log(`\n⛔ Migrasi belum dijalankan: ${MIGRATION}`);
      console.log("   Buka Supabase → SQL Editor → tempel isi berkas itu → Run, lalu ulangi.");
      return 2;
    }
    throw new Error(`gagal baca account_deletion_requests: ${errText(pre.error)}`);
  }
  info(`tabel account_deletion_requests ada`);

  // ---------------------------------------------------------------------------
  langkah("Fixture");
  // ---------------------------------------------------------------------------
  // Akun selalu dibuat ber-role admin dulu lalu role-nya dipatch (service role)
  // supaya trigger "pendaftar baru" tidak mengantre email ke admin sungguhan.
  const buat = async (role, label) => {
    const u = await createTempUser(admin, "admin", label);
    const { error } = await admin.from("profiles").update({ role }).eq("id", u.id);
    if (error) throw new Error(`gagal memasang role ${role} pada ${label}: ${errText(error)}`);
    u.role = role;
    pembersihAkun.push(u);
    return u;
  };

  const pelanggan = await buat("customer", "del-cust");
  const pelangganWeb = await buat("customer", "del-web");
  const teknisi = await buat("technician", "del-tech");
  const adminUji = await buat("admin", "del-admin");
  await admin.from("profiles").update({ balance: 5000 }).eq("id", teknisi.id);

  const { data: layanan } = await admin
    .from("services")
    .select("id,name,base_price")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!layanan) throw new Error("tidak ada layanan aktif untuk fixture");

  const buatBooking = async (userId, status, catatan) => {
    const { data, error } = await admin
      .from("bookings")
      .insert({
        code: `DEL-${Date.now().toString().slice(-7)}-${bookingIds.length}`,
        user_id: userId,
        service_id: layanan.id,
        booking_date: new Date().toISOString().slice(0, 10),
        booking_time: "08:00-10:00",
        address: "Jl. Probe Hapus Akun 1",
        notes: catatan,
        subtotal_price: Number(layanan.base_price) || 100000,
        app_fee: 5000,
        total_price: Number(layanan.base_price) || 100000,
        status,
      })
      .select("id")
      .single();
    if (error) throw new Error(`gagal membuat booking uji: ${errText(error)}`);
    bookingIds.push(data.id);
    // Trigger memesan email admin untuk pesanan baru — buang segera.
    await admin.from("admin_email_outbox").delete().eq("ref_id", data.id);
    return data.id;
  };

  /** Baris antrean email admin untuk satu permintaan uji (dibuang secepatnya). */
  const buangAntrean = async (refId) =>
    admin.from("admin_email_outbox").delete().eq("ref_id", refId);

  /** Klien pengguna ber-JWT: signInWithPassword lalu dipakai memanggil RPC. */
  const klien = (u) => {
    const client = makeAnonClient(env);
    return client.auth
      .signInWithPassword({ email: u.email, password: u.password })
      .then(({ error }) => {
        if (error) throw new Error(`gagal masuk akun uji: ${error.message}`);
        return client;
      });
  };

  const c = {
    pelanggan: await klien(pelanggan),
    web: await klien(pelangganWeb),
    teknisi: await klien(teknisi),
    admin: await klien(adminUji),
  };

  // ---------------------------------------------------------------------------
  langkah("A. Jalur aplikasi: penjaga, idempotensi, pembatalan");
  // ---------------------------------------------------------------------------
  const bookingAktif = await buatBooking(pelanggan.id, "pending", null);
  const ditolak = await c.pelanggan.rpc("request_account_deletion", { p_alasan: "probe" });
  cek(
    "pesanan aktif menahan permintaan",
    ditolak.data?.ok === false && ditolak.data?.error === "pesanan_aktif",
    `jawaban: ${aman(JSON.stringify(ditolak.data ?? errText(ditolak.error)), 60)}`
  );

  await admin.from("bookings").delete().eq("id", bookingAktif);
  const pertama = await c.pelanggan.rpc("request_account_deletion", { p_alasan: "probe bersih" });
  const idPertama = pertama.data?.permintaan ?? null;
  if (idPertama) permintaanIds.push(idPertama);
  await buangAntrean(idPertama);
  cek(
    "permintaan bersih diterima → status diminta",
    pertama.data?.ok === true && pertama.data?.status === "diminta",
    `id: ${aman(idPertama, 8)}`
  );

  const ulang = await c.pelanggan.rpc("request_account_deletion", { p_alasan: "lagi" });
  await buangAntrean(idPertama);
  cek(
    "permintaan kedua idempoten (tidak menumpuk)",
    ulang.data?.ok === true && ulang.data?.sudah_diminta === true && ulang.data?.permintaan === idPertama
  );

  const status = await c.pelanggan.rpc("my_account_deletion");
  cek(
    "my_account_deletion melaporkan status & tidak ada penghalang",
    status.data?.ok === true && status.data?.status === "diminta" && status.data?.blokir === null,
    `status: ${aman(status.data?.status)}`
  );

  const saldoDitolak = await c.teknisi.rpc("request_account_deletion", {});
  cek(
    "teknisi bersaldo ≠ 0 ditolak",
    saldoDitolak.data?.ok === false && saldoDitolak.data?.error === "saldo_belum_nol",
    `jawaban: ${aman(saldoDitolak.data?.error)}`
  );

  const adminDitolak = await c.admin.rpc("request_account_deletion", {});
  cek(
    "akun admin tidak bisa menghapus dirinya lewat jalur ini",
    adminDitolak.data?.ok === false && adminDitolak.data?.error === "akun_admin"
  );

  // ---------------------------------------------------------------------------
  langkah("D. Izin: RLS, bukan-admin, anon");
  // ---------------------------------------------------------------------------
  const lihatOrangLain = await c.web.from("account_deletion_requests").select("id");
  cek(
    "pengguna lain tidak bisa melihat permintaan orang lain",
    (lihatOrangLain.data ?? []).length === 0 && !lihatOrangLain.error,
    `baris terbaca: ${(lihatOrangLain.data ?? []).length}`
  );

  const tulisLangsung = await c.web
    .from("account_deletion_requests")
    .insert({ user_id: pelangganWeb.id, email: pelangganWeb.email, sumber: "aplikasi", status: "diminta" })
    .select("id");
  cek(
    "klien tidak bisa menulis permintaan langsung (hanya lewat RPC)",
    Boolean(tulisLangsung.error),
    `galat: ${aman(errText(tulisLangsung.error), 40)}`
  );

  // Penolakan sah datang dari dua pintu, tergantung izin EXECUTE-nya:
  //   (a) izin dicabut → PostgREST menolak sebelum fungsinya jalan, atau
  //   (b) fungsi jalan lalu penjaganya menjawab 'bukan_admin'.
  // Assertion-nya sengaja tidak mengunci salah satu mekanisme (itu terlalu
  // sempit: setelah bagian 8 migrasi mencabut EXECUTE dari PUBLIC, yang terjadi
  // adalah (a)). Yang WAJIB benar dan tetap diuji: klien biasa tidak boleh
  // berhasil — kalau berhasil, dua-duanya salah dan uji ini merah.
  const bukanAdmin = await c.web.rpc("eksekusi_hapus_akun", { p_request: idPertama });
  const ditolakIzin = /permission denied/i.test(errText(bukanAdmin.error));
  const ditolakPenjaga = bukanAdmin.data?.ok === false && bukanAdmin.data?.error === "bukan_admin";
  cek(
    "bukan admin tidak bisa mengeksekusi penghapusan",
    ditolakIzin || ditolakPenjaga,
    `lewat: ${
      ditolakIzin
        ? "izin EXECUTE dicabut"
        : ditolakPenjaga
          ? "penjaga bukan_admin"
          : aman(errText(bukanAdmin.error) || JSON.stringify(bukanAdmin.data), 40)
    }`
  );

  const anonCoba = await anon.rpc("eksekusi_hapus_akun", { p_request: idPertama });
  cek("anon tidak punya izin mengeksekusi", Boolean(anonCoba.error), `galat: ${aman(errText(anonCoba.error), 40)}`);

  const anonMinta = await anon.rpc("request_account_deletion", {});
  cek("anon tidak punya izin meminta", Boolean(anonMinta.error), `galat: ${aman(errText(anonMinta.error), 40)}`);

  // ---------------------------------------------------------------------------
  langkah("E. Jalur web: token, sekali pakai, jeda, anti-enumerasi");
  // ---------------------------------------------------------------------------
  /** Pengirim surel tiruan: menangkap tautan, tidak mengirim apa pun. */
  const tangkap = () => {
    const kotak = { tautan: null, panggilan: 0 };
    const kirimEmail = async (o) => {
      kotak.panggilan++;
      if (o.actionLink) kotak.tautan = o.actionLink;
      return { simulated: false, id: "probe-bukan-email" };
    };
    return { kotak, kirimEmail };
  };

  lupakanRiwayatJeda();
  const web = tangkap();
  const mintaWeb = await mintaHapusAkunWeb({
    email: pelangganWeb.email,
    alasan: "probe jalur web",
    siteUrl: "https://probe.invalid",
    admin,
    kirimEmail: web.kirimEmail,
  });
  if (mintaWeb.id) permintaanIds.push(mintaWeb.id);
  await buangAntrean(mintaWeb.id);
  cek(
    "permintaan web tersimpan & tautan konfirmasi terkirim",
    mintaWeb.ok === true && mintaWeb.terkirim === true && Boolean(web.kotak.tautan),
    `id: ${aman(mintaWeb.id, 8)}`
  );

  const tautan = web.kotak.tautan ? new URL(web.kotak.tautan) : null;
  const token = tautan?.searchParams.get("token") ?? null;
  cek("tautan berbentuk /hapus-akun/konfirmasi dengan id & token", Boolean(token && tautan.pathname === "/hapus-akun/konfirmasi"));

  const { data: barisWeb } = await admin
    .from("account_deletion_requests")
    .select("status, kode_hash, kode_expires_at")
    .eq("id", mintaWeb.id)
    .maybeSingle();
  cek(
    "token disimpan sebagai HASH (bukan teks terbuka) dan berlaku terbatas",
    barisWeb?.status === "menunggu_konfirmasi" &&
      barisWeb?.kode_hash === hashToken(token) &&
      barisWeb?.kode_hash !== token &&
      Boolean(barisWeb?.kode_expires_at),
    `hash cocok: ${barisWeb?.kode_hash === hashToken(token)}`
  );

  const tokenSalah = await periksaTautanKonfirmasi({ id: mintaWeb.id, token: "0".repeat(64), admin });
  cek("token yang salah ditolak", tokenSalah.ok === false, `alasan: ${aman(tokenSalah.alasan)}`);

  const konfirmasi = await konfirmasiHapusAkun({ id: mintaWeb.id, token, admin });
  await buangAntrean(mintaWeb.id);
  cek("konfirmasi dengan token benar → status diminta", konfirmasi.ok === true, `alasan: ${aman(konfirmasi.alasan)}`);

  const { data: sesudahKonfirmasi } = await admin
    .from("account_deletion_requests")
    .select("status, kode_hash")
    .eq("id", mintaWeb.id)
    .maybeSingle();
  cek(
    "token sekali pakai (hash dimatikan) & status akhir diminta",
    sesudahKonfirmasi?.status === "diminta" && sesudahKonfirmasi?.kode_hash === null
  );

  const konfirmasiUlang = await konfirmasiHapusAkun({ id: mintaWeb.id, token, admin });
  cek("konfirmasi kedua tidak mengubah apa pun (sudah)", konfirmasiUlang.ok === true && konfirmasiUlang.sudah === true);

  const jeda = await mintaHapusAkunWeb({
    email: pelangganWeb.email,
    siteUrl: "https://probe.invalid",
    admin,
    kirimEmail: web.kirimEmail,
  });
  cek("permintaan web kedua untuk alamat sama langsung dibatasi (jeda)", jeda.alasan === "jeda", `alasan: ${aman(jeda.alasan)}`);

  // Alamat tanpa akun: jawaban ke pemanggil harus SAMA seperti alamat terdaftar
  // (anti-enumerasi), tetapi tetap membuat baris menunggu konfirmasi.
  lupakanRiwayatJeda();
  const tanpaAkun = tangkap();
  const emailAsing = `tidak-ada-${Date.now()}@example.invalid`;
  const mintaAsing = await mintaHapusAkunWeb({
    email: emailAsing,
    siteUrl: "https://probe.invalid",
    admin,
    kirimEmail: tanpaAkun.kirimEmail,
  });
  if (mintaAsing.id) permintaanIds.push(mintaAsing.id);
  cek(
    "surel tanpa akun dijawab sama (anti-enumerasi) & konfirmasi tetap dibuat",
    mintaAsing.ok === true && mintaAsing.terkirim === true && Boolean(tanpaAkun.kotak.tautan),
    `id: ${aman(mintaAsing.id, 8)}`
  );

  const { data: barisAsing } = await admin
    .from("account_deletion_requests")
    .select("user_id")
    .eq("id", mintaAsing.id)
    .maybeSingle();
  cek("baris surel tanpa akun tidak dikaitkan ke pengguna mana pun", barisAsing?.user_id === null);

  const tokenAsing = new URL(tanpaAkun.kotak.tautan).searchParams.get("token");
  const konfirmasiAsing = await konfirmasiHapusAkun({ id: mintaAsing.id, token: tokenAsing, admin });
  await buangAntrean(mintaAsing.id);
  cek("konfirmasi surel tanpa akun tetap diterima", konfirmasiAsing.ok === true);

  // ---------------------------------------------------------------------------
  langkah("F. Eksekusi: anonimkan, sisakan catatan, cabut akses");
  // ---------------------------------------------------------------------------
  // Konten pribadi yang harus HILANG, dan satu pesanan selesai yang harus TETAP.
  const bookingTetap = await buatBooking(pelangganWeb.id, "completed", "CATATAN-PRIBADI-PROBE");
  await admin.from("chat_messages").insert({
    booking_id: bookingTetap,
    sender_id: pelangganWeb.id,
    body: "pesan pribadi probe",
  });
  await admin.from("fcm_tokens").insert({ user_id: pelangganWeb.id, token: `probe-${Date.now()}` });
  await admin
    .from("profiles")
    .update({ phone: "0812000000", address: "Jl. Pribadi 9", avatar_url: "avatar-probe.jpg" })
    .eq("id", pelangganWeb.id);

  const jalankan = await eksekusiHapusAkun({
    requestId: mintaWeb.id,
    admin,
    catatan: "dijalankan probe",
    kirimEmail: async () => ({ simulated: true }), // jangan kirim surel sungguhan
  });
  cek("eksekusi berhasil", jalankan.ok === true, `galat: ${aman(jalankan.error ?? jalankan.galatAkses)}`);
  cek("akses masuk dicabut (tombstone + banned)", jalankan.aksesDicabut === true, `galat: ${aman(jalankan.galatAkses)}`);

  const { data: profilBaru } = await admin
    .from("profiles")
    .select("name, email, phone, address, avatar_url, ktp_url")
    .eq("id", pelangganWeb.id)
    .maybeSingle();
  cek(
    "profil dianonimkan (nama & kontak pribadi hilang)",
    profilBaru?.name === "Pengguna dihapus" &&
      profilBaru?.phone === null &&
      profilBaru?.address === null &&
      profilBaru?.avatar_url === null &&
      profilBaru?.ktp_url === null,
    `nama: ${aman(profilBaru?.name)}`
  );
  cek(
    "surel profil diganti tombstone yang tidak bisa menerima surat",
    String(profilBaru?.email ?? "").startsWith("dihapus+") && String(profilBaru?.email ?? "").endsWith("@fixify.invalid"),
    `pola: ${aman(maskEmail(profilBaru?.email))}`
  );

  const { data: pesananTetap } = await admin
    .from("bookings")
    .select("id, notes, address, status")
    .eq("id", bookingTetap)
    .maybeSingle();
  cek(
    "riwayat pesanan TETAP ada (catatan audit) tetapi isi pribadinya dibuang",
    pesananTetap?.id === bookingTetap &&
      pesananTetap?.notes === null &&
      String(pesananTetap?.address ?? "").includes("dihapus"),
    `status: ${aman(pesananTetap?.status)}`
  );

  const { count: chatSisa } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", pelangganWeb.id);
  const { count: fcmSisa } = await admin
    .from("fcm_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", pelangganWeb.id);
  cek("percakapan pribadi & token push dihapus", chatSisa === 0 && fcmSisa === 0, `chat=${chatSisa} fcm=${fcmSisa}`);

  const { data: permintaanSelesai } = await admin
    .from("account_deletion_requests")
    .select("status, decided_at")
    .eq("id", mintaWeb.id)
    .maybeSingle();
  cek(
    "permintaan ditutup sebagai selesai beserta waktunya",
    permintaanSelesai?.status === "selesai" && Boolean(permintaanSelesai?.decided_at)
  );

  // Bukti paling penting: kata sandi lama TIDAK bisa dipakai lagi.
  const cobaMasuk = makeAnonClient(env);
  const masuk = await cobaMasuk.auth.signInWithPassword({
    email: pelangganWeb.email,
    password: pelangganWeb.password,
  });
  cek(
    "pengguna tidak bisa masuk lagi dengan kredensial lamanya",
    Boolean(masuk.error),
    `galat: ${aman(errText(masuk.error), 40)}`
  );

  const { data: authUser } = await admin.auth.admin.getUserById(pelangganWeb.id);
  cek(
    "surel di auth.users sudah tombstone",
    String(authUser?.user?.email ?? "").startsWith("dihapus+"),
    `pola: ${aman(maskEmail(authUser?.user?.email))}`
  );

  // Permintaan web untuk surel without akun: ditutup tanpa perubahan data.
  const jalankanAsing = await eksekusiHapusAkun({
    requestId: mintaAsing.id,
    admin,
    catatan: "probe tanpa akun",
    kirimEmail: async () => ({ simulated: true }),
  });
  cek(
    "eksekusi permintaan tanpa akun ditutup sebagai 'tiada akun'",
    jalankanAsing.ok === true && jalankanAsing.tiadaAkun === true
  );

  // Eksekusi ulang permintaan yang sudah selesai harus ditolak (bukan dijalankan dua kali).
  const dobel = await eksekusiHapusAkun({
    requestId: mintaWeb.id,
    admin,
    kirimEmail: async () => ({ simulated: true }),
  });
  cek(
    "permintaan yang sudah selesai tidak bisa dieksekusi lagi",
    dobel.ok === false && dobel.error === "status_bukan_diminta",
    `galat: ${aman(dobel.error)}`
  );

  // ---------------------------------------------------------------------------
  langkah("C. Pengguna bisa membatalkan permintaannya");
  // ---------------------------------------------------------------------------
  const batal = await c.pelanggan.rpc("cancel_account_deletion");
  cek("pembatalan diterima", batal.data?.ok === true, `jawaban: ${aman(JSON.stringify(batal.data))}`);

  const setelahBatal = await c.pelanggan.rpc("my_account_deletion");
  cek(
    "status berubah jadi dibatalkan",
    setelahBatal.data?.status === "dibatalkan",
    `status: ${aman(setelahBatal.data?.status)}`
  );

  // ---------------------------------------------------------------------------
  langkah("G. Helper murni (tanpa DB)");
  // ---------------------------------------------------------------------------
  cek(
    "pathBerkas mengambil jalur di dalam bucket, menolak URL host lain",
    pathBerkas("https://x.supabase.co/storage/v1/object/public/profile-media/a/b.jpg", "profile-media") === "a/b.jpg" &&
      pathBerkas("pendaftaran/ktp-1.jpg", "ktp-documents") === "pendaftaran/ktp-1.jpg" &&
      pathBerkas("https://contoh.id/luar.jpg", "ktp-documents") === null
  );
  cek("maskEmail menyamarkan bagian lokal", maskEmail("budi@gmail.com") === "bu••@gmail.com", maskEmail("budi@gmail.com"));

  // ---------------------------------------------------------------------------
  langkah("Pembersihan");
  // ---------------------------------------------------------------------------
  const laporan = await deleteTempUsers(admin, pembersihAkun);
  const gagalHapus = laporan.filter((r) => !r.ok);
  cek(
    `akun uji dihapus (${laporan.length - gagalHapus.length}/${laporan.length})`,
    gagalHapus.length === 0,
    gagalHapus.map((r) => `${r.label}: ${aman(r.error, 30)}`).join(" ")
  );

  if (bookingIds.length) {
    await admin.from("bookings").delete().in("id", bookingIds);
    await admin.from("admin_email_outbox").delete().in("ref_id", bookingIds);
  }
  if (permintaanIds.length) {
    // Baris permintaan tidak punya FK ke profiles → tidak ikut cascade.
    await admin.from("admin_email_outbox").delete().in("ref_id", permintaanIds);
    await admin.from("account_deletion_requests").delete().in("id", permintaanIds);
  }
  await admin.from("admin_email_outbox").delete().eq("event", "account_deletion");

  const { count: sisaPermintaan } = await admin
    .from("account_deletion_requests")
    .select("id", { count: "exact", head: true })
    .in("id", permintaanIds.length ? permintaanIds : ["00000000-0000-0000-0000-000000000000"]);
  cek("tidak ada sisa baris permintaan uji", sisaPermintaan === 0, `sisa: ${sisaPermintaan}`);

  return gagal === 0 ? 0 : 1;
}

/**
 * Kode blokir yang BENAR-BENAR bisa dikembalikan `hapus_akun_blokir`, dibaca dari
 * berkas migrasinya sendiri. Dipakai supaya kalimat di panel/halaman tidak bisa
 * ketinggalan saat aturan penjaganya bertambah: kode baru tanpa kalimat akan
 * tampil sebagai "alasan teknis" di mata pengguna.
 */
function kodeBlokirDariSql() {
  const sql = readFileSync(new URL("../supabase/migrate-account-deletion.sql", import.meta.url), "utf8");
  const kode = new Set();
  for (const m of sql.matchAll(/return\s+'([a-z_]+)'\s*;/g)) kode.add(m[1]);
  return [...kode];
}

// ---------------------------------------------------------------------------
// Mode OFFLINE (--selftest): menguji aturan jalur WEB tanpa database sama sekali,
// memakai klien tiruan. Gunanya: aturan ini harus sudah benar SEBELUM migrasi
// dijalankan, dan tetap bisa diuji di mesin tanpa kredensial (mis. CI lint).
// Yang tidak dibuktikan di sini: SQL, RLS, dan pencabutan akses — itu wilayah
// probe live di atas.
// ---------------------------------------------------------------------------
async function selftest() {
  const { fakeAdmin } = await import("./lib/fake-supabase.mjs");
  let salah = 0;
  let n = 0;
  const t = (label, ok, detail = "") => {
    n++;
    if (!ok) salah++;
    console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const kiriman = () => {
    const kotak = { tautan: null, panggilan: 0, terakhir: null };
    const kirimEmail = async (o) => {
      kotak.panggilan++;
      kotak.terakhir = o;
      if (o.actionLink) kotak.tautan = o.actionLink;
      return { simulated: false, id: "selftest" };
    };
    return { kotak, kirimEmail };
  };
  // Aman terhadap tautan null: kasus yang gagal harus DILAPORKAN, bukan bikin
  // skrip ini berhenti dengan TypeError.
  const tokenDari = (tautan) => {
    try {
      return new URL(String(tautan)).searchParams.get("token");
    } catch {
      return null;
    }
  };

  console.log("Aturan jalur hapus akun (offline, tanpa database)");
  console.log("=".repeat(72));

  // 1. Bentuk surel salah ditolak sebelum menyentuh database.
  const kosong = fakeAdmin({});
  const bentukSalah = await mintaHapusAkunWeb({ email: "bukan-email", admin: kosong, kirimEmail: kiriman().kirimEmail });
  t("surel tak valid ditolak tanpa menyentuh DB", bentukSalah.alasan === "email_tidak_valid" && kosong.state.log.length === 0);

  // 2. Permintaan normal: hash, kedaluwarsa, dan tautan yang benar.
  lupakanRiwayatJeda();
  const klien1 = fakeAdmin({ profil: { id: "u1", role: "customer" } });
  const kirim1 = kiriman();
  const minta1 = await mintaHapusAkunWeb({
    email: "  Budi@Example.COM ",
    alasan: "  tidak dipakai  ",
    siteUrl: "https://fixify.test",
    admin: klien1,
    kirimEmail: kirim1.kirimEmail,
  });
  const baris1 = klien1.state.rows[0];
  const token1 = tokenDari(kirim1.kotak.tautan);
  t("permintaan web diterima & tersimpan menunggu konfirmasi", minta1.ok === true && baris1?.status === "menunggu_konfirmasi");
  t("surel dinormalisasi (huruf kecil, spasi tepi dibuang)", baris1?.email === "budi@example.com", aman(baris1?.email, 30));
  t("alasan opsional dirapikan", baris1?.alasan === "tidak dipakai");
  t("token disimpan sebagai hash, bukan teks terbuka", baris1?.kode_hash === hashToken(token1) && baris1?.kode_hash !== token1);
  t("tautan berlaku terbatas (kedaluwarsa dicatat)", Number.isFinite(Date.parse(baris1?.kode_expires_at)));
  t("tautan menunjuk halaman konfirmasi", String(kirim1.kotak.tautan).startsWith("https://fixify.test/hapus-akun/konfirmasi?"));

  // 3. Jeda per alamat: berlaku untuk alamat yang sama, tanpa bocoran hasil.
  const mintaJeda = await mintaHapusAkunWeb({ email: "budi@example.com", siteUrl: "https://fixify.test", admin: klien1, kirimEmail: kirim1.kirimEmail });
  t("permintaan ulang dalam 1 menit dibatasi (jeda)", mintaJeda.alasan === "jeda" && Number(mintaJeda.sisaDetik) > 0);

  // 4. Setelah jeda dilewati: tautan lama dibuang, satu tautan hidup per alamat.
  lupakanRiwayatJeda();
  const kirim2 = kiriman();
  const minta2 = await mintaHapusAkunWeb({ email: "budi@example.com", siteUrl: "https://fixify.test", admin: klien1, kirimEmail: kirim2.kirimEmail });
  t(
    "permintaan baru menggantikan tautan lama (tidak menumpuk)",
    minta2.ok === true && klien1.state.rows.length === 1 && klien1.state.dihapus.length === 1,
    `baris=${klien1.state.rows.length} dibuang=${klien1.state.dihapus.length}`
  );

  // 5. Token salah / tidak lengkap tidak boleh lolos.
  const token2 = tokenDari(kirim2.kotak.tautan);
  const id2 = minta2.id;
  t("token salah ditolak", (await periksaTautanKonfirmasi({ id: id2, token: "a".repeat(64), admin: klien1 })).ok === false);
  t("tautan tanpa token ditolak", (await periksaTautanKonfirmasi({ id: id2, admin: klien1 })).ok === false);
  t(
    "token kedaluwarsa ditolak",
    tokenSah({ token: token2, hash: hashToken(token2), expiresAt: new Date(Date.now() - 1000).toISOString() }) === false
  );

  // 6. Konfirmasi: sekali pakai, dan menyimpan waktu konfirmasi.
  const konfirmasi1 = await konfirmasiHapusAkun({ id: id2, token: token2, admin: klien1 });
  const baris2 = klien1.state.rows[0];
  t("konfirmasi token benar → status diminta", konfirmasi1.ok === true && baris2.status === "diminta");
  t("hash token dimatikan setelah dipakai", baris2.kode_hash === null && baris2.kode_expires_at === null);
  t("waktu konfirmasi dicatat", Boolean(baris2.confirmed_at));
  const konfirmasi2 = await konfirmasiHapusAkun({ id: id2, token: token2, admin: klien1 });
  t("konfirmasi kedua tidak mengubah apa pun", konfirmasi2.ok === true && konfirmasi2.sudah === true && klien1.state.rows[0].status === "diminta");

  // 7. Penjaga DB dihormati di jalur web: permintaan ditutup sebagai ditolak.
  lupakanRiwayatJeda();
  const klienBlokir = fakeAdmin({ profil: { id: "u2", role: "technician" }, blokir: "saldo_belum_nol" });
  const kirimBlokir = kiriman();
  const mintaBlokir = await mintaHapusAkunWeb({ email: "teknisi@example.com", siteUrl: "https://fixify.test", admin: klienBlokir, kirimEmail: kirimBlokir.kirimEmail });
  const konfirmasiBlokir = await konfirmasiHapusAkun({ id: mintaBlokir.id, token: tokenDari(kirimBlokir.kotak.tautan), admin: klienBlokir });
  t("penjaga server menolak & menutup permintaan beserta alasannya", konfirmasiBlokir.alasan === "saldo_belum_nol" && klienBlokir.state.rows[0].status === "ditolak");

  // 8. Anti-enumerasi: surel tanpa akun dijawab sama, tetap boleh dikonfirmasi.
  lupakanRiwayatJeda();
  const klienAsing = fakeAdmin({ profil: null });
  const kirimAsing = kiriman();
  const mintaAsing = await mintaHapusAkunWeb({ email: "tidak-ada@example.com", siteUrl: "https://fixify.test", admin: klienAsing, kirimEmail: kirimAsing.kirimEmail });
  t("surel tanpa akun dijawab sama seperti yang punya akun", mintaAsing.ok === true && mintaAsing.terkirim === true);
  t("baris tanpa akun tidak dikaitkan ke pengguna", klienAsing.state.rows[0]?.user_id === null);

  // 9. Pengguna sudah punya permintaan berjalan → pengingat, bukan permintaan kedua.
  lupakanRiwayatJeda();
  const klienTerbuka = fakeAdmin({
    profil: { id: "u3", role: "customer" },
    rows: [{ id: "req-lama", user_id: "u3", email: "sudah@example.com", status: "diminta" }],
  });
  const kirimTerbuka = kiriman();
  const mintaTerbuka = await mintaHapusAkunWeb({ email: "sudah@example.com", siteUrl: "https://fixify.test", admin: klienTerbuka, kirimEmail: kirimTerbuka.kirimEmail });
  t(
    "permintaan yang sudah berjalan cukup diingatkan, tidak dibuat dua kali",
    mintaTerbuka.ok === true && mintaTerbuka.sudahAda === true && klienTerbuka.state.rows.length === 1 && kirimTerbuka.kotak.terakhir?.sudahDiminta === true
  );

  // 10. Kegagalan teknis TIDAK menyamar jadi "tautan terkirim" — dan tidak
  //     meninggalkan permintaan yatim.
  lupakanRiwayatJeda();
  const klienSim = fakeAdmin({ profil: { id: "u4", role: "customer" } });
  const mintaSim = await mintaHapusAkunWeb({
    email: "sim@example.com",
    siteUrl: "https://fixify.test",
    admin: klienSim,
    kirimEmail: async () => ({ simulated: true }),
  });
  t("layanan surel belum siap → dilaporkan, bukan diklaim terkirim", mintaSim.alasan === "env" && klienSim.state.rows.length === 0);

  lupakanRiwayatJeda();
  const klienErr = fakeAdmin({ profil: { id: "u5", role: "customer" } });
  const mintaErr = await mintaHapusAkunWeb({
    email: "err@example.com",
    siteUrl: "https://fixify.test",
    admin: klienErr,
    kirimEmail: async () => ({ simulated: false, error: "domain belum terverifikasi" }),
  });
  t("kirim gagal → dilaporkan & barisnya dibatalkan", mintaErr.alasan === "gagal_kirim" && klienErr.state.rows.length === 0);

  // 11. Helper murni.
  t("hashToken deterministik & 64 heksadesimal", hashToken("abc") === hashToken("abc") && /^[0-9a-f]{64}$/.test(hashToken("abc")));
  t(
    "tokenSah menolak hash kosong/token kosong",
    tokenSah({ token: "", hash: hashToken("") }) === false && tokenSah({ token: "x", hash: null }) === false
  );
  t("pathBerkas menolak URL host lain", pathBerkas("https://luar.id/a.jpg", "ktp-documents") === null);
  t("maskEmail menyamarkan bagian lokal", maskEmail("budi@gmail.com") === "bu••@gmail.com", maskEmail("budi@gmail.com"));
  t("JANJI_HARI terisi (dipakai halaman & surel)", Number.isFinite(JANJI_HARI) && JANJI_HARI > 0, String(JANJI_HARI));

  // 12. Aturan yang dipakai PANEL ADMIN (pengganti alat terminal).
  //     Yang dijaga: tidak ada keadaan di mana panel menampilkan tombol "jalan"
  //     untuk permintaan yang tidak boleh dijalankan, dan tidak ada kode blokir
  //     dari SQL yang muncul tanpa kalimat untuk dibaca admin.
  const kodeSql = kodeBlokirDariSql();
  t("kode blokir terbaca dari berkas migrasi", kodeSql.length >= 5, `${kodeSql.length} kode`);
  t(
    "setiap kode blokir di SQL punya kalimat untuk manusia",
    kodeSql.every((k) => typeof PESAN_BLOKIR[k] === "string" && PESAN_BLOKIR[k].length > 10),
    kodeSql.filter((k) => !PESAN_BLOKIR[k]).join(", ") || "lengkap"
  );
  t(
    "tak ada kalimat menggantung (kunci yang tak pernah dipakai SQL/panel)",
    Object.keys(PESAN_BLOKIR).every((k) => KODE_BLOKIR_INTERNAL.includes(k) || kodeSql.includes(k)),
    Object.keys(PESAN_BLOKIR).filter((k) => !KODE_BLOKIR_INTERNAL.includes(k) && !kodeSql.includes(k)).join(", ") ||
      "bersih"
  );
  t(
    "pesanBlokir(null) null & kode asing tetap dijelaskan",
    pesanBlokir(null) === null && /entah_apa/.test(pesanBlokir("entah_apa"))
  );
  const siap = ringkasKelayakan({ status: "diminta" });
  t("permintaan 'diminta' tanpa blokir → boleh dijalankan", siap.boleh === true && siap.peringatan === null);
  t(
    "status selain 'diminta' TIDAK menampilkan tombol jalan",
    ringkasKelayakan({ status: "selesai" }).boleh === false &&
      ringkasKelayakan({ status: "menunggu_konfirmasi" }).boleh === false &&
      ringkasKelayakan({}).boleh === false
  );
  t(
    "blokir yang muncul belakangan tetap boleh dijalankan TAPI diberi peringatan",
    kodeSql.every((k) => {
      const k2 = ringkasKelayakan({ status: "diminta", blokir: k });
      return k2.boleh === true && k2.kode === k && typeof k2.peringatan === "string" && k2.peringatan.length > 10;
    })
  );
  t(
    "rencana menyebut apa yang dihapus dan apa yang disimpan",
    RENCANA_HAPUS.dihapus.length > 0 &&
      RENCANA_HAPUS.disimpan.length > 0 &&
      [...RENCANA_HAPUS.dihapus, ...RENCANA_HAPUS.disimpan].every((s) => typeof s === "string" && s.length > 5)
  );
  // Akses yang gagal dicabut = data sudah dianonimkan tapi akun masih bisa masuk.
  // Panel WAJIB menandainya bahaya; diuji di sini supaya tidak bisa dilunakkan
  // jadi "sukses sebagian" tanpa membuat uji ini merah.
  t("ringkasan: bukan admin ditolak", ringkasEksekusi({ ok: false, error: "bukan_admin" }).tingkat === "gagal");
  t("ringkasan: gagal eksekusi dilaporkan sebagai gagal", ringkasEksekusi({ ok: false, error: "x" }).tingkat === "gagal");
  t("ringkasan: tanpa akun = info, bukan sukses", ringkasEksekusi({ ok: true, tiadaAkun: true }).tingkat === "info");
  const bahaya = ringkasEksekusi({ ok: true, aksesDicabut: false, galatAkses: "boom" });
  t(
    "ringkasan: akses TIDAK dicabut = bahaya & menyebut tindakan perbaikannya",
    bahaya.tingkat === "bahaya" && /ban/i.test(bahaya.pesan),
    bahaya.tingkat
  );
  t(
    "ringkasan: sukses hanya bila akses benar-benar dicabut",
    ringkasEksekusi({ ok: true, aksesDicabut: true }).tingkat === "sukses"
  );

  console.log("=".repeat(72));
  if (salah === 0) {
    console.log(`LULUS: selftest ${n}/${n} — aturan jalur web benar tanpa database.`);
    return 0;
  }
  console.log(`GAGAL: ${salah} dari ${n} pemeriksaan tidak sesuai harapan.`);
  return 1;
}

if (process.argv.includes("--selftest")) {
  process.exit(await selftest());
}

let kode = 3;
try {
  kode = await main();
} catch (err) {
  if (err?.code === "NO_CREDENTIALS") {
    console.error(`⏭️  ${err.message}`);
    console.error("Probe ini butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local atau env proses).");
    kode = 3;
  } else {
    console.error(`\n💥 Probe berhenti karena galat tak terduga: ${err?.message}`);
    kode = 1;
  }
}

console.log("\n" + "=".repeat(72));
if (kode === 0) console.log(`LULUS: ${diperiksa} pemeriksaan hijau — jalur hapus akun berjalan di server.`);
else if (kode === 2) console.log("MIGRASI_BELUM_JALAN: jalankan supabase/migrate-account-deletion.sql lalu ulangi.");
else if (kode === 3) console.log("TANPA_KREDENSIAL: tidak ada yang diperiksa.");
else console.log(`GAGAL: ${gagal} dari ${diperiksa} pemeriksaan tidak sesuai harapan.`);
process.exit(kode);
