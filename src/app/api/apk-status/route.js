import { statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Status ketersediaan APK untuk halaman /unduh.
 * APK dipisah per ABI oleh CI (flutter build apk --split-per-abi):
 *   - arm64  → HP Android modern (64-bit, mayoritas)
 *   - armv7a → HP Android lama (32-bit)
 *
 * GET → { available: boolean, variants: [{ id, url, available, sizeMb? }] }
 * Daftar file bersifat tetap (tidak mengungkap struktur folder lain).
 */
const APK_VARIANTS = [
  { id: "arm64", file: "fixify-arm64.apk" },
  { id: "armv7a", file: "fixify-armv7a.apk" },
];

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "public", "apk");
    const variants = APK_VARIANTS.map(({ id, file }) => {
      const url = `/apk/${file}`;
      const filePath = path.join(dir, file);
      if (!existsSync(filePath)) {
        return { id, url, available: false };
      }
      const sizeMb = Math.round((statSync(filePath).size / (1024 * 1024)) * 10) / 10;
      return { id, url, available: true, sizeMb };
    });
    return Response.json({
      available: variants.some((v) => v.available),
      variants,
    });
  } catch {
    return Response.json({ available: false, variants: [] });
  }
}
