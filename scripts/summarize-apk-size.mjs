// ============================================================================
// summarize-apk-size.mjs — ringkas keluaran `flutter build apk --analyze-size`
// menjadi laporan "komponen penyumbang ukuran terbesar".
//
// Flutter menulis berkas analisis JSON (mis. apk-code-size-analysis_01.json) berisi
// pohon { n, value, children } untuk SETIAP entri APK (lib/, classes.dex,
// assets/, res/, resources.arsc, …). Skrip ini menjumlahkan subtree sehingga
// terlihat bagian mana yang benar-benar memakan ukuran — termasuk rincian
// engine Flutter vs kode Dart aplikasi.
//
// TIDAK butuh kredensial dan tidak menyentuh jaringan. Bersifat informatif:
// bila berkas JSON tidak ditemukan/tak terbaca, ia tetap mencetak ringkasan
// dari log Flutter yang tersedia supaya langkah CI tidak gagal hanya karena
// format berkas berubah.
//
// Pemakaian:
//   node scripts/summarize-apk-size.mjs                    # cari otomatis
//   node scripts/summarize-apk-size.mjs --json=path.json
//   node scripts/summarize-apk-size.mjs --log=analyze-size.log
//   … >> "$GITHUB_STEP_SUMMARY"
// ============================================================================
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};
const flagJson = arg("json");
const flagLog = arg("log");

const MB = (b) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const pct = (bagian, total) => (total > 0 ? `${((bagian / total) * 100).toFixed(1)}%` : "—");

/** Cari berkas analisis: lokasi yang dipakai Flutter bisa beda antar versi. */
function cariJson() {
  if (flagJson) return existsSync(flagJson) ? flagJson : null;
  const kandidat = [];
  const devtools = path.join(homedir(), ".flutter-devtools");
  for (const dir of [devtools, path.join(ROOT, "flutter_app", "build"), path.join(ROOT, "build")]) {
    if (!existsSync(dir)) continue;
    for (const nama of readdirSync(dir)) {
      if (/^apk-code-size-analysis.*\.json$/.test(nama)) {
        const p = path.join(dir, nama);
        kandidat.push({ p, waktu: statSync(p).mtimeMs });
      }
    }
  }
  kandidat.sort((a, b) => b.waktu - a.waktu);
  return kandidat.length ? kandidat[0].p : null;
}

/** Jumlahkan seluruh daun di bawah sebuah node (node kategori punya value kosong). */
function total(node) {
  if (!node) return 0;
  if (!node.children || node.children.length === 0) return Number(node.value) || 0;
  return node.children.reduce((s, c) => s + total(c), 0);
}

const nodeBaru = (n) => {
  const anak = new Map();
  return { n, anak, value: 0 };
};
const masuk = (peta, n) => {
  if (!peta.has(n)) peta.set(n, nodeBaru(n));
  return peta.get(n);
};

/** Agregasi per `package:` di dalam satu subtree (kode Dart AOT). */
function paketTeratas(node, batas = 10) {
  const peta = new Map();
  const telusur = (cur) => {
    if (!cur) return;
    if (typeof cur.n === "string" && cur.n.startsWith("package:")) {
      const key = cur.n.split("/")[0];
      peta.set(key, (peta.get(key) || 0) + total(cur));
      return; // cukup di level paket, jangan hitung ganda anaknya
    }
    for (const c of cur.children || []) telusur(c);
  };
  telusur(node);
  return [...peta.entries()].sort((a, b) => b[1] - a[1]).slice(0, batas);
}

function ringkasLog(logPath) {
  if (!logPath || !existsSync(logPath)) return null;
  const log = readFileSync(logPath, "utf8");
  const baris = log.split(/\r?\n/);
  const idx = baris.findIndex((l) => /total compressed|APK analysis/i.test(l));
  if (idx === -1) return null;
  return baris.slice(Math.max(0, idx - 2), idx + 2).filter((l) => l.trim()).join("\n");
}

const jsonPath = cariJson();
console.log("## Laporan ukuran APK (`--analyze-size`)");
console.log("");
console.log("Dihasilkan `scripts/summarize-apk-size.mjs` dari berkas analisis Flutter.");
console.log("Catatan: `--analyze-size` tidak bisa digabung `--split-debug-info`");
console.log("(lihat `flutter build apk --help`), jadi laporan ini dari build TANPA");
console.log("obfuscation — komposisi penyumbangnya sama, angkanya sedikit berbeda");
console.log("dari APK ter-obfuscate yang diterbitkan.");
console.log("");

if (!jsonPath) {
  console.log("> Berkas analisis tidak ditemukan; hanya ringkasan log yang tersedia.");
  const lg = ringkasLog(flagLog);
  if (lg) console.log("\n```\n" + lg + "\n```");
  process.exit(0);
}

let root;
try {
  root = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch (err) {
  console.log(`> Berkas analisis tidak terbaca (${err.message}).`);
  process.exit(0);
}

console.log(`Berkas: \`${path.relative(process.cwd(), jsonPath) || jsonPath}\``);
console.log("");

const totalSemua = total(root);
console.log(`**Total isi APK: ${MB(totalSemua)} (${totalSemua.toLocaleString("id-ID")} byte)**`);
console.log("");

// --- Komponen tingkat atas -------------------------------------------------
const top = [...(root.children || [])].sort((a, b) => total(b) - total(a)).slice(0, 8);
console.log("### Komponen terbesar di dalam APK");
console.log("");
console.log("| Komponen | Ukuran | Porsi |");
console.log("| --- | ---: | ---: |");
for (const c of top) {
  console.log(`| \`${c.n}\` | ${MB(total(c))} | ${pct(total(c), totalSemua)} |`);
}
console.log("");

// --- Rincian lib/: engine vs kode Dart -------------------------------------
const lib = (root.children || []).find((c) => c.n === "lib");
if (lib) {
  const baris = [];
  for (const abi of lib.children || []) {
    for (const so of abi.children || []) {
      baris.push({ nama: `${abi.n}/${so.n}`, ukuran: total(so), so });
    }
  }
  baris.sort((a, b) => b.ukuran - a.ukuran);
  if (baris.length) {
    console.log("### Rincian `lib/` (native)");
    console.log("");
    console.log("| Berkas | Ukuran | Porsi APK |");
    console.log("| --- | ---: | ---: |");
    for (const b of baris.slice(0, 6)) {
      console.log(`| \`${b.nama}\` | ${MB(b.ukuran)} | ${pct(b.ukuran, totalSemua)} |`);
    }
    console.log("");
  }

  // Paket Dart terbesar (kode aplikasi) — dicari di dalam libapp.so.
  const dart = baris.find((b) => b.so.n.startsWith("libapp.so"));
  if (dart) {
    const paket = paketTeratas(dart.so);
    if (paket.length) {
      console.log(`### Paket Dart terbesar di \`${dart.nama}\` (${MB(dart.ukuran)})`);
      console.log("");
      console.log("| Paket | Ukuran | Porsi kode Dart |");
      console.log("| --- | ---: | ---: |");
      for (const [nama, ukuran] of paket) {
        console.log(`| \`${nama}\` | ${MB(ukuran)} | ${pct(ukuran, dart.ukuran)} |`);
      }
      console.log("");
    }
  }
}
