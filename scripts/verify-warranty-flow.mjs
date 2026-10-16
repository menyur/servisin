#!/usr/bin/env node
// ============================================================================
// verify-warranty-flow.mjs — E2E jalur GARANSI dari nol.
//
// Yang BELUM dicakup probe lain: `verify:garansi` (47/47) hanya membuktikan
// setelan durasi garansi tersambung dari panel admin sampai
// `warranty_days_efektif()`. Ia tidak pernah mengajukan klaim, dan tidak pernah
// memutuskan klaim — padahal dua fungsi itu ber-penjaga admin dan (sampai 16 Okt
// 2026) salah dibaca sebagai "izin hilang" oleh probe izin, sehingga jalur ini
// nyaris tanpa penjaga sama sekali.
//
// Probe ini membangun rantainya sendiri dengan akun sementara:
//   pelanggan mengajukan klaim → klaim kedua ditolak → pelanggan TIDAK boleh
//   memutuskan → admin memutuskan "approved" → kunjungan ulang Rp 0 terbuat
//   untuk teknisi yang sama → status & jejak keputusan tersimpan di database.
// Ditutup dengan pencarian teknisi terdekat (RPC ber-penjaga admin yang sama)
// supaya "admin boleh, yang lain tidak" terbukti pada kedua fungsi.
//
// Semua akun/baris uji dibersihkan di akhir, termasuk saat uji gagal.
//
// Butuh kredensial di .env.local (NEXT_PUBLIC_SUPABASE_URL + service role +
// kunci anon/publishable). Exit: 0 lulus · 1 ada temuan · 3 tanpa kredensial.
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  createTempUser,
  deleteTempUsers,
  sleep,
} from "./lib/probe-env.mjs";

const gagal = [];
const cek = (label, ok, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) gagal.push(label);
};

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(`⏭️  ${err.message}`);
  process.exit(3);
}

const admin = makeAdminClient(env);
const jejak = { pengguna: [], pesanan: [], klaim: null };

try {
  // Layanan ber-garansi: kalau tidak ada, ujinya tidak bermakna — jangan lulus.
  const { data: layanan } = await admin
    .from("services")
    .select("id, name, warranty_days")
    .gt("warranty_days", 0)
    .limit(1)
    .maybeSingle();
  if (!layanan) {
    console.error("❌ tidak ada layanan ber-warranty_days > 0 — jalur garansi tidak bisa diuji dari nol");
    process.exit(1);
  }
  console.log(`Layanan uji: ${layanan.name} (garansi ${layanan.warranty_days} hari)`);

  const pelanggan = await createTempUser(admin, "customer", "warranty-cust");
  const teknisi = await createTempUser(admin, "technician", "warranty-tech");
  const adminUji = await createTempUser(admin, "admin", "warranty-admin");
  jejak.pengguna.push(pelanggan, teknisi, adminUji);
  await admin.from("profiles").update({ role: "admin" }).eq("id", adminUji.id);
  await admin.from("profiles").update({ approval_status: "approved" }).eq("id", teknisi.id);
  // Akun admin yang baru dibuat mengantre email "pendaftaran" — buang barisnya.
  await admin.from("admin_email_outbox").delete().eq("ref_id", adminUji.id);
  await sleep(400);

  const kode = `WRU-${Math.floor(Math.random() * 900000 + 100000)}`;
  const { data: pesanan, error: bpErr } = await admin
    .from("bookings")
    .insert({
      code: kode,
      user_id: pelanggan.id,
      service_id: layanan.id,
      technician_id: teknisi.id,
      booking_date: new Date().toISOString().slice(0, 10),
      booking_time: "08:00-10:00",
      address: "alamat uji garansi",
      subtotal_price: 100000,
      app_fee: 5000,
      total_price: 105000,
      status: "completed",
      completed_at: new Date().toISOString(),
      payment_method: "cod",
    })
    .select("id, code")
    .single();
  if (bpErr) throw new Error(`gagal menyiapkan pesanan uji: ${bpErr.message}`);
  jejak.pesanan.push(pesanan.id);
  console.log(`Pesanan uji: ${pesanan.code} (completed, teknisi terpasang)`);

  console.log("\n--- 1. Dua sesi uji (pelanggan & admin) ---");
  const sesiPelanggan = makeAnonClient(env);
  const masukPelanggan = await sesiPelanggan.auth.signInWithPassword({
    email: pelanggan.email,
    password: pelanggan.password,
  });
  cek("pelanggan bisa masuk", !masukPelanggan.error, masukPelanggan.error?.message || "");

  const sesiAdmin = makeAnonClient(env);
  const masukAdmin = await sesiAdmin.auth.signInWithPassword({
    email: adminUji.email,
    password: adminUji.password,
  });
  cek("admin uji bisa masuk", !masukAdmin.error, masukAdmin.error?.message || "");

  console.log("\n--- 2. Pelanggan mengajukan klaim ---");
  const klaim = await sesiPelanggan.rpc("create_warranty_claim", {
    p_booking: pesanan.id,
    p_reason: "AC berisik lagi dua hari setelah dikerjakan.",
  });
  cek("klaim diterima & mengembalikan id", klaim.data?.ok === true, JSON.stringify(klaim.error || klaim.data));
  jejak.klaim = klaim.data?.claim_id ?? null;
  cek("durasi garansi dilaporkan server", Number(klaim.data?.warranty_days) > 0, String(klaim.data?.warranty_days));

  const klaim2 = await sesiPelanggan.rpc("create_warranty_claim", {
    p_booking: pesanan.id,
    p_reason: "Mengajukan klaim untuk kedua kalinya.",
  });
  cek("klaim kedua untuk pesanan sama DITOLAK (satu klaim per pesanan)", klaim2.data?.ok === false, JSON.stringify(klaim2.data));

  console.log("\n--- 3. Penjaga: hanya admin yang boleh memutuskan ---");
  const bukanAdmin = await sesiPelanggan.rpc("decide_warranty_claim", {
    p_claim: jejak.klaim,
    p_status: "approved",
  });
  cek(
    "pelanggan TIDAK bisa memutuskan klaim",
    Boolean(bukanAdmin.error) && /hanya admin/i.test(bukanAdmin.error?.message || ""),
    `${bukanAdmin.error?.code} ${bukanAdmin.error?.message}`
  );

  console.log("\n--- 4. Admin memutuskan 'approved' ---");
  const putusan = await sesiAdmin.rpc("decide_warranty_claim", {
    p_claim: jejak.klaim,
    p_status: "approved",
    p_note: "Dijadwalkan kunjungan ulang.",
  });
  cek("admin bisa memutuskan klaim", putusan.data?.ok === true, JSON.stringify(putusan.error || putusan.data));

  // Dibuktikan dengan BACA ULANG dari database, bukan dari jawaban RPC.
  const { data: klaimDb } = await admin
    .from("warranty_claims")
    .select("status, admin_note, decided_at, decided_by, revisit_booking_id")
    .eq("id", jejak.klaim)
    .maybeSingle();
  cek("status klaim tersimpan 'approved'", klaimDb?.status === "approved", JSON.stringify(klaimDb));
  cek("jejak keputusan tercatat (decided_at + decided_by)", Boolean(klaimDb?.decided_at && klaimDb?.decided_by));

  let kunjungan = null;
  if (klaimDb?.revisit_booking_id) {
    jejak.pesanan.push(klaimDb.revisit_booking_id);
    const { data } = await admin
      .from("bookings")
      .select("code, status, technician_id, total_price, user_id")
      .eq("id", klaimDb.revisit_booking_id)
      .maybeSingle();
    kunjungan = data;
  }
  cek(
    "kunjungan ulang terbuat, Rp 0, teknisi & pelanggan sama",
    Boolean(
      kunjungan &&
        Number(kunjungan.total_price) === 0 &&
        kunjungan.technician_id === teknisi.id &&
        kunjungan.user_id === pelanggan.id
    ),
    JSON.stringify(kunjungan)
  );

  console.log("\n--- 5. RPC ber-penjaga admin kedua: pencarian teknisi terdekat ---");
  const terdekat = await sesiAdmin.rpc("technicians_nearby_booking", {
    p_booking: pesanan.id,
    p_radius_m: 20000,
  });
  cek(
    "admin bisa memanggil (bukan 'permission denied')",
    !terdekat.error && terdekat.data?.ok !== false,
    JSON.stringify(terdekat.error || terdekat.data)?.slice(0, 160)
  );
} catch (err) {
  cek(`probe gagal di tengah jalan: ${err.message}`, false);
} finally {
  // Pembersihan WAJIB, termasuk saat ada langkah yang gagal: kunjungan ulang
  // dulu (menunjuk pesanan), baru klaim, lalu pesanannya, lalu akunnya.
  for (const id of [...jejak.pesanan].reverse()) await admin.from("bookings").delete().eq("id", id);
  if (jejak.klaim) await admin.from("warranty_claims").delete().eq("id", jejak.klaim);
  if (jejak.pesanan.length) await admin.from("warranty_claims").delete().eq("booking_id", jejak.pesanan[0]);
  for (const u of jejak.pengguna) await admin.from("admin_email_outbox").delete().eq("ref_id", u.id);
  if (jejak.pengguna.length) {
    const laporan = await deleteTempUsers(admin, jejak.pengguna);
    cek("akun uji terhapus", laporan.every((b) => b.ok), JSON.stringify(laporan));
  }
  const { count: sisaPesanan } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .in("id", jejak.pesanan.length ? jejak.pesanan : ["00000000-0000-0000-0000-000000000000"]);
  cek("tidak ada sisa pesanan uji", (sisaPesanan ?? 0) === 0);
}

console.log("=".repeat(74));
if (gagal.length) {
  console.log(`GAGAL: ${gagal.length} pemeriksaan tidak lulus`);
  for (const g of gagal) console.log(`  - ${g}`);
  process.exit(1);
}
console.log("LULUS: jalur garansi (ajukan → putuskan → kunjungan ulang) berfungsi & bersih.");
