import { readFileSync } from "node:fs";
import path from "node:path";

import { APK_VARIANTS, apkReleasePageUrl, apkAssetUrl } from "@/lib/apk-release";

/**
 * Status ketersediaan APK untuk halaman /unduh.
 *
 * APK TIDAK lagi disajikan dari `public/apk/` — berkasnya (±20 MB per varian)
 * kini menjadi aset GitHub Release supaya riwayat Git tak membengkak. Yang
 * tersisa di repo hanya `public/apk/manifest.json` (versi, ukuran, checksum)
 * yang ditulis CI setiap build.
 *
 * Sumber kebenaran `available` = manifest (deterministik, tanpa jaringan),
 * lalu diverifikasi dengan HEAD ke aset Release: kalau GitHub menjawab 404,
 * tautannya dimatikan agar halaman tidak menawarkan unduhan mati. Galat
 * jaringan/timeout sengaja TIDAK mematikan tautan (gangguan sesaat bukan bukti
 * aset hilang).
 *
 * GET → {
 *   available: boolean,
 *   version?, build?, builtAt?, releaseUrl?,
 *   variants: [{ id, url, available, sizeMb?, sha256? }]
 * }
 */
const MANIFEST_PATH = path.join(process.cwd(), "public", "apk", "manifest.json");
const HEAD_TIMEOUT_MS = 3500;

function bacaManifest() {
  try {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    if (typeof m !== "object" || m === null) return {};
    return {
      version: typeof m.version === "string" ? m.version : undefined,
      build: typeof m.build === "string" ? m.build : undefined,
      builtAt: typeof m.builtAt === "string" ? m.builtAt : undefined,
      checksums: typeof m.checksums === "object" && m.checksums !== null ? m.checksums : {},
      sizes: typeof m.sizes === "object" && m.sizes !== null ? m.sizes : {},
    };
  } catch {
    return {};
  }
}

/**
 * HEAD ke aset Release.
 * @returns {{ ada: boolean, bytes?: number }} `ada: false` hanya bila GitHub
 *   memastikan asetnya tidak ada (404/410).
 */
async function cekAset(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) return { ada: false };
    const len = Number(res.headers.get("content-length"));
    return { ada: true, bytes: Number.isFinite(len) && len > 0 ? len : undefined };
  } catch {
    return { ada: true }; // jaringan/timeout → jangan matikan tautan
  }
}

const keMb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

export async function GET() {
  try {
    const { version, build, builtAt, checksums, sizes } = bacaManifest();

    const variants = await Promise.all(
      APK_VARIANTS.map(async ({ id, file }) => {
        const url = apkAssetUrl(file);
        const tercatat = typeof checksums?.[file] === "string";

        // Belum pernah terbit → tidak perlu menembak jaringan.
        if (!tercatat) return { id, url, available: false };

        const { ada, bytes } = await cekAset(url);
        if (!ada) return { id, url, available: false };

        const ukuran = Number(sizes?.[file]) > 0 ? Number(sizes[file]) : bytes;
        const variant = { id, url, available: true };
        if (ukuran) variant.sizeMb = keMb(ukuran);
        variant.sha256 = checksums[file];
        return variant;
      }),
    );

    const respons = {
      available: variants.some((v) => v.available),
      releaseUrl: apkReleasePageUrl(),
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
