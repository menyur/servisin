// ============================================================================
// verify-admin-audit.mjs — jaga jejak audit tindakan admin.
//
// Jejak audit yang salah lebih berbahaya daripada tidak ada:
//   * kalau bisa disunting, ia bukan bukti;
//   * kalau menyalin dokumen pribadi (KTP, nomor rekening), ia menjadi masalah
//     privasi baru;
//   * kalau kegagalan menulisnya menggagalkan aksi utama, admin berhenti bekerja
//     saat tabelnya belum dimigrasikan.
//
// Pemakaian:
//   npm run verify:audit            → statis + fungsi murni
//   npm run verify:audit -- --live  → + periksa tabel & hak akses nyata
//
// Exit: 0 lulus · 1 ada temuan · 3 kredensial kurang (mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AUDIT_ENTITY_LABEL, bedaKolom, catatAuditAdmin } from "../src/lib/admin-audit.js";

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

// ------------------------------------------------------------------ migrasi ---
const sql = baca("supabase/migrate-admin-audit-log.sql");
cek(
  "tabel admin_audit_log menyimpan pelaku, aksi, entitas, ringkasan, before/after",
  /create table if not exists public\.admin_audit_log/.test(sql) &&
    /admin_id uuid/.test(sql) &&
    /admin_name text/.test(sql) &&
    /action text not null/.test(sql) &&
    /before jsonb/.test(sql) &&
    /after jsonb/.test(sql),
  "tanpa bentuk ini, jejak hanya mengulang keadaan akhir"
);
cek(
  "nama admin disalin saat penulisan (riwayat tetap terbaca bila akun dihapus)",
  /admin_name text/.test(sql) && /on delete set null/.test(sql),
  "menyimpan hanya admin_id membuat nama hilang saat akun dihapus"
);
cek(
  "hanya ada policy SELECT & INSERT (tidak bisa disunting/dihapus)",
  /"admin can read audit log"[\s\S]{0,160}for select/.test(sql) &&
    /"admin can append audit log"[\s\S]{0,160}for insert/.test(sql) &&
    !/for update/.test(sql) &&
    !/for delete/.test(sql),
  "jejak audit yang bisa diubah bukan bukti"
);
cek(
  "hak UPDATE/DELETE dicabut dari authenticated",
  /revoke update, delete on table public\.admin_audit_log from authenticated/.test(sql),
  "policy saja tidak cukup bila grant tabel masih membuka"
);
cek(
  "anon tidak bisa membaca jejak audit",
  /revoke all on table public\.admin_audit_log from anon/.test(sql),
  "nama admin & ringkasan tindakan bukan data publik"
);

// ------------------------------------------------------------ fungsi murni ---
const beda = bedaKolom(
  { harga: 100, nama: "Lama", ktp_url: "ktp/a.jpg", address: "Jl. Lama" },
  { harga: 200, nama: "Lama", ktp_url: "ktp/b.jpg", address: "Jl. Baru" }
);
cek(
  "hanya kolom yang berubah dicatat",
  beda.before && beda.after && !("nama" in beda.after),
  JSON.stringify(beda)
);
cek(
  "dokumen & alamat pribadi disamarkan",
  beda.before.ktp_url === "(disembunyikan)" &&
    beda.after.ktp_url === "(disembunyikan)" &&
    beda.after.address === "(disembunyikan)",
  JSON.stringify(beda)
);
cek(
  "tidak ada perubahan → before/after null (bukan objek kosong)",
  (() => {
    const r = bedaKolom({ a: 1 }, { a: 1 });
    return r.before === null && r.after === null;
  })(),
  "baris audit tanpa perubahan hanya menambah kebisingan"
);
cek(
  "jumlah kolom dibatasi",
  (() => {
    const before = {};
    const after = {};
    for (let i = 0; i < 30; i += 1) {
      before[`k${i}`] = 0;
      after[`k${i}`] = 1;
    }
    const r = bedaKolom(before, after, { maks: 5 });
    return Object.keys(r.after).length === 5;
  })(),
  "diff raksasa membengkakkan tabel & sulit dibaca admin"
);

// catatAuditAdmin tidak boleh melempar, dan harus mengembalikan null bila gagal.
let insertTerakhir = null;
const supabasePalsu = {
  from(tabel) {
    return {
      insert(nilai) {
        insertTerakhir = { tabel, nilai };
        return {
          select() {
            return {
              async single() {
                return { data: { id: "audit-1" }, error: null };
              },
            };
          },
        };
      },
    };
  },
};
const id = await catatAuditAdmin(
  supabasePalsu,
  { id: "admin-1", email: "admin@fixify.id", user_metadata: { name: "Sari" } },
  { action: "update_price", entity: "service", entityId: "svc-1", summary: "Harga naik" }
);
cek(
  "penulisan audit memakai sesi admin, bukan id dari klien",
  insertTerakhir?.tabel === "admin_audit_log" &&
    insertTerakhir?.nilai?.admin_id === "admin-1" &&
    insertTerakhir?.nilai?.admin_name === "Sari",
  JSON.stringify(insertTerakhir)
);
cek("id baris audit dikembalikan", id === "audit-1");

const gagalDb = {
  from() {
    return {
      insert() {
        return {
          select() {
            return {
              async single() {
                return { data: null, error: { message: "relation does not exist" } };
              },
            };
          },
        };
      },
    };
  },
};
const asliConsoleError = console.error;
console.error = () => {};
const idGagal = await catatAuditAdmin(gagalDb, { id: "a" }, { action: "x", entity: "settings", summary: "y" });
console.error = asliConsoleError;
cek("kegagalan menulis audit tidak melempar", idGagal === null, "aksi utama tidak boleh ikut gagal");

const tanpaAdmin = await catatAuditAdmin(supabasePalsu, null, { action: "x", entity: "settings", summary: "y" });
cek("tanpa admin tidak menulis apa pun", tanpaAdmin === null);
cek(
  "label entitas tersedia untuk filter panel",
  ["service", "category", "profile", "voucher", "settings", "booking", "refund"].every((k) => AUDIT_ENTITY_LABEL[k]),
  "filter tanpa label membingungkan admin"
);

// ---------------------------------------------------------- sambungan kode ---
const actions = baca("src/app/actions/admin.js");
const wajib = [
  ["harga layanan", "update_price"],
  ["detail layanan", "update_service"],
  ["aktif/nonaktif layanan", "activate_service"],
  ["peran pengguna", "update_role"],
  ["komisi teknisi", "update_commission"],
  ["keputusan teknisi", "decide_technician"],
  ["voucher dibuat", "create_voucher"],
  ["voucher dihapus", "delete_voucher"],
  ["aktif/nonaktif kategori", "activate_category"],
  ["buat kategori", "create_category"],
  ["rekening transfer", "update_payment_settings"],
  ["biaya aplikasi", "update_app_fee"],
  ["kuota slot", "update_slot_capacity"],
  ["hapus akun", "execute_account_deletion"],
  ["keahlian/area teknisi", "update_technician_skill_area"],
  ["cuti teknisi", "create_technician_leave"],
];
for (const [nama, aksi] of wajib) {
  cek(
    `jejak audit: ${nama}`,
    new RegExp(`"${aksi}"`).test(actions),
    "tanpa ini pertanyaan 'siapa yang mengubah?' tetap tidak terjawab"
  );
}
cek(
  "aksi membaca admin lewat sesi sebelum menulis jejak",
  /export async function getAdminAuditLogAdmin[\s\S]{0,200}requireAdmin\(supabase\)/.test(actions),
  "RPC/aksi yang bisa dipanggil tanpa sesi admin adalah kebocoran riwayat"
);
cek(
  "pencarian audit membuang karakter filter PostgREST",
  /replace\(\/\[,\(\)\]\/g/.test(actions),
  "koma/kurung di kata kunci bisa mengubah bentuk kueri .or()"
);

const tab = baca("src/components/AdminAuditLogTab.js");
cek(
  "tab jejak audit menampilkan pelaku, waktu, ringkasan, before/after",
  /getAdminAuditLogAdmin/.test(tab) &&
    /admin_name/.test(tab) &&
    /created_at/.test(tab) &&
    /Sebelum/.test(tab) &&
    /Sesudah/.test(tab),
  "tabel audit tanpa penampil tetap mengharuskan admin membuka SQL"
);
cek(
  "tab menjelaskan bahwa catatannya tidak bisa disunting",
  /tambah-saja/i.test(tab),
  "admin perlu tahu ini bukti, bukan daftar yang bisa dirapikan"
);
const dash = baca("src/components/AdminDashboard.js");
cek(
  "tab Jejak Audit terpasang di panel",
  /AdminAuditLogTab/.test(dash) && /label="Jejak Audit"/.test(dash) && /tab === "audit"/.test(dash),
  "komponen tanpa tab = fitur yang tidak bisa dibuka"
);

// ------------------------------------------------------------------- live ---
const live = process.argv.includes("--live");
if (live) {
  const { loadEnv, makeAdminClient, makeAnonClient, makeUserClient, createTempUser, deleteTempUsers } =
    await import("./lib/probe-env.mjs");
  let env = null;
  let admin = null;
  let anon = null;
  try {
    env = loadEnv();
    admin = makeAdminClient(env);
    anon = makeAnonClient(env);
  } catch (e) {
    console.log(`  lewat  live: ${e.message}`);
    process.exitCode = 3;
  }

  if (admin) {
    const { count, error } = await admin
      .from("admin_audit_log")
      .select("id", { count: "exact", head: true });
    cek("live: tabel admin_audit_log ada & terbaca", !error, error?.message || "");
    if (!error) console.log(`  info   live: ${count ?? 0} baris jejak audit tersimpan`);

    const { error: errTulis } = await admin.from("admin_audit_log").insert({
      admin_name: "PROBE AUDIT",
      action: "probe",
      entity: "settings",
      summary: "PROBE AUDIT — aman dihapus",
    });
    cek(
      "live: baris dapat ditambahkan dengan kunci layanan",
      !errTulis,
      errTulis?.message || ""
    );
    if (!errTulis) {
      // Bersihkan hanya baris probe yang baru dibuat.
      await admin.from("admin_audit_log").delete().eq("admin_name", "PROBE AUDIT");
      const { count: sisa } = await admin
        .from("admin_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("admin_name", "PROBE AUDIT");
      cek("live: baris probe dibersihkan", (sisa ?? 0) === 0, "baris uji tertinggal di jejak audit");
    }

    if (anon) {
      const { data: anonRows, error: errAnon } = await anon
        .from("admin_audit_log")
        .select("id")
        .limit(1);
      cek(
        "live: anon tidak bisa membaca jejak audit",
        Boolean(errAnon) || (anonRows || []).length === 0,
        "anon melihat riwayat admin = kebocoran"
      );
    }

    // ---- Sifat TAMBAH-SAJA dibuktikan dengan sesi admin sungguhan ----
    const users = [];
    try {
      const adminUji = await createTempUser(admin, "admin", "audit");
      users.push(adminUji);
      const sesi = makeUserClient(env);
      const { error: errMasuk } = await sesi.auth.signInWithPassword({
        email: adminUji.email,
        password: adminUji.password,
      });
      cek("live: admin uji bisa masuk", !errMasuk, errMasuk?.message || "");

      if (!errMasuk) {
        const { data: baris, error: errInsert } = await sesi
          .from("admin_audit_log")
          .insert({
            admin_id: adminUji.id,
            admin_name: "PROBE RLS",
            action: "probe",
            entity: "settings",
            summary: "PROBE RLS — aman dihapus",
          })
          .select("id")
          .single();
        cek("live: admin dapat MENAMBAH jejak audit", !errInsert && Boolean(baris?.id), errInsert?.message || "");

        if (baris?.id) {
          const { data: ubah, error: errUbah } = await sesi
            .from("admin_audit_log")
            .update({ summary: "diubah" })
            .eq("id", baris.id)
            .select("id");
          cek(
            "live: admin TIDAK dapat mengubah jejak audit",
            Boolean(errUbah) || (ubah || []).length === 0,
            "jejak yang bisa disunting bukan bukti"
          );

          const { data: hapus, error: errHapus } = await sesi
            .from("admin_audit_log")
            .delete()
            .eq("id", baris.id)
            .select("id");
          cek(
            "live: admin TIDAK dapat menghapus jejak audit",
            Boolean(errHapus) || (hapus || []).length === 0,
            "riwayat yang bisa dihapus tidak bisa dipakai saat sengketa"
          );

          // Bersihkan dengan kunci layanan (satu-satunya jalur yang boleh).
          await admin.from("admin_audit_log").delete().eq("id", baris.id);
        }
      }
    } catch (e) {
      cek("live: uji RLS jejak audit berjalan", false, e.message);
    } finally {
      await deleteTempUsers(admin, users);
    }
  }
}

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(process.exitCode || 0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
