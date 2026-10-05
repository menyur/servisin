import { statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Status ketersediaan APK untuk halaman /unduh.
 * APK dipisah per ABI oleh CI (flutter build apk --split-per-abi):
 *   - arm64  → HP Android modern (64-bit, mayoritas)
 *   - armv7a → HP Android lama (32-bit)
 * CI juga menulis public/apk/manifest.json berisi versi aplikasi, tanggal
 * build, dan checksum SHA-256 tiap APK — untuk verifikasi unduhan.
 *
 * GET → {
 *   available: boolean,
 *   version?: string, build?: string, builtAt?: string,
 *   variants: [{ id, url, available, sizeMb?, sha256? }]
 * }
 * Daftar file bersifat tetap (tidak mengungkap struktur folder lain).
 */
const APK_VARIANTS = [
  { id: "arm64", file: "fixify-arm64.apk" },
  { id: "armv7a", file: "fixify-armv7a.apk" },
];

function bacaManifest(dir) {
  try {
    const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    if (typeof m !== "object" || m === null) return {};
    return {
      version: typeof m.version === "string" ? m.version : undefined,
      build: typeof m.build === "string" ? m.build : undefined,
      builtAt: typeof m.builtAt === "string" ? m.builtAt : undefined,
      checksums: typeof m.checksums === "object" && m.checksums !== null ? m.checksums : {},
    };
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "public", "apk");
    const { version, build, builtAt, checksums } = bacaManifest(dir);
    const variants = APK_VARIANTS.map(({ id, file }) => {
      const url = `/apk/${file}`;
      const filePath = path.join(dir, file);
      if (!existsSync(filePath)) {
        return { id, url, available: false };
      }
      const sizeMb = Math.round((statSync(filePath).size / (1024 * 1024)) * 10) / 10;
      const sha256 = typeof checksums?.[file] === "string" ? checksums[file] : undefined;
      return { id, url, available: true, sizeMb, sha256 };
    });
    const respons = {
      available: variants.some((v) => v.available),
      variants,
    };
    if (version) respons.version = version;
    if (build) respons.build = build;
    if (builtAt) respons.builtAt = builtAt;
    return Response.json(respons);
  } catch {
    return Response.json({ available: false, variants: [] });
  }
}
