// ============================================================================
// verify-chat-moderation.mjs — jaga WIRING "Laporkan" & "Blokir" di chat.
//
// Latar: Google Play menempatkan chat pelanggan ↔ teknisi sebagai KONTEN
// BUATAN PENGGUNA, dan kebijakannya mewajibkan aplikasi punya (a) jalur
// pelaporan konten/pengguna dan (b) jalur memblokir pengguna. Fitur ini
// tersebar di lima tempat yang tidak saling terhubung oleh compiler:
//
//   * `lib/chat_moderation.dart`  — daftar alasan + status blokir (murni, diuji);
//   * `lib/ui/chat_screen.dart`   — menu ⋮, lembar laporan, dialog blokir;
//   * `lib/api.dart`              — simpan laporan ke `reports`, tulis
//                                   `chat_blocks`, baca status dua arah;
//   * `supabase/migrate-chat-moderation.sql` — tabel + policy yang MENEGAKKAN
//                                   blokir di RLS (bukan hanya tampilan);
//   * `/syarat` & panel admin     — janji tindak lanjut & tempat admin melihat
//                                   laporan dengan alasannya.
//
// Kalau satu baris hilang (mis. panggilan `Api.blockChatUser` terhapus saat
// refactor), aplikasi tetap compile, `flutter test` tetap hijau, dan tombolnya
// diam-diam tidak menyimpan apa pun — persis pola bug yang membuat gate wiring
// lain di repo ini ada. Gate ini membuat kehilangan itu GAGAL di CI.
//
// Pemakaian:
//   npm run verify:chat-moderation
//   node scripts/verify-chat-moderation.mjs --selftest
//
// Exit code: 0 = semua lulus, 1 = ada pelanggaran.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.argv.includes("--selftest");

const F = {
  aturan: "flutter_app/lib/chat_moderation.dart",
  layar: "flutter_app/lib/ui/chat_screen.dart",
  api: "flutter_app/lib/api.dart",
  migrasi: "supabase/migrate-chat-moderation.sql",
  syarat: "src/app/syarat/page.js",
  admin: "src/components/AdminDashboard.js",
  tes: "flutter_app/test/chat_moderation_test.dart",
};

const asalAsli = new Map();
const bacaMentah = (berkas) => {
  const penuh = path.join(ROOT, berkas);
  if (!existsSync(penuh)) return null;
  return readFileSync(penuh, "utf8");
};
const sumber = (berkas) => {
  if (!asalAsli.has(berkas)) asalAsli.set(berkas, bacaMentah(berkas));
  return asalAsli.get(berkas);
};

// --- Aturan wajib: berkas X harus memuat pola P ------------------------------
// `mengapa` menjelaskan apa yang rusak BAGI PENGGUNA (dan bagi peninjau Play)
// bila pola itu hilang.
const aturan = [
  // --- daftar alasan & status blokir (murni) ---------------------------------
  {
    berkas: F.aturan,
    pola: /const List<ChatReportReason> chatReportReasons = \[/,
    mengapa: "daftar alasan pelaporan harus ada di satu tempat ini",
  },
  {
    berkas: F.aturan,
    pola: /ChatReportReason\('kasar',[^\n]*\)[\s\S]*ChatReportReason\('penipuan',[^\n]*\)[\s\S]*ChatReportReason\('spam',[^\n]*\)[\s\S]*ChatReportReason\('tidak_pantas',[^\n]*\)[\s\S]*ChatReportReason\('lainnya',[^\n]*\)/,
    mengapa:
      "kelima nilai alasan dipakai backend (reports.reason) — nilainya tidak boleh berubah salah satu",
  },
  {
    berkas: F.aturan,
    pola: /bool get inputEnabled => !any;/,
    mengapa: "kotak kirim harus mati saat ada blokir; aturannya satu sumber",
  },
  {
    berkas: F.aturan,
    pola: /String chatReportContent\(\{required String reasonLabel, String\? detail\}\)/,
    mengapa: "isi laporan dibentuk fungsi bersama, bukan dirangkai di UI",
  },

  // --- menu & alur di layar chat --------------------------------------------
  {
    berkas: F.layar,
    pola: /'Laporkan percakapan'/,
    mengapa: "tanpa label ini pengguna tidak menemukan jalur pelaporan",
  },
  {
    berkas: F.layar,
    pola: /enum _ChatMenuAction \{ report, block, unblock \}/,
    mengapa: "aksi Laporkan/Blokir harus tersedia dari menu layar chat",
  },
  {
    berkas: F.layar,
    pola: /_block\.byMe \? _ChatMenuAction\.unblock : _ChatMenuAction\.block/,
    mengapa: "blokir harus bisa DIBUKA kembali — bukan keputusan permanen",
  },
  {
    berkas: F.layar,
    pola: /Api\.reportChat\(/,
    mengapa: "tanpa panggilan ini tombol Laporkan tidak menyimpan apa pun",
  },
  {
    berkas: F.layar,
    pola: /Api\.blockChatUser\(peerId, bookingId: widget\.booking\.id\)/,
    mengapa: "tanpa panggilan ini blokir tidak pernah tersimpan ke database",
  },
  {
    berkas: F.layar,
    pola: /Api\.unblockChatUser\(peerId\)/,
    mengapa: "buka blokir harus benar-benar menghapus barisnya",
  },
  {
    berkas: F.layar,
    pola: /widget\.loadBlockState \?\? Api\.fetchChatBlockState/,
    mengapa:
      "status blokir harus dibaca saat layar dibuka, agar pengguna tidak menunggu balasan yang tak mungkin dikirim",
  },
  {
    berkas: F.layar,
    pola: /chatBlockedByPeerNotice\(peerName\)/,
    mengapa: "pengguna yang diblokir lawan bicara harus diberi tahu dengan jelas",
  },
  {
    berkas: F.layar,
    pola: /class _BlockedComposer extends StatelessWidget/,
    mengapa:
      "kotak tulis diganti keterangan + tombol Laporkan (jalan keluar tetap ada)",
  },
  {
    berkas: F.layar,
    pola: /await send\(reason: result\.reason, detail: result\.detail\);/,
    mengapa: "alasan & catatan pelapor harus ikut terkirim, bukan judul saja",
  },

  // --- API -------------------------------------------------------------------
  {
    berkas: F.api,
    pola: /static Future<void> reportChat\(\{[\s\S]*?\}\) async \{/,
    mengapa: "laporan chat dikirim lewat satu fungsi API",
  },
  {
    berkas: F.api,
    pola: /'kind': 'chat',/,
    mengapa:
      "penanda kind='chat' yang membuat laporan ini terbaca sebagai laporan chat di panel admin",
  },
  {
    berkas: F.api,
    pola: /'reason': reason\.value,/,
    mengapa: "alasan pelaporan harus tersimpan (kolom reports.reason)",
  },
  {
    berkas: F.api,
    pola: /'target_id': peerId,/,
    mengapa: "admin perlu tahu SIAPA yang dilaporkan, bukan hanya isinya",
  },
  {
    berkas: F.api,
    pola: /static Future<void> blockChatUser\([\s\S]*?onConflict: 'blocker_id,blocked_id'\);/,
    mengapa: "blokir idempoten — menekan dua kali tidak menggandakan baris",
  },
  {
    berkas: F.api,
    pola: /static Future<void> unblockChatUser\(String peerId\)/,
    mengapa: "buka blokir butuh jalur API-nya sendiri",
  },
  {
    berkas: F.api,
    pola: /static Future<ChatBlockState> fetchChatBlockState\(String peerId\)/,
    mengapa: "status blokir dibaca dua arah (saya memblokir / saya diblokir)",
  },

  // --- migrasi database: blokir ditegakkan di RLS ----------------------------
  {
    berkas: F.migrasi,
    pola: /create table if not exists chat_blocks \(/,
    mengapa: "tanpa tabel ini blokir tidak punya tempat menyimpan",
  },
  {
    berkas: F.migrasi,
    pola: /add column if not exists kind text not null default 'general'/,
    mengapa: "kolom kind menandai laporan chat tanpa mengubah laporan lama",
  },
  {
    berkas: F.migrasi,
    pola: /reports_kind_check check \(kind in \('general', 'chat'\)\)/,
    mengapa: "nilai kind dibatasi agar panel admin tidak salah tafsir",
  },
  {
    berkas: F.migrasi,
    pola: /create policy "chat_blocks visible to both sides"[\s\S]*?using \(auth\.uid\(\) = blocker_id or auth\.uid\(\) = blocked_id\);/,
    mengapa:
      "kedua pihak harus bisa membaca barisnya, supaya policy chat_messages bisa memeriksa kedua arah",
  },
  {
    berkas: F.migrasi,
    pola: /create policy "chat read by participants or admin"[\s\S]*?and b\.blocked_id = sender_id\s*\)/,
    mengapa:
      "pesan pihak yang diblokir tidak boleh tampil lagi bagi yang memblokir (RLS, bukan hanya UI)",
  },
  {
    berkas: F.migrasi,
    // Pasangan peserta diambil dari `bookings` — pada pemeriksaan INSERT, baris
    // yang diperiksa hanya berisi PENGIRIM, jadi lawan bicaranya tidak bisa
    // dibaca dari baris itu. Bentuk lama (`blocker_id = sender_id` di kedua
    // arah) tampak benar tetapi hanya menutup satu arah: pihak yang DIBLOKIR
    // masih bisa mengirim pesan. Terbukti lewat uji perilaku di database nyata
    // (18 Okt 2026), dan pola ini menjaga bentuk yang benar.
    pola: /create policy "chat insert by participants"[\s\S]*?join chat_blocks b\s*\n?\s*on \(b\.blocker_id = bk\.user_id and b\.blocked_id = bk\.technician_id\)[\s\S]*?b\.blocker_id = bk\.technician_id and b\.blocked_id = bk\.user_id/,
    mengapa:
      "INSERT harus ditolak DUA ARAH untuk pasangan peserta pesanan (bukan hanya pengirimnya)",
  },

  // --- janji moderasi & tempat admin melihatnya ------------------------------
  {
    berkas: F.syarat,
    pola: /2×24 jam/,
    mengapa: "syarat penggunaan harus memuat janji tenggat tindak lanjut laporan",
  },
  {
    berkas: F.syarat,
    pola: /Laporkan[\s\S]{0,60}Blokir/,
    mengapa: "syarat penggunaan harus menyebut jalur Laporkan & blokir di aplikasi",
  },
  {
    berkas: F.admin,
    pola: /function isChatReport\(r\) \{\s*return r\.kind === "chat";/,
    mengapa: "admin harus bisa membedakan laporan chat dari laporan pesanan",
  },
  {
    berkas: F.admin,
    pola: /const CHAT_REASON_LABELS = \{/,
    mengapa: "panel admin harus memakai label alasan yang sama dengan pelapor",
  },
  {
    berkas: F.tes,
    pola: /ChatScreen — Laporkan & Blokir/,
    mengapa: "alur laporkan & blokir harus punya tes widget (dijalankan CI Flutter)",
  },
];

// --- Aturan larangan: pola yang TIDAK boleh ada ------------------------------
const larangan = [
  {
    berkas: F.migrasi,
    pola: /to anon\b/,
    mengapa:
      "laporan & blokir khusus pengguna login — jangan pernah dibuka untuk anon",
  },
  {
    berkas: F.migrasi,
    pola: /disable row level security/i,
    mengapa:
      "RLS tabel chat tidak boleh dimatikan — blokir & laporan bergantung padanya",
  },
];

// --- Pemeriksaan -------------------------------------------------------------
const cek = (daftarSumber) => {
  const lulus = [];
  const gagal = [];
  const periksaSatu = (a, jenis) => {
    const isi = daftarSumber(a.berkas);
    if (isi == null) {
      gagal.push({ ...a, jenis, ada: false });
      return;
    }
    const cocok = a.pola.test(isi);
    const ok = jenis === "larangan" ? !cocok : cocok;
    (ok ? lulus : gagal).push({ ...a, jenis, ada: true });
  };
  for (const a of aturan) periksaSatu(a, "wajib");
  for (const a of larangan) periksaSatu(a, "larangan");
  return { lulus, gagal };
};

const jelaskanGagal = (a) => {
  if (!a.ada) return `BERKASNYA TIDAK ADA: ${a.berkas} — ${a.mengapa}`;
  const kata =
    a.jenis === "larangan" ? "DILARANG ADA tapi ditemukan" : "WAJIB ADA tapi tidak ditemukan";
  return `${kata}: ${a.mengapa}`;
};

const jalankan = () => {
  const hasil = cek(sumber);
  for (const a of hasil.lulus) console.log(`  lulus  ${a.berkas} — ${a.mengapa}`);
  for (const a of hasil.gagal) console.log(`  GAGAL  ${a.berkas} — ${jelaskanGagal(a)}`);
  const total = hasil.lulus.length + hasil.gagal.length;
  console.log(
    `\n${hasil.lulus.length}/${total} pemeriksaan lulus` +
      (hasil.gagal.length ? ` — ${hasil.gagal.length} gagal` : ""),
  );
  return hasil.gagal.length === 0;
};

if (SELFTEST) {
  console.log("== selftest: setiap aturan harus terbukti bisa MERAH ==\n");
  let hampa = 0;
  for (const a of [...aturan, ...larangan]) {
    const isi = sumber(a.berkas);
    const negatif = larangan.includes(a);
    if (isi == null) {
      console.log(`  GAGAL  berkas ${a.berkas} tidak ada`);
      hampa += 1;
      continue;
    }
    // Rusak sumber DI MEMORI saja: hapus kemunculan pola (aturan wajib) atau
    // sisipkan pola terlarang, lalu pastikan aturannya benar-benar merah.
    let rusak;
    if (negatif) {
      // Sengaja memuat KEDUA pola larangan: masing-masing hanya cocok di
      // berkasnya sendiri, jadi tak ada risiko false-positive silang.
      rusak = `${isi}\n-- disable row level security; to anon — disisipkan selftest\n`;
    } else {
      const contoh = isi.match(a.pola);
      if (!contoh) {
        console.log(`  GAGAL  selftest tidak menemukan pola di ${a.berkas} — ${a.mengapa}`);
        hampa += 1;
        continue;
      }
      // Hapus SEMUA kemunculannya: pola pertama sering muncul juga di komentar
      // (mis. `/// Pengganti [Api.x]`), dan menghapus satu saja membuat aturan
      // tetap hijau sehingga selftest salah melaporkan "aturan hampa".
      rusak = isi.split(contoh[0]).join("/* dihapus oleh selftest */");
    }
    const hasil = cek((berkas) => (berkas === a.berkas ? rusak : sumber(berkas)));
    const merah = hasil.gagal.some((g) => g.berkas === a.berkas && g.mengapa === a.mengapa);
    console.log(`  ${merah ? "lulus" : "GAGAL"}  ${a.berkas} — ${a.mengapa}`);
    if (!merah) hampa += 1;
  }
  // Berkas yang hilang sama sekali juga harus terbaca sebagai kegagalan.
  const hasilHilang = cek((berkas) => (berkas === F.migrasi ? null : sumber(berkas)));
  const merahHilang = hasilHilang.gagal.some((g) => g.berkas === F.migrasi && g.ada === false);
  console.log(`  ${merahHilang ? "lulus" : "GAGAL"}  migrasi hilang terdeteksi`);
  if (!merahHilang) hampa += 1;

  console.log(hampa === 0 ? "\nselftest: semua aturan terbukti peka." : `\nselftest: ${hampa} aturan hampa.`);
  process.exit(hampa === 0 ? 0 : 1);
}

console.log("Memeriksa wiring Laporkan & Blokir chat (kebijakan UGC Google Play)…\n");
process.exit(jalankan() ? 0 : 1);
