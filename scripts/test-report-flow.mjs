// Uji alur laporan end-to-end (sejauh yang bisa diuji tanpa sesi admin).
// Urutan:
//  1. Cek apakah tabel `reports` sudah ada (migrasi dijalankan?)
//  2. Login sebagai akun uji pelanggan (dibuat sebelumnya), lalu:
//     - insert laporan uji via RLS (sebagai user itu sendiri)
//     - baca kembali laporan miliknya (jalur getMyReports)
//  3. Coba insert laporan sebagai anon (harus DITOLAK RLS -> positif)
//  4. Baca laporan sebagai anon (harus DITOLAK RLS -> positif)
//  5. Simulasi render email admin & email resolved (modul email tanpa RESEND_API_KEY
//     hanya mencetak ke log server) — dipanggil langsung via node, bukan server action,
//     supaya tidak butuh cookie sesi.
// Tidak pernah mencetak nilai rahasia — hanya nama kunci env dan hasil sukses/gagal.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// --- muat .env.local secara manual ---
const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY tidak ditemukan di .env.local");
  process.exit(1);
}

const stamp = Date.now().toString(36);
const TEST_EMAIL = env.TEST_USER_EMAIL || `uji-lapor-${stamp}@gmail.com`;
const TEST_PASS = env.TEST_USER_PASSWORD || "UjiLapor2026!";

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// ---------- 1. tabel reports ada? ----------
section("1. Cek tabel reports (anon)");
const anonClient = createClient(url, anon);
{
  const { error } = await anonClient.from("reports").select("id").limit(1);
  if (error) {
    const missing = /relation|does not exist|schema/i.test(error.message);
    console.log(missing ? `TABEL BELUM ADA — jalankan supabase/migrate-reports.sql dulu. (${error.message})` : `Query error: ${error.message}`);
    if (missing) process.exit(2);
  } else {
    console.log("Tabel reports ADA dan bisa di-query (RLS aktif menentukan baris yang terlihat).");
  }
}

// ---------- 2. siapkan akun uji (pakai yang sudah ada bila memungkinkan) ----------
section("2. Akun uji pelanggan");
let userClient = null;
{
  userClient = createClient(url, anon);
  let signIn = await userClient.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASS });

  if (signIn.error) {
    console.log(`Login gagal (${signIn.error.message}) — coba buat akun baru...`);
    const stamp2 = Date.now().toString(36);
    const email = `uji-lapor-${stamp2}@gmail.com`;
    const signUp = await userClient.auth.signUp({
      email,
      password: TEST_PASS,
      options: { data: { name: "Pelanggan Uji Laporan" } },
    });
    if (signUp.error) {
      console.log(`Signup gagal: ${signUp.error.message}`);
      process.exit(3);
    }
    console.log(`Akun baru dibuat: ${email}`);
    // profil terbentuk via trigger; coba login (bisa gagal jika confirm email aktif)
    signIn = await userClient.auth.signInWithPassword({ email, password: TEST_PASS });
    if (signIn.error) {
      console.log(`Login akun baru gagal: ${signIn.error.message}`);
      console.log("-> Fitur 'Confirm email' aktif di proyek Supabase. Confirm user ini di dashboard, lalu set TEST_USER_EMAIL & TEST_USER_PASSWORD di .env.local dan jalankan ulang script.");
      process.exit(4);
    }
  } else {
    console.log(`Login sukses sebagai ${TEST_EMAIL}`);
  }

  const { data: sessionUser } = await userClient.auth.getUser();
  console.log(`Session OK untuk user id: ${sessionUser?.user?.id?.slice(0, 8)}...`);
}

// ---------- 3. insert laporan sebagai user ----------
section("3. Insert laporan uji (sebagai pelanggan)");
let reportId = null;
{
  const { data, error } = await userClient
    .from("reports")
    .insert({
      author_role: "customer",
      title: `Laporan uji alur ${stamp}`,
      content: "Ini laporan uji end-to-end. Jika Anda melihat ini di panel admin, alur insert via RLS bekerja.",
    })
    .select("id, title, status")
    .single();

  if (error) {
    console.log(`INSERT GAGAL: ${error.message}`);
    process.exit(5);
  }
  reportId = data.id;
  console.log(`Insert OK — id: ${data.id.slice(0, 8)}... | status awal: ${data.status}`);
}

// ---------- 4. baca kembali laporan (jalur getMyReports) ----------
section("4. Baca laporan milik sendiri");
{
  const { data, error } = await userClient
    .from("reports")
    .select("id, title, status, admin_note, bookings(code)")
    .eq("author_id", (await userClient.auth.getUser()).data.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.log(`SELECT milik sendiri GAGAL: ${error.message}`);
  } else {
    const found = data.find((r) => r.id === reportId);
    console.log(`SELECT OK — total laporan terlihat: ${data.length}; laporan uji ditemukan: ${found ? "YA" : "TIDAK"}`);
  }
}

// ---------- 5. anon tidak boleh menulis/membaca laporan ----------
section("5. Guard RLS dari anon (harus gagal)");
{
  const ins = await anonClient
    .from("reports")
    .insert({ author_role: "customer", title: "x", content: "y" });
  console.log(ins.error ? `Insert anon DITOLAK (benar): ${ins.error.message.slice(0, 80)}` : "Insert anon DITERIMA — PERIKSA RLS!");

  const sel = await anonClient.from("reports").select("*").limit(5);
  console.log(sel.error ? `Select anon DITOLAK (benar): ${sel.error.message.slice(0, 80)}` : `Select anon melihat ${sel.data?.length ?? 0} baris — sesuai desain, anon tidak melihat apa pun (0 = benar).`);
}

// ---------- 6. simulasi email (admin & resolved) ----------
section("6. Simulasi email (admin + resolved ke pelapor)");
{
  process.env.EMAIL_FROM = process.env.EMAIL_FROM || env.EMAIL_FROM;
  const emailMod = await import("../src/lib/email.js").catch(() => null);
  if (!emailMod) {
    console.log("Modul email tidak bisa diimpor langsung (bukan blocker — email sebenarnya diuji lewat server action).");
  } else {
    await emailMod.sendAdminNewReportEmail([env.ADMIN_EMAIL_TEST || "admin@servisin.test"], {
      author_role: "customer",
      title: `Laporan uji alur ${stamp}`,
      content: "Isi laporan uji untuk simulasi email admin.",
      author_name: "Pelanggan Uji Laporan",
      author_email: TEST_EMAIL,
      booking_code: "SV-0000",
    });
    await emailMod.sendReportResolvedEmail(env.ADMIN_EMAIL_TEST || "admin@servisin.test", {
      reporter_name: "Pelanggan Uji Laporan",
      title: `Laporan uji alur ${stamp}`,
      booking_code: "SV-0000",
      admin_note: "Sudah kami periksa dan tangani — mohon cek kembali hasilnya.",
    });
    console.log("Email simulasi tercetak di log proses ini (lihat blok [email disimulasikan] di atas).");
  }
}

// ---------- 7. ringkasan ----------
section("RINGKASAN");
console.log(`Laporan uji tersimpan di DB: id ${reportId?.slice(0, 8)}... (status open).`);
console.log("Langkah yang tersisa (butuh sesi admin di browser):");
console.log("  1. Login admin -> /admin -> tab 'Laporan Masuk' -> expand laporan uji.");
console.log("  2. Isi catatan admin (mis. 'Sudah kami periksa dan tangani').");
console.log("  3. Klik 'Selesaikan' -> email simulasi resolved tercetak di log server dev (preview-...log).");
console.log("  4. Cek log server dev untuk baris '[email disimulasikan — RESEND_API_KEY belum diisi]'.");
