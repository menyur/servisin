/**
 * Sumber tunggal lokasi APK yang dapat diunduh.
 *
 * Latar: APK Flutter (±20 MB per varian ABI) sebelumnya di-commit ke
 * `public/apk/` sehingga setiap rilis menambah ±39 MB ke riwayat Git — repo
 * membengkak dan setiap clone ikut mengunduh tumpukan APK lama. Sekarang
 * berkasnya hidup sebagai **aset GitHub Release** dan Git hanya menyimpan
 * `public/apk/manifest.json` (beberapa ratus byte: versi, ukuran, checksum).
 *
 * Diunggah otomatis oleh GitHub Actions (.github/workflows/build-apk.yml) ke
 * tag [APK_RELEASE_TAG] dengan `gh release upload --clobber`, jadi tag-nya
 * menunjuk SATU rilis tetap yang asetnya selalu diganti versi terbaru.
 * URL bertag tetap (bukan `/releases/latest/…`) dipilih supaya alamat unduh
 * deterministik dan tak bergantung heuristik "latest" GitHub.
 */

export const APK_RELEASE_REPO = "menyur/servisin";

/** Tag rilis tempat aset APK selalu ditimpa (clobber) saat build baru. */
export const APK_RELEASE_TAG = "apk-latest";

/**
 * Varian APK per ABI. `id` dipakai UI (label tombol), `file` adalah nama aset
 * di GitHub Release — harus sama dengan nama berkas yang dihasilkan CI dan
 * sama dengan kunci di `public/apk/manifest.json`.
 */
export const APK_VARIANTS = [
  { id: "arm64", file: "fixify-arm64.apk" },
  { id: "armv7a", file: "fixify-armv7a.apk" },
];

/** Halaman rilis manusiawi (untuk pengguna yang ingin melihat semua aset). */
export function apkReleasePageUrl(tag = APK_RELEASE_TAG) {
  return `https://github.com/${APK_RELEASE_REPO}/releases/tag/${tag}`;
}

/**
 * URL unduhan langsung sebuah aset APK di GitHub Release.
 * GitHub mengirim `Content-Disposition: attachment`, jadi tautannya langsung
 * mengunduh tanpa halaman perantara.
 */
export function apkAssetUrl(file, tag = APK_RELEASE_TAG) {
  return `https://github.com/${APK_RELEASE_REPO}/releases/download/${tag}/${file}`;
}
