import Link from "next/link";
import {
  BadgeCheck,
  ClipboardList,
  PlayCircle,
  CheckCircle2,
  Star,
  FileBarChart,
  FilePlus2,
  Wallet,
  HelpCircle,
  MessageSquareWarning,
  ChevronRight,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import { computeSplit, formatRupiah, DEFAULT_COMMISSION_RATE } from "@/lib/pricing";

export const metadata = {
  title: "Panduan Teknisi — Servisin",
  description:
    "Cara menggunakan Servisin untuk teknisi: memahami tugas masuk, mengubah status pekerjaan, membuat laporan, memahami komisi, dan menjaga rating.",
};

const STEPS = [
  {
    icon: BadgeCheck,
    title: "1. Pastikan akunmu sudah disetujui",
    body: (
      <>
        <p>
          Setelah mendaftar lewat halaman <strong>Gabung jadi teknisi</strong>, pendaftaranmu ditinjau admin.
          Status di panel admin: <em>pending</em> (menunggu), <em>approved</em> (disetujui), atau <em>rejected</em>.
          Kamu baru bisa menerima tugas setelah <strong>disetujui</strong>.
        </p>
        <p>
          Belum dikonfirmasi lewat email? Minta admin mengaktifkannya lewat Supabase → Authentication → Users.
        </p>
      </>
    ),
  },
  {
    icon: ClipboardList,
    title: "2. Cek tugas masuk di \u201CTugas Saya\u201D",
    body: (
      <>
        <p>
          Setiap kali admin menugaskan kamu, kamu menerima email notifikasi berisi kode pesanan, layanan,
          nama & telepon pelanggan, jadwal, dan alamat. Semua tugas aktif juga selalu terlihat di halaman{" "}
          <strong>Tugas Saya</strong> — dibagi dua daftar: <strong>pekerjaan aktif</strong> dan{" "}
          <strong>riwayat</strong> (selesai/dibatalkan).
        </p>
        <p>Baca catatan pelanggan dengan teliti sebelum berangkat — itu bagian dari keluhan yang harus diselesaikan.</p>
      </>
    ),
  },
  {
    icon: PlayCircle,
    title: "3. Perbarui status pekerjaan",
    body: (
      <>
        <p>Alur status pesanan yang kamu kendalikan dari tugas kamu:</p>
        <p className="flex items-center gap-2 flex-wrap my-2 font-semibold text-navy">
          <span className="pill bg-brand-tint text-brand-deep">Dibayar</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-brand-tint text-brand-deep">Dikerjakan</span>
          <ChevronRight size={14} className="text-ink-soft" />
          <span className="pill bg-mint-tint text-mint">Selesai</span>
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Dikerjakan</strong> — klik saat kamu tiba di lokasi dan mulai bekerja.</li>
          <li><strong>Selesai</strong> — klik hanya setelah pekerjaan benar-benar rampung dan sudah dikonfirmasi pelanggan. Saat status menjadi selesai, struk PDF otomatis dikirim ke email pelanggan.</li>
        </ul>
        <p>
          Pesanan COD? Tagih pembayaran tunai sesuai total di struk sebelum menekan <strong>Selesai</strong>.
        </p>
      </>
    ),
  },
  {
    icon: MessageSquareWarning,
    title: "4. Buat laporan bila ada kendala",
    body: (
      <>
        <p>
          Ada masalah di lapangan — pelanggan tidak di rumah, perangkat rusak parah, butuh sparepart, atau
          ada keluhan terhadap pelanggan? Gunakan tab <strong>Laporan Pekerjaan</strong>: pilih pesanan
          terkait, tulis judul dan rincian, lalu kirim. Laporanmu langsung terlihat oleh admin dan akan
          ditindaklanjuti (kamu mendapat catatan balasan di tab <strong>Laporan</strong> bila sudah diproses).
        </p>
      </>
    ),
  },
  {
    icon: FileBarChart,
    title: "5. Pantau pendapatan di tab Laporan",
    body: (
      <>
        <p>
          Tab <strong>Laporan</strong> merangkum semua pekerjaan selesaimu: total pendapatan kotor,{" "}
          <strong>potongan komisi platform</strong>, dan <strong>pendapatan bersih</strong> per bulan.
          Persentase komisimu ditentukan admin (dapat dilihat efeknya langsung di rincian).
        </p>
      </>
    ),
  },
  {
    icon: Star,
    title: "6. Jaga ratingmu",
    body: (
      <>
        <p>
          Setelah pesanan selesai, pelanggan menilai kamu 1–5 bintang (boleh plus komentar). Rating rata-rata
          dan jumlah ulasanmu tampil di halaman <strong>Tugas Saya</strong>, terlihat oleh admin saat membagi
          tugas, dan <strong>tampil publik di halaman \u201CTeknisi Kami\u201D</strong> — calon pelanggan bisa
          melihatnya sebelum memesan. Datang tepat waktu, kerjakan rapi, dan komunikasikan dengan baik adalah
          cara paling ampuh menjaganya.
        </p>
      </>
    ),
  },
];

const FAQ = [
  {
    q: "Kenapa tugas baru tidak muncul di Tugas Saya?",
    a: "Pastikan akunmu sudah disetujui admin dan sudah login dengan email yang benar. Tugas hanya muncul setelah admin menugaskan kamu pada pesanan tertentu. Coba juga muat ulang halaman.",
  },
  {
    q: "Apa bedanya status \u201CDibayar\u201D dan \u201CDikerjakan\u201D?",
    a: "\u201CDibayar\u201D artinya pembayaran pelanggan sudah dikonfirmasi — kamu boleh berangkat sesuai jadwal. \u201CDikerjakan\u201D artinya kamu sudah tiba dan sedang mengerjakan. Jangan menekan Selesai sebelum pekerjaan rampung.",
  },
  {
    q: "Bagaimana kalau pelanggan memesan tapi tidak ada di lokasi?",
    a: "Tunggu sesuai jendela jam kedatangan (maksimal 30 menit), hubungi telepon pelanggan, lalu buat Laporan Pekerjaan agar admin membantu menindaklanjuti atau menjadwalkan ulang.",
  },
  {
    q: "Bagaimana cara kerja komisi?",
    a: `Dari setiap pekerjaan selesai, platform memotong komisi (default ${DEFAULT_COMMISSION_RATE}%, bisa berbeda per teknisi — ditentukan admin). Sisanya adalah pendapatan bersihmu, terlihat di tab Laporan. Contoh: pekerjaan ${formatRupiah(100000)} dengan komisi ${DEFAULT_COMMISSION_RATE}% → bersih ${formatRupiah(computeSplit(100000).net)}.`,
  },
  {
    q: "Apakah pelanggan bisa melihat ulasan untuk saya?",
    a: "Ya. Rating rata-rata dan ulasan asli (hanya dari pesanan selesai) tampil publik di halaman Teknisi Kami dan di profil detailmu. Ulasan tidak bisa dibuat palsu karena hanya terbit dari pesanan yang benar-benar dikerjakan.",
  },
  {
    q: "Pesanan saya dibatalkan — apakah tetap dibayar?",
    a: "Pesanan yang dibatalkan sebelum dikerjakan tidak dihitung sebagai pendapatan. Bila pembatalan terjadi karena hal di luar kendalimu, sampaikan lewat Laporan Pekerjaan agar admin meninjau.",
  },
];

export default function PanduanTeknisiPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-12">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-11 h-11 rounded-xl bg-amber-tint text-amber flex items-center justify-center">
          <Wrench size={22} />
        </span>
        <h1 className="font-display text-2xl text-navy">Panduan Teknisi</h1>
      </div>
      <p className="text-ink-soft mb-8">
        Semua yang perlu kamu tahu untuk bekerja dengan Servisin — dari tugas masuk sampai pendapatan.
      </p>

      {/* CTA cepat */}
      <div className="card !p-4 mb-8 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-navy font-medium">Sudah disetujui dan siap bekerja?</p>
        <div className="flex gap-2 flex-wrap">
          <Link href="/technician" className="btn-primary !py-2 text-sm flex items-center gap-1.5">
            <ClipboardList size={15} /> Buka Tugas Saya
          </Link>
          <Link href="/gabung" className="btn-outline !py-2 text-sm">
            Daftar jadi teknisi
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
                <span className="w-8 h-8 rounded-lg bg-amber-tint text-amber flex items-center justify-center shrink-0">
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
            <li>Tekan <strong className="text-navy">Selesai</strong> sebelum pekerjaan benar-benar rampung.</li>
            <li>Pesanan COD — lupa memastikan pembayaran tunai diterima.</li>
            <li>Tidak membuat laporan ketika ada kendala, sehingga admin tidak bisa membantu.</li>
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
          Sampaikan lewat menu <strong>Laporan Pekerjaan</strong> di aplikasi, atau hubungi tim lewat halaman Tentang Kami.
        </p>
        <Link href="/technician" className="btn-primary !py-2 text-sm">
          Kembali ke Tugas Saya
        </Link>
      </div>
    </div>
  );
}
