import Link from "next/link";
import { ShieldCheck, Smartphone, Trash2, Database } from "lucide-react";
import MintaHapusForm from "./MintaHapusForm";

// Halaman ini WAJIB bisa dibuka tanpa memasang aplikasi dan tanpa login:
// itulah syarat "Data deletion" Google Play (dua jalur — dalam aplikasi dan URL
// web). Karena itu isinya mandiri, tanpa komponen yang butuh sesi.
export const metadata = {
  title: "Hapus Akun — Fixify",
  description:
    "Ajukan penghapusan akun Fixify dan data pribadimu. Bisa dari halaman ini tanpa memasang aplikasi, atau dari menu Profil di aplikasi Android.",
};

const KONTAK_EMAIL = "halo@fixify.id";

export default function HapusAkunPage() {
  return (
    <div className="max-w-2xl mx-auto px-5 py-12">
      <span className="pill bg-white text-brand-deep">
        <Trash2 size={13} className="mr-1.5" /> Hapus Akun
      </span>
      <h1 className="font-display text-3xl text-navy mt-5 mb-3 leading-tight">
        Hapus akun Fixify-mu
      </h1>
      <p className="text-ink-soft leading-relaxed mb-8">
        Halaman ini bisa dipakai kapan saja, termasuk setelah kamu tidak lagi memakai aplikasi Fixify.
        Kami memproses permintaan paling lambat <strong className="text-navy">7 hari</strong> setelah
        dikonfirmasi.
      </p>

      <div className="card mb-8">
        <h2 className="font-display text-lg text-navy mb-3">Cara kerjanya</h2>
        <ol className="space-y-2 text-sm text-ink-soft list-decimal pl-5 marker:text-brand">
          <li>Tulis alamat email akunmu di bawah, lalu kirim permintaan.</li>
          <li>
            Kami mengirim <strong className="text-navy">tautan konfirmasi</strong> ke alamat itu. Ini
            memastikan hanya pemilik akun yang bisa menghapusnya.
          </li>
          <li>Buka tautan tersebut dan tekan tombol konfirmasi — permintaan masuk ke antrean kami.</li>
        </ol>
        <p className="text-xs text-ink-soft mt-4">
          Kalau kamu masih bisa masuk ke aplikasi, jalur paling cepat: buka tab{" "}
          <strong className="text-navy">Profil → Hapus akun</strong>{" "}
          <Smartphone size={13} className="inline -mt-0.5 text-brand" />. Keduanya bermuara ke antrean yang
          sama.
        </p>
      </div>

      <div className="card mb-8">
        <h2 className="font-display text-lg text-navy mb-3 flex items-center gap-2">
          <Database size={17} className="text-brand" /> Apa yang dihapus, apa yang disimpan
        </h2>
        <p className="text-sm text-ink-soft mb-3">
          Kami menghapus identitas dan konten pribadimu. Sebagian kecil catatan tetap kami simpan
          <strong className="text-navy"> tanpa identitasmu</strong> karena kewajiban pembukuan — rinciannya
          ada di{" "}
          <Link href="/privasi" className="text-brand underline">
            Kebijakan Privasi
          </Link>{" "}
          dan{" "}
          <Link href="/syarat" className="text-brand underline">
            Syarat &amp; Ketentuan
          </Link>
          .
        </p>
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <p className="font-semibold text-navy mb-1">Dihapus</p>
            <ul className="space-y-1 text-ink-soft list-disc pl-5 marker:text-coral">
              <li>Akun dan akses masuk</li>
              <li>Nama, nomor telepon, foto profil, alamat</li>
              <li>Foto KTP (akun teknisi)</li>
              <li>Percakapan, lampiran, dan laporan</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-navy mb-1">Tetap disimpan (tanpa identitas)</p>
            <ul className="space-y-1 text-ink-soft list-disc pl-5 marker:text-mint">
              <li>Riwayat pesanan sebagai catatan audit</li>
              <li>Saldo, komisi, dan penilaian untuk pembukuan</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <h2 className="font-display text-lg text-navy mb-4">Ajukan penghapusan</h2>
        <MintaHapusForm />
      </div>

      <p className="text-xs text-ink-soft leading-relaxed flex gap-2">
        <ShieldCheck size={15} className="text-mint shrink-0 mt-0.5" />
        <span>
          Ada pesanan berjalan, tugas yang belum selesai, atau saldo yang belum nol? Permintaan ditolak
          otomatis agar tidak ada pekerjaan/uang yang menggantung — selesaikan dulu, lalu ajukan lagi.
          Butuh bantuan?{" "}
          <a href={`mailto:${KONTAK_EMAIL}`} className="text-brand underline">
            {KONTAK_EMAIL}
          </a>
          .
        </span>
      </p>
    </div>
  );
}
