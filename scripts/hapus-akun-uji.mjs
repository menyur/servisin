#!/usr/bin/env node
// ============================================================================
// hapus-akun-uji.mjs — buang AKUN UJI yang tertinggal (sasaran eksplisit saja).
//
// KENAPA ADA, padahal sudah ada `bersihkan-data-uji.mjs`
//   `bersihkan-data-uji.mjs` menyapu SEMUA akun di luar daftar simpan — berguna
//   untuk reset menyeluruh, tetapi berbahaya sebagai alat sehari-hari: satu
//   perubahan daftar simpan = akun pelanggan ikut hilang. Alat ini melakukan
//   sebaliknya: hanya menyentuh akun yang DISEBUT, satu per satu, dengan rencana
//   yang ditampilkan lebih dulu. Dipakai untuk sisa pendaftaran uji (mis. dua
//   pendaftar teknisi 16 Okt 2026 yang tidak pernah mengonfirmasi surel).
//
// PEMAKAIAN
//   node scripts/hapus-akun-uji.mjs --id=<uuid>              → RENCANA (dry-run)
//   node scripts/hapus-akun-uji.mjs --id=<uuid> --ya         → hapus
//   node scripts/hapus-akun-uji.mjs --alamat=a@b.c --ya      → cari lewat surel
//
// PENJAGA
//   * Dry-run bawaan: tanpa `--ya` tidak ada yang dihapus.
//   * Akun yang PUNYA jejak nyata (pesanan/pesanan sebagai teknisi/saldo) DITOLAK,
//     kecuali `--paksa` disebut sadar. Alasannya: akun seperti itu bukan "akun
//     uji", dan menghapusnya menghapus catatan keuangan (cascade profiles).
//   * Akun berperan admin SELALU ditolak.
//   * Surel disamarkan di keluaran; tidak ada nilai rahasia yang dicetak.
//   * Berkas Storage yang namanya memuat id pemiliknya ikut dibersihkan
//     (KTP & foto profil akun uji) — hanya setelah penghapusan akunnya berhasil.
//
// Exit: 0 selesai · 1 ada yang gagal · 3 kredensial tidak ada.
// Tidak pernah mencetak nilai rahasia.
// ============================================================================
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";
import { maskEmail } from "../src/lib/account-deletion.js";

const argv = process.argv.slice(2);
const nilaiArg = (nama) => {
  const semua = argv
    .filter((a) => a === `--${nama}` || a.startsWith(`--${nama}=`))
    .map((a) => (a.includes("=") ? a.slice(a.indexOf("=") + 1) : ""));
  return semua.length ? semua : null;
};

const IDS = nilaiArg("id") || [];
const ALAMAT = nilaiArg("alamat") || [];
const YA = argv.includes("--ya");
const PAKSA = argv.includes("--paksa");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET_BERKAS = ["ktp-documents", "profile-media"];

function gagal(pesan) {
  console.error(`❌ ${pesan}`);
  process.exit(1);
}

if (!IDS.length && !ALAMAT.length) {
  console.error("Sebutkan sasaran: --id=<uuid> (boleh berulang) atau --alamat=<email>.");
  console.error("Tanpa sasaran, alat ini tidak melakukan apa pun — dan itu disengaja.");
  process.exit(3);
}
for (const id of IDS) if (!UUID_RE.test(id)) gagal(`Bukan UUID: ${id}`);

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(`⏭️  ${err.message}`);
  console.error("Butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  process.exit(3);
}

const admin = makeAdminClient(env);

/** Cari id akun dari alamat surel (auth.users dulu, lalu profiles). */
async function cariLewatAlamat(alamat) {
  const bersih = String(alamat).trim().toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) gagal(`Gagal membaca daftar akun: ${error.message}`);
    const users = data?.users || [];
    const hit = users.find((u) => String(u.email || "").toLowerCase() === bersih);
    if (hit) return hit.id;
    if (users.length < 1000) break;
  }
  return null;
}

/** Fakta satu akun + jumlah jejak nyata yang membuatnya BUKAN akun uji. */
async function periksaAkun(id) {
  const hasil = {
    id,
    ada: false,
    auth: null,
    profil: null,
    jejak: {},
    berkas: [],
    tolak: null,
  };

  const { data: detail } = await admin.auth.admin.getUserById(id);
  hasil.auth = detail?.user ?? null;
  hasil.ada = Boolean(hasil.auth);
  if (!hasil.ada) return hasil;

  const { data: profil } = await admin
    .from("profiles")
    .select("id, name, email, role, approval_status, balance, created_at, ktp_url")
    .eq("id", id)
    .maybeSingle();
  hasil.profil = profil ?? null;

  for (const [tabel, kolom] of [
    ["bookings", "user_id"],
    ["bookings", "technician_id"],
    ["chat_messages", "sender_id"],
    ["reports", "author_id"],
    ["balance_transactions", "technician_id"],
  ]) {
    const { count } = await admin
      .from(tabel)
      .select("id", { count: "exact", head: true })
      .eq(kolom, id);
    if (count) hasil.jejak[`${tabel}.${kolom}`] = count;
  }

  // Foto KTP pendaftar teknisi TIDAK disimpan di jalur ber-id: pendaftaran
  // menyimpannya sebagai `pendaftaran/ktp-<waktu>.jpg` dan hanya MENGACU ke sana
  // dari `profiles.ktp_url` / metadata akun. Tanpa pemeriksaan ini, penghapusan
  // akun akan meninggalkan KTP nyata seseorang sebagai berkas yatim — dan akun
  // yang punya KTP jelas bukan "akun uji" (lihat penolakan di bawah).
  const ktp =
    profil?.ktp_url ||
    hasil.auth.user_metadata?.ktp_url ||
    null;
  if (ktp) hasil.ktp = String(ktp);

  // Berkas Storage yang jelas milik akun ini (jalurnya memuat id-nya).
  for (const bucket of BUCKET_BERKAS) {
    const { data: daftar } = await admin.storage.from(bucket).list("", { limit: 300 });
    for (const entri of daftar || []) {
      const anak = entri.id
        ? [{ name: entri.name }]
        : ((await admin.storage.from(bucket).list(entri.name, { limit: 300 })).data || []).map((g) => ({
            name: `${entri.name}/${g.name}`,
          }));
      for (const f of anak) {
        if (String(f.name).includes(id)) hasil.berkas.push(`${bucket}/${f.name}`);
      }
    }
  }

  if (profil?.role === "admin") hasil.tolak = "akun admin tidak pernah dibuang alat ini";
  else if (hasil.ktp && !PAKSA) {
    hasil.tolak = `punya foto KTP di Storage (${hasil.ktp}) — pendaftar nyata, bukan akun uji`;
  } else if (!profil) hasil.tolak = null; // tanpa profil: tidak ada yang perlu dijaga
  else if (Object.keys(hasil.jejak).length && !PAKSA) {
    hasil.tolak = `punya jejak nyata (${Object.entries(hasil.jejak)
      .map(([k, n]) => `${k}=${n}`)
      .join(", ")}) — bukan akun uji`;
  } else if (profil?.balance && Number(profil.balance) !== 0 && !PAKSA) {
    hasil.tolak = `saldo tidak nol (${profil.balance}) — bereskan dulu`;
  }

  return hasil;
}

const ids = [...new Set([...IDS, ...(await Promise.all(ALAMAT.map(cariLewatAlamat))).filter(Boolean)])];
if (!ids.length) gagal("Tidak ada akun yang cocok dengan sasaran itu.");

const periksa = [];
for (const id of ids) periksa.push(await periksaAkun(id));

console.log("Hapus akun uji Fixify — sasaran eksplisit");
console.log("=".repeat(88));
console.log(`mode: ${YA ? "EKSEKUSI" : "RENCANA (dry-run; tambahkan --ya untuk menghapus)"}`);
console.log("");

for (const p of periksa) {
  if (!p.ada) {
    console.log(`• ${p.id} — TIDAK ADA di auth.users (mungkin sudah dihapus)`);
    continue;
  }
  console.log(`• ${p.id}`);
  console.log(`   surel      : ${maskEmail(p.auth.email)}`);
  console.log(`   dibuat     : ${String(p.auth.created_at).slice(0, 19)} · konfirmasi: ${p.auth.email_confirmed_at ? "ya" : "BELUM"} · masuk terakhir: ${p.auth.last_sign_in_at ? String(p.auth.last_sign_in_at).slice(0, 19) : "belum pernah"}`);
  console.log(`   profil     : ${p.profil ? `${p.profil.role} / ${p.profil.approval_status} / saldo=${p.profil.balance}` : "(tidak ada baris profiles)"}`);  console.log(`   jejak      : ${Object.keys(p.jejak).length ? Object.entries(p.jejak).map(([k, n]) => `${k}=${n}`).join(", ") : "(tidak ada)"}`);
  console.log(`   KTP        : ${p.ktp ? p.ktp : "(tidak ada)"}`);
  console.log(`   berkas     : ${p.berkas.length ? p.berkas.join(", ") : "(tidak ditemukan)"}`);
  if (p.tolak) console.log(`   ⛔ DITOLAK: ${p.tolak}`);
  console.log("");
}

const boleh = periksa.filter((p) => p.ada && !p.tolak);
const ditolak = periksa.filter((p) => p.ada && p.tolak);

if (!YA) {
  console.log("=".repeat(88));
  console.log(`${boleh.length} akun akan DIHAPUS (beserta baris profiles lewat cascade), ${ditolak.length} ditolak.`);
  if (boleh.length) {
    console.log("Jalankan sungguhan:");
    console.log(`  node scripts/hapus-akun-uji.mjs ${boleh.map((p) => `--id=${p.id}`).join(" ")} --ya`);
  }
  process.exit(0);
}

console.log("EKSEKUSI");
console.log("-".repeat(88));
let gagalHapus = 0;
for (const p of boleh) {
  const { error } = await admin.auth.admin.deleteUser(p.id);
  if (error) {
    gagalHapus += 1;
    console.log(`  ❌ ${p.id} GAGAL: ${error.message}`);
    continue;
  }
  console.log(`  ✅ ${p.id} dihapus (profil & turunannya ikut)`);
  if (p.ktp) p.berkas.push(`ktp-documents/${p.ktp}`);
  if (p.berkas.length) {
    for (const berkas of p.berkas) {
      const [bucket, ...sisa] = berkas.split("/");
      const { error: eBerkas } = await admin.storage.from(bucket).remove([sisa.join("/")]);
      console.log(`     ${eBerkas ? "❌ berkas GAGAL" : "🗑  berkas"} ${berkas}${eBerkas ? ` — ${eBerkas.message}` : ""}`);
    }
  }
}
for (const p of ditolak) console.log(`  ⏭️  ${p.id} dilewati: ${p.tolak}`);

// Keadaan akhir: daftar akun yang tersisa (disamarkan) — supaya "sudah bersih"
// bisa dibuktikan, bukan diasumsikan.
console.log("");
console.log("KEADAAN AKHIR");
console.log("-".repeat(88));
const semua = [];
for (let page = 1; page <= 50; page += 1) {
  const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  const users = data?.users || [];
  semua.push(...users);
  if (users.length < 1000) break;
}
const { data: profilSisa } = await admin.from("profiles").select("id");
console.log(`  akun auth : ${semua.length} · baris profiles: ${(profilSisa || []).length}`);
for (const u of semua) console.log(`   · ${maskEmail(u.email)}${u.email_confirmed_at ? "" : " (belum konfirmasi)"}`);
const selisih = semua.length - (profilSisa || []).length;
console.log(`  akun tanpa profil: ${selisih === 0 ? "tidak ada" : `${selisih} — jalankan npm run verify:akun-aman`}`);
console.log("");
console.log(
  gagalHapus
    ? `❌ ${gagalHapus} akun gagal dihapus.`
    : `✅ Selesai — ${boleh.length} akun uji dibuang, ${ditolak.length} dilewati.`
);
if (gagalHapus) process.exitCode = 1;
