import Link from "next/link";
import { AlertTriangle, CheckCircle2, Link2Off } from "lucide-react";
import { periksaTautanKonfirmasi, maskEmail, JANJI_HARI } from "@/lib/account-deletion";
import TombolKonfirmasi from "./TombolKonfirmasi";

// Tautan dari email berisi token → halaman ini tidak boleh di-cache/di-prerender.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Konfirmasi Hapus Akun — Fixify",
  robots: { index: false, follow: false },
};

/**
 * Halaman konfirmasi (dibuka dari tautan di email).
 *
 * GET hanya MEMERIKSA token — tidak mengubah apa pun. Penghapusan baru berjalan
 * setelah pengguna menekan tombol (server action), supaya pemindai tautan surel,
 * pratinjau chat, atau bot tidak bisa menghapus akun hanya dengan mengunjungi URL.
 */
export default async function KonfirmasiHapusAkunPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const id = typeof sp.id === "string" ? sp.id : "";
  const token = typeof sp.token === "string" ? sp.token : "";

  const periksa = await periksaTautanKonfirmasi({ id, token });

  return (
    <div className="max-w-lg mx-auto px-5 py-16">
      <div className="card">
        {!periksa.ok && (
          <>
            <Link2Off size={40} className="text-coral mx-auto mb-3" />
            <h1 className="font-display text-xl text-navy mb-2 text-center">
              Tautan tidak bisa dipakai
            </h1>
            <p className="text-sm text-ink-soft text-center mb-5">
              {periksa.alasan === "token_tidak_berlaku"
                ? "Tautan ini sudah kedaluwarsa atau sudah pernah dipakai untuk hal lain. Ajukan permintaan baru — tidak butuh waktu lama."
                : "Tautan ini tidak lengkap atau permintaannya sudah tidak aktif. Ajukan permintaan baru dari halaman Hapus Akun."}
            </p>
            <div className="text-center">
              <Link href="/hapus-akun" className="btn-primary !py-2 text-sm">
                Ajukan permintaan baru
              </Link>
            </div>
          </>
        )}

        {periksa.ok && periksa.sudah && (
          <>
            <CheckCircle2 size={40} className="text-mint mx-auto mb-3" />
            <h1 className="font-display text-xl text-navy mb-2 text-center">
              Permintaan sudah dikonfirmasi
            </h1>
            <p className="text-sm text-ink-soft text-center mb-2">
              Akun <strong className="text-navy">{maskEmail(periksa.email)}</strong> sudah masuk antrean
              penghapusan.
            </p>
            <p className="text-xs text-ink-soft text-center mb-5">
              Kami jalankan paling lambat {JANJI_HARI} hari. Kami kabari lewat email begitu selesai.
            </p>
            <div className="text-center">
              <Link href="/privasi" className="btn-outline !py-2 text-sm">
                Kebijakan Privasi
              </Link>
            </div>
          </>
        )}

        {periksa.ok && !periksa.sudah && (
          <>
            <AlertTriangle size={40} className="text-coral mx-auto mb-3" />
            <h1 className="font-display text-xl text-navy mb-2 text-center">
              Konfirmasi penghapusan akun
            </h1>
            <p className="text-sm text-ink-soft text-center mb-5">
              Kamu akan menghapus akun <strong className="text-navy">{maskEmail(periksa.email)}</strong>.
              Tindakan ini tidak bisa dibatalkan setelah dijalankan.
            </p>
            <ul className="space-y-1.5 text-sm text-ink-soft list-disc pl-5 marker:text-coral mb-5">
              <li>Akun dan akses masuk dihapus — kamu akan keluar dari aplikasi.</li>
              <li>Nama, telepon, foto profil, alamat, dan foto KTP dihapus.</li>
              <li>Percakapan, lampiran, dan laporan dihapus.</li>
              <li className="marker:text-mint">
                Riwayat pesanan, saldo, komisi, dan penilaian tetap tersimpan tanpa identitasmu
                (kewajiban pembukuan).
              </li>
            </ul>
            <TombolKonfirmasi id={periksa.id} token={token} />
          </>
        )}
      </div>

      <p className="text-xs text-ink-soft text-center mt-5">
        Bukan kamu yang meminta? Tutup saja halaman ini — tanpa menekan tombol, tidak ada yang berubah.
      </p>
    </div>
  );
}
