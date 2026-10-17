#!/usr/bin/env node
// ============================================================================
// verify-chat-moderation-live.mjs — uji PERILAKU Laporkan & Blokir chat pada
// database nyata (Supabase), lewat Management API.
//
// Kenapa harus ada, padahal `verify:chat-moderation` sudah statis:
// gate statis hanya bisa memastikan bahwa BARIS-BARIS tertentu masih ada. Ia
// tidak bisa tahu apakah policy-nya benar-benar MENOLAK. Pelajaran mahal dari
// 18 Okt 2026: bentuk pertama policy INSERT memakai `sender_id` di "kedua arah"
// — tampak benar, lolos gate statis, tetapi saat pihak yang DIBLOKIR mengirim
// pesan barisnya tidak cocok satu pun syarat, sehingga pesannya tetap masuk.
// Hanya uji perilaku yang menangkapnya.
//
// AMAN: seluruh uji berjalan di dalam satu transaksi yang diakhiri `rollback`.
// Tidak ada baris, blokir, laporan, atau antrean push yang tertinggal — skrip
// menutup dengan menghitung ulang sisa barisnya sebagai bukti.
//
// Pemakaian:
//   npm run verify:chat-moderation-live
//   node scripts/verify-chat-moderation-live.mjs
//
// Kredensial: supabase Management API (personal access token `sbp_…`) lewat
// `SUPABASE_ACCESS_TOKEN`, atau .env.local / .env / ~/.supabase/access-token —
// pencariannya sama dengan skrip lain (lihat scripts/lib/supabase-admin.mjs).
// JANGAN tempel token di chat.
//
// Exit code: 0 = semua perilaku sesuai · 1 = ada yang melanggar · 3 = kredensial kurang.
// ============================================================================
import { bacaEnvLokal } from "./lib/email-health.mjs";
import { cariToken, refDariUrl } from "./lib/supabase-admin.mjs";

const lokal = bacaEnvLokal();
const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || lokal.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const REF = refDariUrl(BASE);
const { token: TOKEN, dari } = cariToken({ argv: process.argv.slice(2), lokal });

console.log("Uji perilaku Laporkan & Blokir chat (transaksi, di-ROLLBACK)");
console.log("=".repeat(74));
console.log(`project ref : ${REF || "(tidak terbaca)"}`);
console.log(`token       : ${TOKEN ? `terbaca (dari ${dari})` : "TIDAK ADA"}`);
console.log("");

if (!TOKEN || !REF) {
  console.log("TIDAK BISA DIJALANKAN: butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_ACCESS_TOKEN.");
  console.log("Buat token: https://supabase.com/dashboard/account/tokens (izin database_write)");
  process.exit(3);
}

const query = async (q, readOnly = false) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(readOnly ? { query: q, read_only: true } : { query: q }),
  });
  let json = null;
  const teks = await res.text();
  try {
    json = JSON.parse(teks);
  } catch {
    /* bukan JSON */
  }
  return { ok: res.ok, status: res.status, json, teks };
};

// --- Uji perilaku -----------------------------------------------------------
// `raise exception` di dalam blok = satu-satunya cara menghentikan uji dengan
// pesan yang jelas; semuanya berada di transaksi yang di-ROLLBACK di akhir.
const UJI = `
begin;
do $uji$
declare
  v_booking uuid; v_cust uuid; v_tech uuid; v_admin uuid;
  v_rows int; v_lolos boolean;
begin
  -- Pesanan nyata yang punya teknisi; pesan uji ditandai '[hapus]' supaya
  -- hitungan tidak terpengaruh riwayat chat asli pesanan itu.
  select b.id, b.user_id, b.technician_id into v_booking, v_cust, v_tech
    from public.bookings b
   where b.technician_id is not null and b.user_id is not null
   order by b.created_at desc limit 1;
  if v_booking is null then
    raise exception 'TIDAK ADA pesanan berteknisi untuk diuji';
  end if;
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;
  if v_admin is null then
    raise exception 'TIDAK ADA akun admin — uji moderasi tidak bisa dijalankan';
  end if;

  execute 'set local role authenticated';

  -- KONTROL POSITIF: tanpa blokir, kedua peserta memang bisa mengirim. Tanpa
  -- langkah ini, penolakan di C & D tidak membuktikan apa-apa (bisa jadi RLS
  -- memang selalu menolak).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  insert into public.chat_messages (booking_id, sender_id, body)
    values (v_booking, v_cust, 'uji A [hapus]');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tech::text, 'role', 'authenticated')::text, true);
  insert into public.chat_messages (booking_id, sender_id, body)
    values (v_booking, v_tech, 'uji A2 [hapus]');

  -- Pelanggan memblokir teknisi.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  insert into public.chat_blocks (blocker_id, blocked_id, booking_id)
    values (v_cust, v_tech, v_booking);

  -- C: pihak yang DIBLOKIR tidak bisa mengirim (arah yang dulu bocor).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tech::text, 'role', 'authenticated')::text, true);
  v_lolos := false;
  begin
    insert into public.chat_messages (booking_id, sender_id, body)
      values (v_booking, v_tech, 'uji C [hapus]');
    v_lolos := true;
  exception when insufficient_privilege then null;
  end;
  if v_lolos then
    raise exception 'GAGAL C: pihak yang diblokir MASIH bisa mengirim pesan';
  end if;

  -- D: pihak yang MEMBLOKIR juga tidak bisa mengirim.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  v_lolos := false;
  begin
    insert into public.chat_messages (booking_id, sender_id, body)
      values (v_booking, v_cust, 'uji D [hapus]');
    v_lolos := true;
  exception when insufficient_privilege then null;
  end;
  if v_lolos then
    raise exception 'GAGAL D: pihak yang memblokir masih bisa mengirim pesan';
  end if;

  -- E: yang memblokir tidak lagi MELIHAT pesan pihak yang diblokir.
  select count(*) into v_rows from public.chat_messages
   where booking_id = v_booking and body like 'uji%[hapus]';
  if v_rows <> 1 then
    raise exception 'GAGAL E: pelanggan melihat % pesan uji (harus 1 = miliknya sendiri)', v_rows;
  end if;

  -- F: admin tetap melihat seluruh percakapan (moderasi butuh bukti).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.chat_messages
   where booking_id = v_booking and body like 'uji%[hapus]';
  if v_rows <> 2 then
    raise exception 'GAGAL F: admin melihat % pesan uji (harus 2)', v_rows;
  end if;

  -- G: laporan chat bisa disimpan dengan kind/reason/target dan terbaca pelapornya.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  insert into public.reports (author_id, author_role, kind, reason, title, content, booking_id, target_id)
    values (v_cust, 'customer', 'chat', 'spam', 'Laporan chat uji [hapus]', 'Alasan: uji', v_booking, v_tech);
  select count(*) into v_rows from public.reports
   where author_id = v_cust and kind = 'chat' and title = 'Laporan chat uji [hapus]';
  if v_rows <> 1 then
    raise exception 'GAGAL G: pelapor tidak bisa membaca laporan chat-nya sendiri';
  end if;

  -- H: blokir bisa DIBUKA dan chat hidup kembali (blokir bukan jalan buntu).
  delete from public.chat_blocks where blocker_id = v_cust and blocked_id = v_tech;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tech::text, 'role', 'authenticated')::text, true);
  v_lolos := false;
  begin
    insert into public.chat_messages (booking_id, sender_id, body)
      values (v_booking, v_tech, 'uji H [hapus]');
    v_lolos := true;
  exception when insufficient_privilege then null;
  end;
  if not v_lolos then
    raise exception 'GAGAL H: setelah blokir dibuka, chat harus hidup kembali';
  end if;
end
$uji$;
rollback;
`;

const hasil = await query(UJI);
const lulus = hasil.ok;

const nama = [
  ["kontrol positif: chat biasa tetap bisa dipakai", lulus],
  ["C: pihak yang diblokir tidak bisa mengirim", lulus],
  ["D: pihak yang memblokir tidak bisa mengirim", lulus],
  ["E: pesan pihak yang diblokir disembunyikan dari pemblokir", lulus],
  ["F: admin tetap melihat seluruh percakapan (moderasi)", lulus],
  ["G: laporan chat (kind/reason/target) tersimpan & terbaca pelapornya", lulus],
  ["H: blokir bisa dibuka dan chat hidup kembali", lulus],
];
for (const [teks, ok] of nama) console.log(`  ${ok ? "lulus" : "GAGAL"}  ${teks}`);

if (!lulus) {
  console.log("");
  console.log("❌ uji perilaku GAGAL:");
  console.log(`   HTTP ${hasil.status} — ${(hasil.json?.message || hasil.teks || "").slice(0, 600)}`);
  console.log("");
  console.log("Saran: periksa policy \"chat read by participants or admin\" dan");
  console.log("\"chat insert by participants\" pada public.chat_messages, lalu jalankan");
  console.log("ulang supabase/migrate-chat-moderation.sql (idempoten).");
  process.exit(1);
}

// --- Bukti tidak ada sisa ---------------------------------------------------
const sisa = await query(
  `select
     (select count(*) from public.chat_blocks) as blokir,
     (select count(*) from public.chat_messages where body like '%[hapus]%') as pesan_uji,
     (select count(*) from public.reports where title like '%[hapus]%') as laporan_uji;`,
  true,
);
const baris = Array.isArray(sisa.json) ? sisa.json[0] : sisa.json;
console.log("");
console.log(
  `  sisa setelah rollback: blokir=${baris?.blokir} pesan_uji=${baris?.pesan_uji} laporan_uji=${baris?.laporan_uji}`,
);
const bersih =
  baris && baris.blokir === 0 && baris.pesan_uji === 0 && baris.laporan_uji === 0;
console.log(`  ${bersih ? "lulus" : "GAGAL"}  tidak ada data uji yang tertinggal`);
console.log("");
console.log(
  bersih
    ? "LULUS: blokir ditegakkan dua arah di RLS, laporan chat tersimpan, admin tetap bisa moderasi."
    : "GAGAL: ada data uji yang tertinggal — bersihkan sebelum melanjutkan.",
);
process.exit(bersih ? 0 : 1);
