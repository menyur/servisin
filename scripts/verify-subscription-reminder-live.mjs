// ============================================================================
// verify-subscription-reminder-live.mjs — BUKTI HIDUP pengingat langganan.
//
// Yang dibuktikan pada database sungguhan:
//   1. langganan yang jatuh tempo TERDETEKSI (dry-run tidak menulis apa pun);
//   2. pengingat pertama menulis penanda + `reminder_count = 1`;
//   3. menjalankan cron lagi terlalu cepat tidak mengirim apa pun;
//   4. setelah 7 hari masih jatuh tempo → pengingat ke-2, lalu ke-3, lalu
//      BERHENTI karena batas 3 per siklus;
//   5. setelah pelanggan memajukan jadwal, siklus lama tidak lagi due.
//
// PUSH TIDAK DIKIRIM: modul dipanggil dengan `kirim:false`, sehingga hanya
// perilaku pemilihan + penandaan yang diuji. Probe juga dibatasi `userId` ke
// akun uji supaya langganan pelanggan sungguhan tidak tersentuh.
//
// Semua akun & pesanan uji dihapus di blok finally. Pemakaian:
//   npm run verify:langganan-live
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  createTempUser,
  deleteTempUsers,
} from "./lib/probe-env.mjs";
import {
  jalankanPengingatLangganan,
  tanggalWib,
  SUBSCRIPTION_REMINDER_MAX,
  SUBSCRIPTION_REMINDER_REPEAT_DAYS,
} from "../src/lib/subscription-reminder.js";

const env = loadEnv();
const admin = makeAdminClient(env);
let gagal = 0;
const cek = (nama, ok, info = "") => {
  console.log(`  ${ok ? "lulus" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
  if (!ok) gagal += 1;
};

const users = [];
let bookingId = null;

try {
  const { data: layanan, error: layananErr } = await admin
    .from("services")
    .select("id")
    .limit(1)
    .single();
  if (layananErr) throw new Error(`layanan uji tidak terbaca: ${layananErr.message}`);

  const pelanggan = await createTempUser(admin, "customer", "langganan-reminder");
  users.push(pelanggan);

  const selesai = new Date(Date.now() - 100 * 86400000);
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .insert({
      code: `LANG-${Date.now()}`,
      user_id: pelanggan.id,
      service_id: layanan.id,
      booking_date: selesai.toISOString().slice(0, 10),
      booking_time: "08:00-10:00",
      address: "Jl. Uji Pengingat Langganan — aman dihapus",
      subtotal_price: 100000,
      app_fee: 5000,
      total_price: 105000,
      status: "completed",
      payment_method: "cod",
      completed_at: selesai.toISOString(),
    })
    .select("id")
    .single();
  if (bookingErr) throw new Error(`booking uji gagal dibuat: ${bookingErr.message}`);
  bookingId = booking.id;

  const klien = makeAnonClient(env);
  const login = await klien.auth.signInWithPassword({
    email: pelanggan.email,
    password: pelanggan.password,
  });
  cek("pelanggan uji bisa masuk", !login.error, login.error?.message);

  const langganan = await klien.rpc("subscribe_from_booking", {
    p_booking: bookingId,
    p_months: 3,
  });
  cek(
    "langganan dibuat dari pesanan selesai",
    !langganan.error && langganan.data?.ok === true,
    langganan.error?.message ?? JSON.stringify(langganan.data)
  );

  const { data: awal, error: awalErr } = await admin
    .from("service_subscriptions")
    .select("id, next_date, last_reminded_for, reminder_count")
    .eq("source_booking_id", bookingId)
    .single();
  if (awalErr) throw new Error(`langganan uji tidak terbaca: ${awalErr.message}`);
  cek("langganan jatuh tempo hari ini", awal.next_date <= tanggalWib(), awal.next_date);

  // 1) Dry-run: terdeteksi, tetapi tidak boleh menulis penanda.
  const dry = await jalankanPengingatLangganan(admin, {
    dry: true,
    userId: pelanggan.id,
  });
  cek(
    "dry-run mendeteksi tepat satu langganan uji",
    !dry.error && dry.dikirim.length === 1 && dry.dikirim[0].id === awal.id,
    dry.error ?? `dikirim=${dry.dikirim?.length}`
  );
  const { data: setelahDry } = await admin
    .from("service_subscriptions")
    .select("last_reminded_for")
    .eq("id", awal.id)
    .single();
  cek("dry-run tidak menulis penanda", setelahDry?.last_reminded_for == null,
    String(setelahDry?.last_reminded_for));

  // 2) Jalan nyata (tanpa push): penanda harus tertulis.
  const pertama = await jalankanPengingatLangganan(admin, {
    kirim: false,
    userId: pelanggan.id,
  });
  cek(
    "jalan pertama menandai satu langganan",
    !pertama.error && pertama.dikirim.length === 1 && pertama.dikirim[0].push === false,
    pertama.error ?? `dikirim=${pertama.dikirim?.length}`
  );
  const { data: setelahPertama } = await admin
    .from("service_subscriptions")
    .select("last_reminded_for, last_reminded_at, reminder_count")
    .eq("id", awal.id)
    .single();
  cek(
    "penanda menyimpan tanggal jatuh tempo & hitungan pengingat",
    setelahPertama?.last_reminded_for === awal.next_date &&
      Boolean(setelahPertama?.last_reminded_at) &&
      setelahPertama?.reminder_count === 1,
    JSON.stringify(setelahPertama)
  );

  // 3) Jalan kedua pada siklus yang sama: belum 7 hari, jadi tidak boleh kirim.
  const kedua = await jalankanPengingatLangganan(admin, {
    kirim: false,
    userId: pelanggan.id,
  });
  cek(
    "jalan kedua terlalu cepat tidak mengulang pengingat",
    !kedua.error && kedua.dikirim.length === 0 && kedua.dilewati >= 1,
    kedua.error ?? `dikirim=${kedua.dikirim?.length}, dilewati=${kedua.dilewati}`
  );

  // 4) Masih jatuh tempo setelah 7 & 14 hari → dua pengingat ulang, lalu batas.
  const hariKe = (n) => new Date(Date.now() + n * 86400000);
  const ulang2 = await jalankanPengingatLangganan(admin, {
    kirim: false,
    userId: pelanggan.id,
    sekarang: hariKe(SUBSCRIPTION_REMINDER_REPEAT_DAYS + 1),
  });
  cek(
    `pengingat ulang ke-2 setelah ${SUBSCRIPTION_REMINDER_REPEAT_DAYS} hari`,
    !ulang2.error && ulang2.dikirim.length === 1 && ulang2.dikirim[0].reminder_count === 2,
    ulang2.error ?? JSON.stringify(ulang2.dikirim?.[0])
  );

  const ulang3 = await jalankanPengingatLangganan(admin, {
    kirim: false,
    userId: pelanggan.id,
    sekarang: hariKe(SUBSCRIPTION_REMINDER_REPEAT_DAYS * 2 + 1),
  });
  cek(
    "pengingat ulang ke-3 masih diizinkan",
    !ulang3.error && ulang3.dikirim.length === 1 && ulang3.dikirim[0].reminder_count === 3,
    ulang3.error ?? JSON.stringify(ulang3.dikirim?.[0])
  );

  const batas = await jalankanPengingatLangganan(admin, {
    kirim: false,
    userId: pelanggan.id,
    sekarang: hariKe(SUBSCRIPTION_REMINDER_REPEAT_DAYS * 4),
  });
  cek(
    `setelah ${SUBSCRIPTION_REMINDER_MAX} pengingat, cron berhenti mengganggu`,
    !batas.error && batas.dikirim.length === 0 && batas.dilewati >= 1,
    batas.error ?? `dikirim=${batas.dikirim?.length}`
  );

  // 4b) Aplikasi pelanggan harus melihat hitungan yang sama lewat RPC-nya.
  const daftar = await klien.rpc("my_subscriptions");
  const barisSaya = (daftar.data || []).find((r) => r.id === awal.id);
  cek(
    "RPC pelanggan mengekspos status pengingat siklus berjalan",
    !daftar.error &&
      barisSaya?.reminder_count === SUBSCRIPTION_REMINDER_MAX &&
      barisSaya?.last_reminded_for === awal.next_date &&
      Boolean(barisSaya?.last_reminded_at),
    daftar.error?.message ?? JSON.stringify(barisSaya)
  );

  // 5) Pelanggan memajukan jadwal → siklus baru tidak lagi due.
  const maju = await klien.rpc("advance_subscription", {
    p_id: awal.id,
    p_bulan: 3,
  });
  cek(
    "pelanggan bisa memajukan siklus",
    !maju.error && maju.data?.ok === true,
    maju.error?.message ?? JSON.stringify(maju.data)
  );
  const setelahMaju = await jalankanPengingatLangganan(admin, {
    kirim: false,
    userId: pelanggan.id,
  });
  cek(
    "setelah dimajukan, tidak ada pengingat yang terkirim",
    !setelahMaju.error && setelahMaju.dikirim.length === 0,
    setelahMaju.error ?? `dikirim=${setelahMaju.dikirim?.length}`
  );
  const sesudahMaju = await admin
    .from("service_subscriptions")
    .select("next_date, last_reminded_for, reminder_count")
    .eq("id", awal.id)
    .single();
  cek(
    "siklus baru tidak mewarisi status 'sudah diingatkan' siklus lama",
    sesudahMaju.data?.next_date !== awal.next_date &&
      sesudahMaju.data?.last_reminded_for !== sesudahMaju.data?.next_date,
    JSON.stringify(sesudahMaju.data)
  );
} catch (e) {
  console.error(`\nERROR: ${e.message}`);
  gagal += 1;
} finally {
  if (bookingId) await admin.from("bookings").delete().eq("id", bookingId);
  await deleteTempUsers(admin, users);
  const sisaBooking = bookingId
    ? (await admin.from("bookings").select("id", { count: "exact", head: true }).eq("id", bookingId))
        .count ?? 0
    : 0;
  const sisaLangganan = bookingId
    ? (
        await admin
          .from("service_subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("source_booking_id", bookingId)
      ).count ?? 0
    : 0;
  console.log(
    `  ${sisaBooking === 0 && sisaLangganan === 0 ? "lulus" : "GAGAL"}  data uji dibersihkan — ` +
      `${sisaBooking} pesanan, ${sisaLangganan} langganan tersisa`
  );
  if (sisaBooking !== 0 || sisaLangganan !== 0) gagal += 1;
}

console.log(gagal ? `\n${gagal} GAGAL` : "\nsemua lulus");
process.exit(gagal ? 1 : 0);
