#!/usr/bin/env node
// ============================================================================
// verify-payment-confirmed-notify.mjs — notifikasi "pesanan sudah dibayar".
//
// Latar (celah yang dicegah): konfirmasi pembayaran punya DUA jalur di panel
// admin — tombol "Konfirmasi pembayaran" dan dropdown status. Jalur tombol
// mengirim push `payment_confirmed` ke pelanggan sekaligus broadcast pekerjaan
// baru ke teknisi; jalur dropdown dulu HANYA mengabari teknisi, sehingga
// pelanggan yang dibayarnya dikonfirmasi lewat dropdown tidak menerima apa pun.
//
// Probe ini statis (tanpa jaringan) dan menjaga:
//   * kedua jalur mengirim event `payment_confirmed` ke pelanggan, dan jalur
//     dropdown hanya saat transisi (menyimpan ulang status tidak menduplikasi),
//   * broadcast pekerjaan baru membawa serviceId (tanpa itu `profiles.skill`
//     berisi ID kategori tidak tercocokkan dengan benar),
//   * notifikasi mendarat di tab Pesanan aplikasi dan bisa dimatikan pelanggan,
//   * kotak masuk pelanggan memuat baris "Pembayaran dikonfirmasi".
//
// Jalankan: npm run verify:bayar
// Exit: 0 = lulus, 1 = regresi.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => readFileSync(path.join(ROOT, p), "utf8");

let gagal = 0;
function cek(label, ok, kenapa = "") {
  if (!ok) gagal += 1;
  console.log(`${ok ? "lulus " : "GAGAL "} ${label}${ok || !kenapa ? "" : ` — ${kenapa}`}`);
}

const admin = baca("src/app/actions/admin.js");
const push = baca("src/lib/push.js");
const pushService = baca("flutter_app/lib/push_service.dart");
const notif = baca("flutter_app/lib/ui/notification_settings_screen.dart");
const inbox = baca("flutter_app/lib/inbox.dart");

// ---------- 1) Kanal & peristiwa ----------
cek(
  "peristiwa payment_confirmed terdaftar (bisa dimatikan pelanggan)",
  /payment_confirmed:\s*"Pembayaran dikonfirmasi"/.test(push),
  "peristiwa tanpa label tidak bisa muncul di Pengaturan Notifikasi"
);
cek(
  "sakelar pembayaran dikonfirmasi ada di Pengaturan Notifikasi",
  /NotifEvent\('payment_confirmed'/.test(notif),
  "pelanggan kehilangan kendali atas notifikasi pembayaran"
);

// ---------- 2) Jalur tombol "Konfirmasi pembayaran" ----------
cek(
  "tombol konfirmasi mengirim push ke pelanggan",
  /confirmBookingPaymentAdmin[\s\S]{0,2600}event: "payment_confirmed"/.test(admin),
  "pelanggan tidak tahu pembayarannya sudah diterima"
);
cek(
  "tombol konfirmasi menyertakan serviceId pada broadcast teknisi",
  /confirmBookingPaymentAdmin[\s\S]{0,3000}serviceId: b\.service_id/.test(admin),
  "pencocokan keahlian jatuh ke nama kategori saja"
);

// ---------- 3) Jalur dropdown status ----------
cek(
  "dropdown ke 'paid' mengirim push HANYA saat transisi",
  /status === "paid"[\s\S]{0,700}cur\.status !== "paid"[\s\S]{0,700}event: "payment_confirmed"/.test(
    admin
  ),
  "menyimpan ulang status 'paid' tidak boleh menduplikasi / justru tidak mengirim"
);
cek(
  "dropdown ke 'paid' menyertakan serviceId pada broadcast teknisi",
  /status === "paid"[\s\S]{0,1600}serviceId: cur\.service_id/.test(admin),
  "teknisi dengan skill berupa ID kategori bisa terlewat"
);
cek(
  "broadcast hanya untuk pesanan yang benar-benar belum bertugas",
  /status === "paid"[\s\S]{0,1600}if \(!cur\.technician_id\)[\s\S]{0,500}sendNewJobPushToTechnicians/.test(admin),
  "menyunting status pesanan yang sudah bertugas akan menawarkan pekerjaan yang sudah terisi"
);

// ---------- 4) Sampai ke aplikasi ----------
cek(
  "push pembayaran memakai rute /dashboard (tab Pesanan)",
  /event: "payment_confirmed"[\s\S]{0,200}url: "\/dashboard"/.test(admin) &&
    /default:\s*\n\s*return 'orders'/.test(pushService),
  "rute tak dikenal berakhir di tab yang salah"
);
cek(
  "kotak masuk pelanggan memuat baris 'Pembayaran dikonfirmasi'",
  /Pembayaran dikonfirmasi/.test(inbox),
  "notifikasi hilang setelah tidak dibuka dari push"
);

console.log("-".repeat(74));
console.log(gagal === 0 ? "SEMUA PEMERIKSAAN LULUS" : `${gagal} pemeriksaan GAGAL`);
process.exit(gagal === 0 ? 0 : 1);
