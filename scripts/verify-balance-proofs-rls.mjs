#!/usr/bin/env node
// ============================================================================
// verify-balance-proofs-rls.mjs — RLS bucket Storage 'balance-proofs'.
//
// Menguji janji keamanan yang paling penting untuk bukti setor saldo teknisi:
//   1. Teknisi bisa MEMBACA bukti transfer miliknya sendiri (jalur yang sama
//      dengan app: upload ke `deposit/...` lalu baca kembali).
//   2. Teknisi LAIN tidak bisa membaca bukti orang lain (tidak bocor).
//   3. Anon (tanpa login) tidak bisa membaca apa pun (bucket privat).
//   4. Jalur unggah berprefiks `<uid>/...` juga terbaca oleh pemiliknya
//      (dukungan maju bila folder diubah).
//
// Jalur data:
//   - Web  [src/components/DepositModal.js]  : `deposit/<millis>-<rand>.<ext>`
//   - App  [flutter_app/lib/api.dart]        : `deposit/<uid>-<millis>.jpg`
//   Keduanya menaruh objek di folder `deposit/`, BUKAN di `<uid>/`. Owner-read
//   berbasis prefiks uid saja (lihat supabase/fix-security-audit.sql) TIDAK
//   cocok — probe ini menangkap regresi tersebut.
//
// PERINGATAN: membuat akun + objek uji sementara lalu menghapusnya.
// Jalankan: node scripts/verify-balance-proofs-rls.mjs
// Kode keluar: 0 = lulus, 1 = regresi/asersi gagal, 3 = kredensial tidak ada.
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  sleep,
} from "./lib/probe-env.mjs";

const BUCKET = "balance-proofs";

const checks = [];
let failed = 0;

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok) });
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

/** true bila operasi MENGHASILKAN error (dipakai untuk kontrol negatif). */
function denied(result) {
  return Boolean(result?.error);
}

async function signIn(env, user) {
  const client = makeUserClient(env);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign-in ${user.label} gagal: ${error.message}`);
  await sleep(200);
  return client;
}

async function download(client, path) {
  try {
    const { data, error } = await client.storage.from(BUCKET).download(path);
    if (error) return { error, data: null };
    return { error: null, data };
  } catch (err) {
    return { error: err, data: null };
  }
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err.code === "NO_CREDENTIALS") {
      console.log("GATE: GAGAL_DIJALANKAN — kredensial probe tidak tersedia.");
      console.log(`Kurang: ${(err.missing ?? []).join(", ")}`);
      process.exit(3);
    }
    throw err;
  }

  const admin = makeAdminClient(env);
  const anon = makeAnonClient(env);
  const users = [];
  const paths = [];

  try {
    step("1. Bucket privat & akun uji");
    const { data: buckets, error: bErr } = await admin.storage.listBuckets();
    const bucket = (buckets ?? []).find((b) => b.id === BUCKET);
    check("bucket balance-proofs ada", !bErr && Boolean(bucket), bErr?.message ?? BUCKET);
    check("bucket TIDAK publik", bucket && bucket.public === false, `public=${bucket?.public}`);

    const techA = await createTempUser(admin, "technician", "e2e-proofs-a");
    const techB = await createTempUser(admin, "technician", "e2e-proofs-b");
    users.push(techA, techB);
    await admin.from("profiles").update({ approval_status: "approved", balance: 0 }).in("id", [techA.id, techB.id]);
    const clientA = await signIn(env, techA);
    const clientB = await signIn(env, techB);
    check("dua sesi teknisi uji siap", true, `${techA.id.slice(0, 8)} / ${techB.id.slice(0, 8)}`);

    step("2. Teknisi A mengunggah bukti (folder `deposit/`, pola app & web)");
    const legacyPath = `deposit/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    paths.push(legacyPath);
    const bytesA = Buffer.from(`bukti-setor-${techA.id}`);
    const { error: upA1 } = await clientA.storage.from(BUCKET).upload(legacyPath, bytesA, {
      contentType: "image/jpeg",
      upsert: false,
    });
    check("A bisa upload ke balance-proofs", !upA1, upA1?.message ?? legacyPath);

    const { error: depErr } = await clientA
      .from("balance_deposits")
      .insert({ technician_id: techA.id, amount: 100000, proof_url: legacyPath, status: "pending" });
    check("A bisa mencatat pengajuan setor (proof_url = path)", !depErr, depErr?.message ?? "ok");

    step("3. Pemilik MEMBACA bukti miliknya sendiri (inti perbaikan)");
    const ownRead = await download(clientA, legacyPath);
    check(
      "A bisa membaca bukti yang dia unggah",
      !ownRead.error,
      ownRead.error?.message ?? "ok"
    );
    if (!ownRead.error && ownRead.data) {
      const text = await ownRead.data.text();
      check("isi bukti utuh (tidak terpotong)", text === bytesA.toString(), `${text.length} byte`);
    }

    step("4. Kontrol negatif: teknisi lain & anon TIDAK boleh membaca");
    const otherRead = await download(clientB, legacyPath);
    check("B (teknisi lain) TIDAK bisa membaca bukti A", denied(otherRead), otherRead.error?.message ?? "BOCOR!");
    const anonRead = await download(anon, legacyPath);
    check("anon TIDAK bisa membaca bukti", denied(anonRead), anonRead.error?.message ?? "BOCOR!");

    step("5. Jalur unggah berprefiks `<uid>/...` juga terbaca pemiliknya (maju)");
    const uidPath = `${techA.id}/deposit/probe-${Date.now()}.jpg`;
    paths.push(uidPath);
    const { error: upUid } = await clientA.storage.from(BUCKET).upload(uidPath, bytesA, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (upUid) {
      check("A bisa upload ke folder <uid>/", false, upUid.message);
    } else {
      const uidRead = await download(clientA, uidPath);
      check("A bisa membaca bukti di folder <uid>/ (jika unggah dicoba)", !uidRead.error, uidRead.error?.message ?? "ok");
      const uidOther = await download(clientB, uidPath);
      check("B TIDAK bisa membaca folder <uid>/ milik A", denied(uidOther), uidOther.error?.message ?? "BOCOR!");
    }
  } finally {
    step("Pembersihan data uji");
    if (paths.length) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
      console.log(`   hapus objek uji: ${rmErr ? `GAGAL (${rmErr.message})` : "OK"}`);
    }
    if (users.length) {
      const ids = users.map((u) => u.id);
      const { error: bdErr } = await admin.from("balance_deposits").delete().in("technician_id", ids);
      console.log(`   hapus baris balance_deposits: ${bdErr ? `GAGAL (${bdErr.message})` : "OK"}`);
      const report = await deleteTempUsers(admin, users);
      for (const r of report) console.log(`   akun uji ${r.label}: ${r.ok ? "OK" : `GAGAL (${r.error})`}`);
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).in("id", ids);
      check("akun uji terhapus (sisa 0)", (count ?? 0) === 0, `sisa=${count ?? 0}`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(`Asersi: ${checks.length - failed}/${checks.length} lulus`);
  if (failed) {
    console.log("KESIMPULAN: BALANCE_PROOFS_RLS_GAGAL — owner-read bocor/rusak.");
    console.log("Jalankan supabase/fix-balance-proofs-owner-read.sql di SQL Editor lebih dulu.");
    process.exit(1);
  }
  console.log("KESIMPULAN: BALANCE_PROOFS_RLS_LULUS — pemilik membaca buktinya; orang lain tidak.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR probe:", err.message);
  process.exit(1);
});
