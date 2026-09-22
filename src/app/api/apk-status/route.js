import { statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Status ketersediaan APK untuk halaman /unduh.
 * GET → { available: boolean, sizeMb?: number }
 * Tidak mengungkap struktur folder — hanya satu file publik yang dicek.
 */
export async function GET() {
  try {
    const apkPath = path.join(process.cwd(), "public", "apk", "servisin.apk");
    if (!existsSync(apkPath)) {
      return Response.json({ available: false });
    }
    const sizeMb = Math.round(statSync(apkPath).size / (1024 * 1024) * 10) / 10;
    return Response.json({ available: true, sizeMb });
  } catch {
    return Response.json({ available: false });
  }
}
