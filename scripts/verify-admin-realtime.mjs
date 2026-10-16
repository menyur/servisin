// ============================================================================
// verify-admin-realtime.mjs — jaga agar PANEL ADMIN tetap terisi sendiri.
//
// Modus: statis, tanpa jaringan — bisa jalan di CI mana pun.
//   npm run verify:admin-realtime
//
// LATAR (kerusakan nyata, 15 Okt 2026): "pesanan baru tidak muncul otomatis,
// harus refresh". Penyebabnya bukan database: publication & RLS sudah benar
// (dibuktikan scripts/verify-realtime.mjs --rls, yang kini juga menguji sesi
// ADMIN menerima INSERT). Penyebabnya urutan di klien — `subscribe()` dipanggil
// sebelum token pengguna dipasang, sehingga join berangkat sebagai anon: kanal
// melaporkan SUBSCRIBED (badge "Live" hijau) tetapi event-nya disaring RLS
// habis. Kegagalan seperti itu TIDAK bisa dilihat dari build hijau, dari log,
// maupun dari tampilan — hanya dari perilaku. Karena itu invariannya dikunci di
// sini sebagai urutan, bukan sebagai komentar.
//
// Yang diperiksa:
//   1. token sesi dipasang SEBELUM kanal join (dan tidak ada subscribe() lebih dulu);
//   2. token diperbarui saat sesi diperpanjang (tanpa itu, kanal bisu setelah ±1 jam);
//   3. setiap event memicu refresh data SERVER (papan harian/lencana adalah prop server);
//   4. state daftar ikut menerima prop server yang baru (kalau tidak, refresh tak terlihat);
//   5. admin diberi tahu kedatangan pesanan/laporan, dan lencana "+N baru" tidak
//      menyala untuk isi yang sudah tampil sejak halaman dibuka.
//
// Exit: 0 lulus · 1 ada temuan.
// ============================================================================
import { readFileSync } from "node:fs";

const REALTIME = "src/lib/realtime.js";
const DASHBOARD = "src/components/AdminDashboard.js";
const PAGE = "src/app/admin/page.js";

let salah = 0;
let n = 0;
const cek = (label, ok, detail = "") => {
  n++;
  if (!ok) salah++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Buang komentar agar pemeriksaan tidak tertipu oleh penjelasan di komentar. */
const tanpaKomentar = (teks) =>
  teks
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");

const hook = tanpaKomentar(readFileSync(REALTIME, "utf8"));
const dasbor = tanpaKomentar(readFileSync(DASHBOARD, "utf8"));

console.log("Realtime panel admin (statis)");
console.log("=".repeat(74));

// --------------------------------------------------------------------------
// 1) Urutan: token dulu, kanal kemudian.
// --------------------------------------------------------------------------
const posSetAuth = hook.indexOf("realtime.setAuth(");
const posSubscribe = hook.indexOf(".subscribe(");
const posChannel = hook.indexOf("supabase.channel(");
const posGetSession = hook.indexOf("auth.getSession()");

cek("hook realtime memakai klien Supabase sisi browser", /createClient\(\)/.test(hook) && /createClient/.test(hook));
cek(
  "sesi dibaca (getSession) sebelum kanal dibuat",
  posGetSession !== -1 && posChannel !== -1 && posGetSession < posChannel,
  "tanpa ini kanal join sebagai anon: badge Live, event 0"
);
cek(
  "token dipasang (realtime.setAuth) SEBELUM subscribe()",
  posSetAuth !== -1 && posSubscribe !== -1 && posSetAuth < posSubscribe,
  "join tanpa access_token = RLS menyaring semua pesanan baru"
);
cek(
  "token dibaca dengan menunggu (await) — bukan fire-and-forget",
  /await\s+supabase\.realtime\.setAuth\(/.test(hook) || /await\s+[\w.]*realtime\.setAuth\(/.test(hook)
);

// --------------------------------------------------------------------------
// 2) Perpanjangan sesi: kanal harus memakai token terbaru.
// --------------------------------------------------------------------------
cek(
  "token diperbarui saat sesi berubah (onAuthStateChange → setAuth)",
  /onAuthStateChange/.test(hook) && /setAuth\(/.test(hook.slice(hook.indexOf("onAuthStateChange")))
);
cek(
  "langganan auth dilepas saat effect dibersihkan",
  /unsubscribe\(\)/.test(hook)
);
cek(
  "kanal dilepas saat komponen dibongkar",
  /removeChannel\(/.test(hook)
);

// --------------------------------------------------------------------------
// 3) Event harus ikut menyegarkan data SERVER, bukan hanya state klien.
// --------------------------------------------------------------------------
const handlerBooking = hook.slice(hook.indexOf("table: \"bookings\""), hook.indexOf("table: \"reports\""));
const handlerReport = hook.slice(hook.indexOf("table: \"reports\""));
cek(
  "langganan INSERT untuk bookings & reports",
  /event:\s*"INSERT"/.test(hook) && /table:\s*"bookings"/.test(hook) && /table:\s*"reports"/.test(hook)
);
cek(
  "event bookings memanggil callback + refresh server",
  /cbBooking\.current\?\.\(/.test(handlerBooking) && /segarkanServer\(\)/.test(handlerBooking),
  "payload realtime hanya baris mentah: tanpa join services/profiles dan tanpa hitungan papan"
);
cek(
  "event reports memanggil callback + refresh server",
  /cbReport\.current\?\.\(/.test(handlerReport) && /segarkanServer\(\)/.test(handlerReport)
);
cek(
  "refresh server ditunda (satu kali per gelombang event)",
  /setTimeout\(/.test(hook) && /router\.refresh\(\)/.test(hook)
);
cek(
  "tab kembali dilihat → refresh (WS bisa ditahan di tab tersembunyi)",
  /visibilitychange/.test(hook) && /visibilityState/.test(hook)
);
cek(
  "fallback refresh berkala saat WS tidak tersambung",
  /setInterval\(/.test(hook) && /if \(!isLive\) router\.refresh\(\)/.test(hook)
);

// --------------------------------------------------------------------------
// 4) Prop server yang baru harus benar-benar masuk ke daftar yang dirender.
// --------------------------------------------------------------------------
cek(
  "hook dipakai di AdminDashboard",
  /useAdminRealtime\(/.test(dasbor)
);
cek(
  "daftar pesanan & laporan mengikuti prop server yang baru",
  /setBookings\(initialBookings\)/.test(dasbor) && /setReports\(initialReports\)/.test(dasbor),
  "tanpa ini router.refresh() tidak mengubah apa pun di layar"
);
cek(
  "sinkronisasi saat render (bukan effect): tidak ada render sisa dengan daftar lama",
  /propsTerakhir/.test(dasbor)
);

// --------------------------------------------------------------------------
// 5) Pemberitahuan yang terlihat + lencana yang tidak menipu.
// --------------------------------------------------------------------------
cek(
  "pemberitahuan kedatangan ditampilkan (bukan hanya lencana angka)",
  /arrivals/.test(dasbor) && /pesanan baru masuk|newCount/.test(dasbor)
);
cek(
  "lencana \"+N baru\" mulai dari isi yang sudah tampil",
  /useRef\(initialBookings\.length/.test(dasbor),
  "kalau dari 0, seluruh isi halaman terhitung sebagai \"baru\" begitu dibuka"
);

// --------------------------------------------------------------------------
// 6) Halaman admin tetap server-rendered (sumber data pertama).
// --------------------------------------------------------------------------
const halaman = readFileSync(PAGE, "utf8");
cek(
  "halaman admin memuat data awal dari server lalu menyerahkannya ke dasbor",
  /getAllBookingsAdmin\(\)/.test(halaman) && /initialBookings=/.test(halaman)
);

console.log("=".repeat(74));
if (salah === 0) {
  console.log(`LULUS: ${n}/${n} — invarian realtime panel admin utuh.`);
  process.exit(0);
}
console.log(`GAGAL: ${salah} dari ${n} pemeriksaan tidak sesuai harapan.`);
process.exit(1);
