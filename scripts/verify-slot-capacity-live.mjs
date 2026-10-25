// ============================================================================
// verify-slot-capacity-live.mjs — bukti hidup kuota slot + satu pekerjaan aktif.
//
// Yang dibuktikan ke database sungguhan (bukan hanya membaca SQL):
//   * slot yang sudah penuh menolak INSERT pesanan berikutnya,
//   * RPC booking_slot_usage melaporkan sisa 0,
//   * ubah jadwal ke slot penuh ditolak dengan kode `slot_penuh`,
//   * teknisi tidak bisa mengambil tugas kedua selama tugas pertama belum selesai,
//   * setelah tugas pertama selesai, teknisi bisa mengambil tugas berikutnya.
//
// Semua pengguna & pesanan uji dihapus di blok finally. Pemakaian:
//   npm run verify:slot-live
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  createTempUser,
  deleteTempUsers,
} from "./lib/probe-env.mjs";

const env = loadEnv();
const admin = makeAdminClient(env);
let gagal = 0;
const cek = (nama, ok, info = "") => {
  console.log(`  ${ok ? "lulus" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
  if (!ok) gagal += 1;
};

const dibuat = [];
const users = [];

async function buatBooking(attrs) {
  const { data, error } = await admin
    .from("bookings")
    .insert({ code: `SLOT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...attrs })
    .select("id, code")
    .single();
  if (!error && data) dibuat.push(data.id);
  return { data, error };
}

const tanggalA = "2099-01-15";
const tanggalB = "2099-01-16";

try {
  const { data: layanan, error: layananErr } = await admin
    .from("services")
    .select("id, category_id, base_price")
    .limit(1)
    .single();
  if (layananErr) throw new Error(`layanan uji tidak terbaca: ${layananErr.message}`);

  const { data: setelan } = await admin
    .from("app_settings")
    .select("slot_capacity")
    .eq("id", 1)
    .maybeSingle();
  const kapasitas = Number(setelan?.slot_capacity ?? 2);
  cek("setelan kuota terbaca 1–20", kapasitas >= 1 && kapasitas <= 20, `${kapasitas}`);

  const adminUser = await createTempUser(admin, "admin", "slot-admin");
  const pelanggan = await createTempUser(admin, "customer", "slot-cust");
  const teknisi = await createTempUser(admin, "technician", "slot-tech");
  users.push(adminUser, pelanggan, teknisi);

  // ---- Panel admin bisa membaca & menyimpan kuota (RLS app_settings) ----
  const adminClient = makeAnonClient(env);
  const loginAdmin = await adminClient.auth.signInWithPassword({
    email: adminUser.email,
    password: adminUser.password,
  });
  cek("admin uji bisa masuk", !loginAdmin.error, loginAdmin.error?.message);
  const kapasitasBaru = kapasitas === 20 ? 19 : kapasitas + 1;
  try {
    const bacaAdmin = await adminClient
      .from("app_settings")
      .select("slot_capacity")
      .eq("id", 1)
      .maybeSingle();
    cek("admin bisa membaca setelan kuota", !bacaAdmin.error && bacaAdmin.data?.slot_capacity != null,
      bacaAdmin.error?.message);

    const simpan = await adminClient
      .from("app_settings")
      .update({ slot_capacity: kapasitasBaru, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select("slot_capacity")
      .maybeSingle();
    cek("admin bisa menyimpan kuota dari panel",
      !simpan.error && Number(simpan.data?.slot_capacity) === kapasitasBaru,
      simpan.error?.message ?? JSON.stringify(simpan.data));
  } finally {
    await admin.from("app_settings").update({ slot_capacity: kapasitas }).eq("id", 1);
  }
  const pulih = await admin
    .from("app_settings")
    .select("slot_capacity")
    .eq("id", 1)
    .maybeSingle();
  cek("kuota uji dikembalikan", Number(pulih.data?.slot_capacity) === kapasitas,
    `sekarang ${pulih.data?.slot_capacity}`);

  await admin
    .from("profiles")
    .update({
      approval_status: "approved",
      skill: layanan.category_id,
      balance: 500000,
    })
    .eq("id", teknisi.id);

  const pelangganClient = makeAnonClient(env);
  const loginPelanggan = await pelangganClient.auth.signInWithPassword({
    email: pelanggan.email,
    password: pelanggan.password,
  });
  cek("pelanggan uji bisa masuk", !loginPelanggan.error, loginPelanggan.error?.message);

  const teknisiClient = makeAnonClient(env);
  const loginTeknisi = await teknisiClient.auth.signInWithPassword({
    email: teknisi.email,
    password: teknisi.password,
  });
  cek("teknisi uji bisa masuk", !loginTeknisi.error, loginTeknisi.error?.message);

  const base = {
    user_id: pelanggan.id,
    service_id: layanan.id,
    address: "Jl. Uji Kuota Slot — aman dihapus",
    subtotal_price: 100000,
    app_fee: 5000,
    total_price: 105000,
    payment_method: "transfer",
  };

  // ---- Kuota slot: isi sampai penuh, lalu satu lagi harus ditolak ----
  for (let i = 0; i < kapasitas; i++) {
    const r = await buatBooking({
      ...base,
      booking_date: tanggalA,
      booking_time: "08:00-10:00",
      status: "paid",
    });
    if (r.error) throw new Error(`mengisi slot ke-${i + 1} gagal: ${r.error.message}`);
  }

  const lebih = await buatBooking({
    ...base,
    booking_date: tanggalA,
    booking_time: "08:00-10:00",
    status: "paid",
  });
  cek(
    "slot penuh menolak pesanan berikutnya",
    Boolean(lebih.error) && /sudah penuh/i.test(lebih.error.message || ""),
    lebih.error?.message ?? "TIDAK DITOLAK"
  );

  const usage = await pelangganClient.rpc("booking_slot_usage", { p_date: tanggalA });
  const barisSlot = (usage.data || []).find((r) => r.slot === "08:00-10:00");
  cek(
    "RPC pemakaian slot melaporkan penuh",
    !usage.error && barisSlot?.booked === kapasitas && barisSlot?.remaining === 0,
    usage.error?.message ?? JSON.stringify(barisSlot)
  );

  // ---- Reschedule ke slot penuh ditolak ramah ----
  // Tanggal dekat (batas server 90 hari) dan diisi sampai penuh lebih dulu.
  const tanggalC = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const usageC = await pelangganClient.rpc("booking_slot_usage", { p_date: tanggalC });
  const terpakaiC = (usageC.data || []).find((r) => r.slot === "08:00-10:00")?.booked ?? 0;
  for (let i = terpakaiC; i < kapasitas; i++) {
    const r = await buatBooking({
      ...base,
      booking_date: tanggalC,
      booking_time: "08:00-10:00",
      status: "paid",
    });
    if (r.error) throw new Error(`mengisi slot reschedule gagal: ${r.error.message}`);
  }
  const pending = await buatBooking({
    ...base,
    booking_date: tanggalC,
    booking_time: "13:00-15:00",
    status: "pending",
  });
  if (pending.error) throw new Error(`booking pending gagal: ${pending.error.message}`);
  const pindah = await pelangganClient.rpc("reschedule_booking", {
    p_booking: pending.data.id,
    p_date: tanggalC,
    p_time: "08:00-10:00",
  });
  cek(
    "ubah jadwal ke slot penuh ditolak",
    !pindah.error && pindah.data?.ok === false && pindah.data?.kode === "slot_penuh",
    pindah.error?.message ?? JSON.stringify(pindah.data)
  );

  // ---- Satu pekerjaan aktif per teknisi ----
  const kerja1 = await buatBooking({
    ...base,
    booking_date: tanggalB,
    booking_time: "08:00-10:00",
    status: "paid",
  });
  const kerja2 = await buatBooking({
    ...base,
    booking_date: tanggalB,
    booking_time: "10:00-12:00",
    status: "paid",
  });
  if (kerja1.error || kerja2.error) {
    throw new Error(`booking kerja gagal: ${kerja1.error?.message || kerja2.error?.message}`);
  }

  const klaim1 = await teknisiClient.rpc("claim_job", { p_booking: kerja1.data.id });
  cek("klaim pertama berhasil", !klaim1.error && klaim1.data?.ok === true,
    klaim1.error?.message ?? JSON.stringify(klaim1.data));

  const klaim2 = await teknisiClient.rpc("claim_job", { p_booking: kerja2.data.id });
  cek(
    "klaim kedua ditolak selama tugas pertama belum selesai",
    !klaim2.error && klaim2.data?.ok === false && klaim2.data?.kode === "masih_bekerja",
    klaim2.error?.message ?? JSON.stringify(klaim2.data)
  );

  const selesai = await teknisiClient.rpc("set_job_status", {
    p_booking: kerja1.data.id,
    p_status: "completed",
  });
  cek("tugas pertama bisa diselesaikan", !selesai.error && selesai.data?.ok === true,
    selesai.error?.message ?? JSON.stringify(selesai.data));

  const klaim3 = await teknisiClient.rpc("claim_job", { p_booking: kerja2.data.id });
  cek(
    "setelah selesai, teknisi bisa mengambil pekerjaan lagi",
    !klaim3.error && klaim3.data?.ok === true,
    klaim3.error?.message ?? JSON.stringify(klaim3.data)
  );

  // Hapus transaksi saldo hasil penyelesaian sebelum user dihapus.
  await admin.from("balance_transactions").delete().eq("booking_id", kerja1.data.id);
} catch (e) {
  console.error(`\nERROR: ${e.message}`);
  gagal += 1;
} finally {
  if (dibuat.length) await admin.from("bookings").delete().in("id", dibuat);
  await deleteTempUsers(admin, users);
  const sisa = dibuat.length
    ? (await admin.from("bookings").select("id", { count: "exact", head: true }).in("id", dibuat))
        .count ?? 0
    : 0;
  console.log(`  ${sisa === 0 ? "lulus" : "GAGAL"}  data uji dibersihkan — ${sisa} baris tersisa`);
  if (sisa !== 0) gagal += 1;
}

console.log(gagal ? `\n${gagal} GAGAL` : "\nsemua lulus");
process.exit(gagal ? 1 : 0);
