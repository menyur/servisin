import Link from "next/link";
import { ArrowRight, MapPin, Phone, Mail, Clock, ShieldCheck, HeartHandshake, Leaf, HardHat, BadgeCheck, Wallet, CalendarClock } from "lucide-react";
import { HeroIllustration, TrustFast, TrustPro, TrustPrice, AvatarRaka, AvatarSari, AvatarBima } from "@/components/Illustrations";

export const metadata = {
  title: "Tentang Kami — Fixify",
  description: "Kenali Fixify: misi, nilai, dan cara kami menghubungkan kamu dengan teknisi terpercaya di seluruh Indonesia.",
};

const STATS = [
  { value: "4", label: "kategori layanan" },
  { value: "19+", label: "jenis servis" },
  { value: "Hari yang sama", label: "teknisi datang" },
];

const VALUES = [
  {
    icon: ShieldCheck,
    title: "Aman & terpercaya",
    desc: "Setiap teknisi melewati kurasi identitas, verifikasi keahlian, dan penilaian berkelanjutan dari pelanggan.",
  },
  {
    icon: HeartHandshake,
    title: "Melayani dengan hati",
    desc: "Kami percaya pekerjaan rumah tangga adalah urusan serius. Karena itu setiap detail kami perhatikan.",
  },
  {
    icon: Leaf,
    title: "Jujur & transparan",
    desc: "Harga tercantum jelas sejak awal, tanpa biaya tersembunyi. Kalau ada tambahan, dikonfirmasi dulu di lokasi.",
  },
];

export default function TentangPage() {
  return (
    <div>
      {/* HERO */}
      <section className="bg-brand-tint overflow-hidden">
        <div className="max-w-6xl mx-auto px-5 pt-14 pb-16 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <span className="pill bg-white text-brand-deep">Tentang Fixify</span>
            <h1 className="font-display text-3xl sm:text-5xl text-navy mt-5 mb-4 leading-tight">
              Rumah kamu, urusan kami.
            </h1>
            <p className="text-ink-soft max-w-lg mb-8">
              Fixify lahir dari satu pengamatan sederhana: mencari teknisi yang andal itu susah.
              Kami merapikan semuanya — satu platform untuk Service AC, tukang rumah, service kendaraan,
              hingga kebersihan — dengan teknisi terkurasi dan harga yang jelas sejak awal.
            </p>
            <div className="flex gap-6 text-sm text-ink-soft">
              {STATS.map((s) => (
                <span key={s.label}>
                  <strong className="text-navy">{s.value}</strong> {s.label}
                </span>
              ))}
            </div>
          </div>
          <div className="max-w-md mx-auto lg:max-w-none">
            <HeroIllustration />
          </div>
        </div>
      </section>

      {/* MISI */}
      <section className="max-w-6xl mx-auto px-5 py-14">
        <h2 className="font-display text-2xl text-navy mb-4">Misi kami</h2>
        <p className="text-ink-soft max-w-3xl text-lg leading-relaxed">
          Menghubungkan jutaan rumah tangga Indonesia dengan teknisi terampil di daerahnya — cepat,
          aman, dan dengan harga yang bisa dipahami siapa pun — lewat platform pemesanan yang
          sederhana: <em>pilih layanan, tentukan jadwal, teknisi datang.</em>
        </p>
      </section>

      {/* NILAI */}
      <section className="max-w-6xl mx-auto px-5 pb-4">
        <h2 className="font-display text-2xl text-navy mb-7">Nilai yang kami pegang</h2>
        <div className="grid sm:grid-cols-3 gap-5">
          {VALUES.map((v) => {
            const Icon = v.icon;
            return (
              <div key={v.title} className="card">
                <div className="w-10 h-10 rounded-xl bg-brand-tint text-brand flex items-center justify-center mb-4">
                  <Icon size={20} />
                </div>
                <h3 className="font-display font-semibold text-navy mb-1.5">{v.title}</h3>
                <p className="text-sm text-ink-soft">{v.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CARA KERJA */}
      <section className="max-w-6xl mx-auto px-5 py-14">
        <div className="card bg-white !p-8">
          <h2 className="font-display text-2xl text-navy mb-6">Cara kerja kami</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { n: "1", t: "Pilih layanan", d: "Jelajahi kategori dan jenis servis dengan harga tercantum jelas." },
              { n: "2", t: "Tentukan jadwal", d: "Pilih tanggal dan jam kedatangan — teknisi datang di hari yang sama bila slot tersedia." },
              { n: "3", t: "Dikerjakan & bayar", d: "Pantau status pesanan secara real-time, bayar lewat QRIS, VA, e-wallet, atau tunai." },
            ].map((s) => (
              <div key={s.n}>
                <div className="w-9 h-9 rounded-full bg-brand text-white font-display font-bold flex items-center justify-center mb-3">{s.n}</div>
                <h3 className="font-display font-semibold text-navy mb-1.5">{s.t}</h3>
                <p className="text-sm text-ink-soft">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link href="/#kategori" className="btn-primary">
              Mulai dari beranda <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* CERITA PENDIRI */}
      <section className="max-w-6xl mx-auto px-5 pb-4">
        <div className="card bg-white !p-8">
          <h2 className="font-display text-2xl text-navy mb-4">Dari satu perbaikan AC yang gagal</h2>
          <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-center">
            <div className="space-y-4 text-ink-soft leading-relaxed">
              <p>
                Tahun 2024, Raka menunggu teknisi AC yang dijanjikan datang pukul 10 pagi. Hanya satu yang muncul: panas matahari
                terik, janji lewat chat yang tidak pernah dibalas, dan tagihan yang berubah tanpa pemberitahuan.
              </p>
              <p>
                Bersama Sari, ia mulai bertanya-tanya: kenapa memesan mobil atau makanan bisa serapat itu, sementara mencari
                teknisi andal masih seperti undian? Fixify dibangun dari sana — dengan janji sederhana: harga yang tertulis
                jelas sejak awal, jadwal yang ditepati, dan teknisi yang benar-benar terkurasi.
              </p>
              <p className="font-semibold text-navy">
                Hari itu juga kami tetapkan: setiap pesanan harus bisa dilacak, dan setiap teknisi harus punya nama baik yang
                bisa dijaga.
              </p>
            </div>
            <div className="w-44 shrink-0 mx-auto">
              <AvatarRaka />
            </div>
          </div>
        </div>
      </section>

      {/* TIM */}
      <section className="max-w-6xl mx-auto px-5 py-14">
        <h2 className="font-display text-2xl text-navy mb-7">Orang-orang di baliknya</h2>
        <div className="grid sm:grid-cols-3 gap-5">
          <div className="card flex flex-col items-center text-center">
            <div className="w-32 mb-4"><AvatarRaka /></div>
            <h3 className="font-display font-semibold text-navy">Raka Pratama</h3>
            <p className="text-xs font-semibold text-brand uppercase tracking-wide mb-2">Co-founder & CEO</p>
            <p className="text-sm text-ink-soft">
              Mantan insinyur perangkat lunak yang tumbuh di keluarga tukang. Percaya teknologi harus mempermudah pekerjaan
              tangan, bukan menggantikannya.
            </p>
          </div>
          <div className="card flex flex-col items-center text-center">
            <div className="w-32 mb-4"><AvatarSari /></div>
            <h3 className="font-display font-semibold text-navy">Sari Wulandari</h3>
            <p className="text-xs font-semibold text-brand uppercase tracking-wide mb-2">Co-founder & Operasional</p>
            <p className="text-sm text-ink-soft">
              Mengurus kurasi teknisi dan kualitas layanan. Membangun sistem penilaian yang membuat teknisi baik makin
              bersinar — dan yang buruk tidak lolos.
            </p>
          </div>
          <div className="card flex flex-col items-center text-center">
            <div className="w-32 mb-4"><AvatarBima /></div>
            <h3 className="font-display font-semibold text-navy">Bima Nugraha</h3>
            <p className="text-xs font-semibold text-brand uppercase tracking-wide mb-2">Kepala Teknisi</p>
            <p className="text-sm text-ink-soft">
              15 tahun di lapangan sebelum bergabung. Melatih semua teknisi Fixify dan menetapkan standar pengerjaan yang
              kami janjikan ke pelanggan.
            </p>
          </div>
        </div>
      </section>

      {/* REKRUTMEN TEKNISI */}
      <section className="max-w-6xl mx-auto px-5 pb-16">
        <div className="rounded-2xl bg-navy text-white p-8 sm:p-10 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-48 opacity-20 pointer-events-none">
            <AvatarBima />
          </div>
          <div className="relative max-w-2xl">
            <span className="pill bg-white/10 text-sky">Karier di lapangan</span>
            <h2 className="font-display text-2xl sm:text-3xl mt-4 mb-3">Gabung jadi teknisi Fixify</h2>
            <p className="text-white/80 mb-6">
              Kamu punya keahlian — kami punya pesanannya. Dapatkan pelanggan di sekitarmu, atur jadwalmu sendiri,
              dan tumbuh bersama platform yang menghargai kerja tanganmu.
            </p>
            <ul className="grid sm:grid-cols-3 gap-4 mb-8">
              {[{ icon: CalendarClock, t: "Jadwal fleksibel" }, { icon: Wallet, t: "Bayar transparan tiap minggu" }, { icon: BadgeCheck, t: "Pelatihan & sertifikasi gratis" }].map((b) => {
                const Icon = b.icon;
                return (
                  <li key={b.t} className="flex items-center gap-2.5 text-sm text-white/90">
                    <span className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0"><Icon size={15} /></span>
                    {b.t}
                  </li>
                );
              })}
            </ul>
            <Link href="/gabung" className="btn-primary !bg-sky !hover:bg-brand-deep">
              <HardHat size={16} /> Daftar jadi teknisi
            </Link>
          </div>
        </div>
      </section>

      {/* KONTAK */}
      <section className="max-w-6xl mx-auto px-5 pb-16">
        <h2 className="font-display text-2xl text-navy mb-7">Hubungi kami</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="card flex items-start gap-3">
            <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0"><MapPin size={16} /></span>
            <span>
              <span className="block font-semibold text-navy text-sm mb-1">Alamat</span>
              <span className="block text-xs text-ink-soft">Jl. Merdeka No. 88, Jakarta Pusat, Indonesia 10110</span>
            </span>
          </div>
          <div className="card flex items-start gap-3">
            <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0"><Phone size={16} /></span>
            <span>
              <span className="block font-semibold text-navy text-sm mb-1">Telepon / WA</span>
              <span className="block text-xs text-ink-soft">+62 812-0000-0000</span>
            </span>
          </div>
          <div className="card flex items-start gap-3">
            <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0"><Mail size={16} /></span>
            <span>
              <span className="block font-semibold text-navy text-sm mb-1">Email</span>
              <span className="block text-xs text-ink-soft">halo@fixify.id</span>
            </span>
          </div>
          <div className="card flex items-start gap-3">
            <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0"><Clock size={16} /></span>
            <span>
              <span className="block font-semibold text-navy text-sm mb-1">Jam operasional</span>
              <span className="block text-xs text-ink-soft">Senin–Minggu, 08.00–17.00 WIB</span>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
