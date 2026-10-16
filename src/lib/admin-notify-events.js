/**
 * Daftar peristiwa notifikasi EMAIL ke admin — satu sumber kebenaran untuk
 * server (filter penerima di src/lib/admin-email.js) DAN panel admin (tab
 * "Notif Email Admin").
 *
 * File ini sengaja TANPA import apa pun supaya aman diimpor komponen klien
 * ("use client"); src/lib/admin-email.js memegang kunci service role dan tidak
 * boleh masuk bundel browser.
 *
 * `key` inilah yang disimpan di tabel `admin_notification_optouts` (migrasi
 * supabase/migrate-admin-notification-prefs.sql). Menambah peristiwa baru cukup
 * dengan menambah entri di sini lalu memakai `adminEmailsForEvent(client, key)`
 * pada jalur pengirimannya.
 */
export const ADMIN_NOTIFY_EVENTS = [
  {
    key: "new_booking",
    label: "Pesanan baru masuk",
    hint: "Pelanggan membuat pesanan baru dari web maupun aplikasi.",
  },
  {
    key: "new_report",
    label: "Laporan baru",
    hint: "Pelanggan atau teknisi mengirim laporan.",
  },
  {
    key: "new_deposit",
    label: "Pengajuan setor saldo",
    hint: "Teknisi mengunggah bukti setor saldo untuk diverifikasi.",
  },
  {
    key: "new_withdrawal",
    label: "Pengajuan tarik saldo",
    hint: "Teknisi mengajukan penarikan saldo ke rekening pribadi.",
  },
  {
    key: "new_technician",
    label: "Pendaftaran teknisi baru",
    hint: "Calon teknisi mendaftar dan menunggu kurasi admin.",
  },
  {
    key: "new_customer",
    label: "Pendaftaran pelanggan baru",
    hint: "Akun pelanggan baru dibuat (tanpa kurasi).",
  },
  {
    key: "payment_proof",
    label: "Bukti pembayaran pelanggan",
    hint: "Pelanggan mengirim bukti transfer untuk diverifikasi admin.",
  },
  {
    key: "job_release",
    label: "Teknisi melepas tugas",
    hint: "Teknisi melepas pekerjaan beserta alasannya.",
  },
  {
    key: "account_deletion",
    label: "Permintaan hapus akun",
    hint: "Pengguna meminta akunnya dihapus (aplikasi atau halaman web) — harus dijalankan agar syarat Google Play dan janji 7 hari terpenuhi.",
  },
];

/** Semua kunci peristiwa yang valid (dipakai validasi server). */
export const ADMIN_NOTIFY_EVENT_KEYS = ADMIN_NOTIFY_EVENTS.map((e) => e.key);

/** Label manusiawi satu peristiwa (fallback: kuncinya sendiri). */
export function adminNotifyEventLabel(key) {
  return ADMIN_NOTIFY_EVENTS.find((e) => e.key === key)?.label || key;
}
