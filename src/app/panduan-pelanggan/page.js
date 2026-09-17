import Link from "next/link";
import {
  Search,
  Wallet,
  Activity,
  FileText,
  Star,
  Gift,
  HelpCircle,
  MessageSquareWarning,
  ChevronRight,
  Home,
  AlertTriangle,
} from "lucide-react";
import { formatRupiah, APP_FEE, REVIEW_INCENTIVE_AMOUNT } from "@/lib/pricing";

export const metadata = {
  title: "Panduan Pelanggan — Servisin",
  description:
    "Cara menggunakan Servisin untuk pelanggan: memesan layanan, membayar, melacak status, menilai teknisi, dan memakai voucher.",
};

const STEPS = [
  {
    icon: Search,
    title: "1. Temukan layanan & buat pesanan",
    body: (
      <>
        <p>
          Jelajahi kategori layanan di halaman utama — AC, kebersihan & laundry, dan lainnya — lalu pilih
          layanan yang kamu butuhkan dan klik <strong>Pesan Sekarang</strong>. Kamu perlu{" "}
          <strong>masuk / daftar akun</strong> dulu supaya pesanan bisa dilacak dan struknya tersimpan.
        </p>
        <p>Alur pemesanan hanya 4 langkah:</p>
        <p className="flex items-center gap-2 flex-wrap my-2 font-semibold text-navy">
          <span className="pill bg-brand-tint text-brand-deep">Layanan</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-brand-tint text-brand-deep">Detail & Jadwal</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-brand-tint text-brand-deep">Rincian Biaya</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-brand-tint text-brand-deep">Pembayaran</span>
        </p>
        <p>
          Tulis alamat dan catatan selengkap mungkin di langkah kedua — itu yang dibaca teknisi sebelum
          berangkat.
        </p>
      </>
    ),
  },
  {
    icon: Wallet,
    title: "2. Bayar sesuai metode pilihanmu",
    body: (
      <>
        <p>Empat metode pembayaran tersedia:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>QRIS / Virtual Account / E-Wallet</strong> — transfer sesuai jumlah tagihan, lalu klik <em>Saya sudah membayar</em> di layar konfirmasi.</li>
          <li>
            <strong>Cash on Delivery (COD)</strong> — bayar tunai langsung ke teknisi setelah pekerjaan
            selesai.
          </li>
        </ul>
        <p>
          Untuk transfer: buka <strong>Dashboard → kartu pesananmu → Konfirmasi Pembayaran</strong>, isi
          jumlah yang kamu transfer (harus sama dengan tagihan), dan <strong>unggah foto bukti
          transfer</strong>. Tim kami memverifikasi buktimu — begitu disetujui, status pesanan berubah{" "}
          <strong>Dibayar</strong> dan pesanan siap ditugaskan ke teknisi.
        </p>
        <p>
          Bukti ditolak? Akan muncul <strong>alasan penolakannya</strong> di kartu pesanan — perbaiki sesuai
          catatan lalu kirim ulang bukti yang benar.
        </p>
      </>
    ),
  },
  {
    icon: Activity,
    title: "3. Pantau status pesananmu",
    body: (
      <>
        <p>Setiap pesanan punya status yang berjalan seperti ini:</p>
        <p className="flex items-center gap-2 flex-wrap my-2 font-semibold text-navy">
          <span className="pill bg-amber-tint text-amber">Menunggu</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-brand-tint text-brand-deep">Dibayar</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-brand-tint text-brand-deep">Dikerjakan</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-mint-tint text-mint">Selesai</span>
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Menunggu</strong> — pesanan dibuat, tunggu pembayaran dikonfirmasi.</li>
          <li><strong>Dibayar</strong> — admin menugaskan teknisi; kamu akan melihat nama teknisinya di kartu pesanan.</li>
          <li><strong>Dikerjakan</strong> — teknisi sedang bekerja di lokasimu.</li>
          <li><strong>Selesai</strong> — pekerjaan rampung; struk otomatis dikirim ke emailmu.</li>
        </ul>
        <p>
          Lupa kode atau ingin cek dari HP lain? Gunakan halaman <strong>Lacak Pesanan</strong> — cukup
          masukkan kode pesanan (mis. <em>SV-1234</em>) tanpa perlu login.
        </p>
      </>
    ),
  },
  {
    icon: FileText,
    title: "4. Terima & simpan strukmu",
    body: (
      <>
        <p>
          Begitu pesanan ditandai <strong>Selesai</strong>, struk PDF otomatis dikirim ke emailmu — berisi
          rincian layanan, diskon voucher, biaya aplikasi, total dibayar, metode pembayaran, dan nama
          teknisi yang menangani.
        </p>
        <p>
          Butuh cetak ulang? Di <strong>Dashboard</strong>, klik <strong>Cetak Struk</strong> pada kartu
          pesanan — kamu bisa <strong>Unduh PDF</strong> langsung atau mencetaknya. Semua struk yang pernah
          dikirim juga tersimpan rapi sebagai arsip di dashboard.
        </p>
      </>
    ),
  },
  {
    icon: Star,
    title: "5. Nilai teknisimu — dan dapatkan voucher",
    body: (
      <>
        <p>
          Pesanan selesai memberimu hak menilai teknisi 1–5 bintang plus komentar lewat tombol{" "}
          <strong>Nilai Teknisi</strong> di kartu pesanan (atau tab <strong>Beri Penilaian</strong>).
          Penilaianmu tampil publik di halaman <strong>Teknisi Kami</strong> dan membantu pelanggan lain
          memilih.
        </p>
        <p>
          Bonusnya: menilai pesanan yang sudah selesai lebih dari 3 hari memberimu{" "}
          <strong>voucher diskon {formatRupiah(REVIEW_INCENTIVE_AMOUNT)}</strong> untuk booking berikutnya —
          voucher otomatis muncul di tab <strong>Voucher Saya</strong>.
        </p>
      </>
    ),
  },
  {
    icon: Gift,
    title: "6. Pakai voucher & sampaikan masukan",
    body: (
      <>
        <p>
          Voucher aktif otomatis terlihat di langkah <strong>Rincian Biaya</strong> saat kamu booking —
          tinggal pilih dan diskonnya langsung dipotong dari total. Masa berlakunya 90 hari sejak terbit,
          jadi jangan sampai hangus.
        </p>
        <p>
          Ada keluhan, masalah layanan, atau saran? Buka tab <strong>Buat Laporan</strong> di dashboard —
          bisa terkait satu pesanan atau laporan umum. Semua laporan masuk ke tim admin dan kamu akan
          melihat status serta catatan balasannya di tab <strong>Laporan</strong>.
        </p>
      </>
    ),
  },
];

const FAQ = [
  {
    q: "Bagaimana cara membayar pesanan saya?",
    a: `Pilih metode di langkah Pembayaran: QRIS, Virtual Account, E-Wallet, atau COD. Untuk transfer, upload foto bukti lewat tombol "Konfirmasi Pembayaran" di kartu pesanan — jumlahnya harus sama dengan tagihan. Admin akan memverifikasi, dan status berubah Dibayar. COD cukup dibayar tunai ke teknisi saat pekerjaan selesai.`,
  },
  {
    q: "Kenapa pesanan saya masih status Menunggu lama sekali?",
    a: "Status Menunggu berarti pembayaran belum terverifikasi. Untuk transfer, pastikan kamu sudah mengunggah bukti pembayaran. Jika bukti sudah terkirim tapi lama tidak diproses, buat laporan di tab Buat Laporan agar tim mengeceknya.",
  },
  {
    q: "Bagaimana cara pakai voucher diskon?",
    a: "Tidak perlu kode manual — saat memesan, di langkah Rincian Biaya akan muncul daftar voucher aktifmu. Pilih salah satu dan diskon langsung dipotong dari total. Kamu juga bisa menyalin kode voucher di tab Voucher Saya kalau diminta.",
  },
  {
    q: "Bisakah saya membatalkan pesanan yang sudah dibayar?",
    a: "Pembatalan ditangani admin. Sampaikan lewat tab Buat Laporan sebutkan kode pesanan dan alasannya — tim akan memproses dan menginformasikan hasilnya ke emailmu.",
  },
  {
    q: `Kenapa saya harus menilai teknisi?`,
    a: `Penilaianmu membantu teknisi baik mendapat reputasi dan membantu pelanggan lain. Selain itu, menilai pesanan selesai yang berumur lebih dari 3 hari memberimu voucher ${formatRupiah(REVIEW_INCENTIVE_AMOUNT)} otomatis — dashboard bahkan mengingatkanmu dengan banner kalau ada penilaian yang tertunda.`,
  },
  {
    q: "Bagaimana kalau hasil pengerjaan tidak sesuai harapan?",
    a: "Segera buat laporan lewat tab Buat Laporan, pilih pesanan terkait, jelaskan masalahnya (boleh lampirkan detail di catatan). Admin akan meninjau, menindaklanjuti teknisi terkait, dan mengirimkan catatan balasan ke tab Laporan.",
  },
];

export default function PanduanPelangganPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-12">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-11 h-11 rounded-xl bg-brand-tint text-brand flex items-center justify-center">
          <Home size={22} />
        </span>
        <h1 className="font-display text-2xl text-navy">Panduan Pelanggan</h1>
      </div>
      <p className="text-ink-soft mb-8">
        Semua yang perlu kamu tahu untuk memesan lewat Servisin — dari memilih layanan sampai menilai
        teknisi.
      </p>

      {/* CTA cepat */}
      <div className="card !p-4 mb-8 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-navy font-medium">Siap memesan layanan pertamamu?</p>
        <div className="flex gap-2 flex-wrap">
          <Link href="/booking" className="btn-primary !py-2 text-sm flex items-center gap-1.5">
            <Search size={15} /> Buat pesanan
          </Link>
          <Link href="/panduan-teknisi" className="btn-outline !py-2 text-sm">
            Panduan teknisi
          </Link>
        </div>
      </div>

      {/* Langkah-langkah */}
      <div className="space-y-4 mb-12">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="card !p-5">
              <h2 className="font-display font-semibold text-navy mb-2 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0">
                  <Icon size={16} />
                </span>
                {s.title}
              </h2>
              <div className="text-sm text-ink-soft space-y-2 [&_strong]:text-navy [&_em]:text-navy">{s.body}</div>
            </div>
          );
        })}
      </div>

      {/* Peringatan penting */}
      <div className="rounded-xl border-2 border-amber/50 bg-amber-tint px-5 py-4 mb-12 flex gap-3">
        <AlertTriangle size={20} className="text-amber shrink-0 mt-0.5" />
        <div className="text-sm text-navy">
          <p className="font-semibold mb-1">Yang paling sering jadi masalah:</p>
          <ul className="list-disc pl-5 space-y-1 text-ink-soft">
            <li>
              Transfer <strong className="text-navy">tidak sama jumlahnya</strong> dengan tagihan — verifikasi
              jadi lambat. Tagihan = subtotal layanan + {formatRupiah(APP_FEE)} biaya aplikasi − diskon
              voucher.
            </li>
            <li>Lupa mengunggah bukti transfer, sehingga pesanan tidak pernah maju dari status Menunggu.</li>
            <li>
              Tidak menilai teknisi — voucher {formatRupiah(REVIEW_INCENTIVE_AMOUNT)} tidak terbit dan masa
              berlakunya terbatas 90 hari.
            </li>
          </ul>
        </div>
      </div>

      {/* FAQ */}
      <div className="mb-12">
        <h2 className="font-display text-xl text-navy mb-1 flex items-center gap-2">
          <HelpCircle size={20} className="text-brand" /> Pertanyaan yang sering diajukan
        </h2>
        <div className="space-y-3 mt-4">
          {FAQ.map((f) => (
            <details key={f.q} className="card !p-4 cursor-pointer">
              <summary className="font-semibold text-navy text-sm">{f.q}</summary>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </div>

      {/* Bantuan */}
      <div className="card !p-5 text-center">
        <p className="text-sm text-navy font-semibold mb-1">Masih ada yang mengganjal?</p>
        <p className="text-sm text-ink-soft mb-4">
          Sampaikan lewat tab <strong>Buat Laporan</strong> di dashboard, atau hubungi tim lewat halaman
          Tentang Kami.
        </p>
        <Link href="/dashboard" className="btn-primary !py-2 text-sm">
          Buka Dashboard
        </Link>
      </div>
    </div>
  );
}
