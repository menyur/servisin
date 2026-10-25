// ============================================================================
// verify-customer-address-book.mjs — jaga buku alamat pelanggan.
//
// Janji yang diuji:
//   1. Migrasi menambah profiles.saved_addresses + RPC save/delete, dan
//      profiles.address tetap mengikuti alamat utama (kode lama tidak rusak).
//   2. Alamat yang sama tidak diduplikasi; label & titiknya diperbarui.
//   3. Mengganti alamat utama memindahkan tanda utama, bukan menambah kedua.
//   4. Menghapus alamat utama menaikkan alamat tersisa jadi utama.
//   5. Anon tidak boleh memanggil RPC (hanya pemilik akun, lewat auth.uid()).
//
// Pemakaian:
//   node scripts/verify-customer-address-book.mjs           → statis
//   node scripts/verify-customer-address-book.mjs --live    → + RPC nyata
//
// Exit: 0 lulus · 1 ada temuan · 3 kredensial kurang (mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (berkas) => readFileSync(path.join(ROOT, berkas), "utf8");
const live = process.argv.includes("--live");

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

// ------------------------------------------------------------------ statis ---
const sql = baca("supabase/migrate-customer-address-book.sql");
const api = baca("flutter_app/lib/api.dart");
const wizard = baca("flutter_app/lib/ui/booking_wizard.dart");
const models = baca("flutter_app/lib/models.dart");

cek(
  "kolom saved_addresses berbentuk array jsonb",
  /add column if not exists saved_addresses jsonb not null default '\[\]'::jsonb/i.test(sql),
  "tanpa kolom ini buku alamat tidak punya tempat"
);
cek(
  "RPC save_my_address memakai auth.uid()",
  /create or replace function public\.save_my_address/.test(sql) &&
    /v_uid uuid := auth\.uid\(\)/.test(sql),
  "buku alamat harus terikat pemilik sesi, bukan id dari klien"
);
cek(
  "RPC delete_my_address + grant hanya authenticated",
  /create or replace function public\.delete_my_address/.test(sql) &&
    /grant execute on function public\.delete_my_address\(text\) to authenticated, service_role/.test(sql),
  "penghapusan harus lewat RPC ber-izin"
);
cek(
  "alamat utama disalin ke profiles.address",
  /address = case when v_primary then v_addr else address end/.test(sql),
  "pengisian otomatis wizard lama membaca profiles.address"
);
cek(
  "alamat sama tidak diduplikasi",
  /lower\(btrim\(elem->>'address'\)\) = lower\(v_addr\)/.test(sql),
  "menyimpan ulang alamat yang sama menambah baris ganda"
);
cek(
  "batas 10 alamat diberlakukan di server",
  /v_jumlah >= 10/.test(sql),
  "tanpa batas, buku alamat tumbuh tanpa kendali"
);
cek(
  "aplikasi memanggil RPC, bukan menulis jsonb langsung",
  /rpc\('save_my_address'/.test(api) && /rpc\('delete_my_address'/.test(api),
  "menulis kolom langsung melewati validasi server"
);
cek(
  "wizard menampilkan pemilih alamat berlabel",
  /Alamat tersimpan/.test(wizard) && /_pakaiAlamat/.test(wizard),
  "buku alamat tidak terlihat oleh pelanggan"
);
cek(
  "memilih alamat tanpa titik menghapus pin lama",
  /_pin = \(a\.lat != null && a\.lng != null\)/.test(wizard),
  "pin rumah lama bisa mengarahkan teknisi ke alamat yang salah"
);
cek(
  "model membaca saved_addresses dari List maupun String JSON",
  /parseSavedAddresses/.test(models) && /jsonDecode\(data\)/.test(models),
  "PostgREST bisa mengirim jsonb sebagai teks"
);

// -------------------------------------------------------------------- live ---
if (live) {
  let env;
  try {
    const { loadEnv } = await import("./lib/probe-env.mjs");
    env = loadEnv();
  } catch (e) {
    console.error(`\nKredensial tidak tersedia: ${e.message}`);
    process.exit(3);
  }

  const {
    makeAdminClient,
    makeUserClient,
    makeAnonClient,
    createTempUser,
    deleteTempUsers,
  } = await import("./lib/probe-env.mjs");

  const admin = makeAdminClient(env);
  const anon = makeAnonClient(env);
  const user = makeUserClient(env);
  const akun = [];
  let kodeKeluar = 0;

  const rpc = async (nama, params) => {
    const { data, error } = await user.rpc(nama, params);
    if (error) throw new Error(`${nama}: ${error.message}`);
    return data || {};
  };

  try {
    console.log("\n== RPC nyata ==");
    const u = await createTempUser(admin, "customer", "alamat");
    akun.push(u);
    const { error: masukErr } = await user.auth.signInWithPassword({
      email: u.email,
      password: u.password,
    });
    if (masukErr) throw new Error(`login akun uji gagal: ${masukErr.message}`);

    const rumah = await rpc("save_my_address", {
      p_label: "Rumah",
      p_address: "Jl. Melati 12, Serang",
      p_lat: -6.11,
      p_lng: 106.15,
    });
    cek(
      "alamat pertama otomatis utama",
      rumah.ok === true && rumah.is_primary === true &&
        rumah.saved_addresses?.length === 1,
      `jawaban: ${JSON.stringify(rumah)}`
    );

    const kantor = await rpc("save_my_address", {
      p_label: "Kantor",
      p_address: "Jl. Sudirman 1, Serang",
    });
    cek(
      "alamat kedua tidak merebut status utama",
      kantor.saved_addresses?.length === 2 &&
        kantor.saved_addresses.filter((a) => a.is_primary).length === 1 &&
        kantor.saved_addresses.find((a) => a.label === "Rumah")?.is_primary === true,
      `daftar: ${JSON.stringify(kantor.saved_addresses)}`
    );

    const ulang = await rpc("save_my_address", {
      p_label: "Rumah (baru)",
      p_address: "  jl. melati 12, serang  ",
    });
    cek(
      "alamat sama hanya memperbarui label, tidak menggandakan",
      ulang.saved_addresses?.length === 2 &&
        ulang.saved_addresses.some((a) => a.label === "Rumah (baru)"),
      `daftar: ${JSON.stringify(ulang.saved_addresses)}`
    );

    const pindah = await rpc("save_my_address", {
      p_label: "Kantor",
      p_address: "Jl. Sudirman 1, Serang",
      p_make_primary: true,
    });
    cek(
      "pindah utama: hanya satu alamat utama",
      pindah.saved_addresses?.filter((a) => a.is_primary).length === 1 &&
        pindah.saved_addresses.find((a) => a.label === "Kantor")?.is_primary === true,
      `daftar: ${JSON.stringify(pindah.saved_addresses)}`
    );

    const profil = await user
      .from("profiles")
      .select("address, saved_addresses")
      .eq("id", u.id)
      .maybeSingle();
    cek(
      "profiles.address mengikuti alamat utama",
      profil.data?.address === "Jl. Sudirman 1, Serang",
      `profiles.address: ${profil.data?.address}`
    );

    const kantorId = pindah.saved_addresses.find((a) => a.label === "Kantor").id;
    const hapus = await rpc("delete_my_address", { p_id: kantorId });
    cek(
      "hapus alamat utama menaikkan alamat tersisa",
      hapus.ok === true && hapus.saved_addresses?.length === 1 &&
        hapus.saved_addresses[0].is_primary === true,
      `daftar: ${JSON.stringify(hapus.saved_addresses)}`
    );

    const profil2 = await user
      .from("profiles")
      .select("address")
      .eq("id", u.id)
      .maybeSingle();
    cek(
      "profiles.address ikut alamat utama yang baru",
      profil2.data?.address === "Jl. Melati 12, Serang",
      `profiles.address: ${profil2.data?.address}`
    );

    const labelPanjang = await rpc("save_my_address", {
      p_label: "x".repeat(25),
      p_address: "Jl. Panjang Sekali 9",
    });
    cek(
      "label > 24 karakter ditolak",
      labelPanjang.ok === false,
      `jawaban: ${JSON.stringify(labelPanjang)}`
    );

    const { error: anonErr } = await anon.rpc("save_my_address", {
      p_label: "Rumah",
      p_address: "Jl. Anon 1",
    });
    cek(
      "anon tidak bisa menulis buku alamat",
      Boolean(anonErr),
      "RPC harus menolak permintaan tanpa sesi"
    );
  } catch (e) {
    gagal.push(`live: ${e.message}`);
    console.log(`  GAGAL  live — ${e.message}`);
    kodeKeluar = 1;
  } finally {
    const bersih = await deleteTempUsers(admin, akun);
    for (const b of bersih) {
      console.log(`  bersih ${b.label}: ${b.ok ? "ok" : b.error}`);
      if (!b.ok) kodeKeluar = 1;
    }
  }

  if (kodeKeluar) process.exit(kodeKeluar);
}

console.log(`\n${lulus} lulus · ${gagal.length} gagal`);
if (gagal.length) {
  for (const g of gagal) console.log(`  - ${g}`);
  process.exit(1);
}
