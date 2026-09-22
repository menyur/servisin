import Link from "next/link";
import { Search, ArrowRight } from "lucide-react";
import InstallBanner from "@/components/InstallBanner";
import { getLandingData } from "@/lib/queries";
import { CategoryIcon, ServiceIcon } from "@/lib/icons";
import { HeroIllustration, CategoryThumb, ServiceThumb, TrustFast, TrustPro, TrustPrice, EmptyBoxIllustration, AcHeaderIllustration } from "@/components/Illustrations";
import { formatRupiah } from "@/lib/pricing";

const CATEGORY_HEADERS = {
  ac: AcHeaderIllustration,
};

export default async function HomePage({ searchParams }) {
  const params = await searchParams;
  const q = params?.q?.trim() || "";

  const { categories, services } = await getLandingData(q);

  const grouped = categories.map((cat) => ({
    ...cat,
    services: (services || []).filter((s) => s.category_id === cat.id),
  }));

  return (
    <div>
      {/* HERO */}
      <section className="bg-brand-tint overflow-hidden">
        <div className="max-w-6xl mx-auto px-5 pt-14 pb-16 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            {/* banner unduh aplikasi — hanya mobile & belum terinstall */}
            <InstallBanner />
            <span className="pill bg-white text-brand-deep">Platform jasa serba bisa</span>
            <h1 className="font-display text-3xl sm:text-5xl text-navy mt-5 mb-4 leading-tight">
              Butuh bantuan apa hari ini?
            </h1>
            <p className="text-ink-soft max-w-lg mb-8">
              Service AC, tukang rumah, dan service kendaraan — booking teknisi terpercaya dalam beberapa menit, langsung datang ke lokasi kamu.
            </p>

            <form action="/" className="max-w-lg flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" size={18} />
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Cari layanan, misal: cuci AC, ganti oli..."
                  className="input !pl-11 !bg-white"
                />
              </div>
              <button className="btn-primary" type="submit">Cari</button>
            </form>

            <div className="flex gap-6 mt-8 text-sm text-ink-soft">
              <span><strong className="text-navy">4</strong> kategori layanan</span>
              <span><strong className="text-navy">19+</strong> jenis servis</span>
              <span><strong className="text-navy">Hari yang sama</strong> teknisi datang</span>
            </div>
          </div>

          <div className="max-w-md mx-auto lg:max-w-none">
            <HeroIllustration />
          </div>
        </div>
      </section>

      {/* KENAPA SERVISIN */}
      <section className="max-w-6xl mx-auto px-5 py-14 grid sm:grid-cols-3 gap-5">
        <div className="card flex flex-col items-center text-center gap-3">
          <div className="w-24"><TrustFast /></div>
          <h3 className="font-display font-semibold text-navy">Datang tepat waktu</h3>
          <p className="text-sm text-ink-soft">Pilih jam kedatangan, teknisi siap datang di hari yang sama.</p>
        </div>
        <div className="card flex flex-col items-center text-center gap-3">
          <div className="w-24"><TrustPro /></div>
          <h3 className="font-display font-semibold text-navy">Teknisi terverifikasi</h3>
          <p className="text-sm text-ink-soft">
            Semua teknisi melewati kurasi &amp; penilaian dari pelanggan lain.{' '}
            <Link href="/teknisi" className="text-brand font-semibold hover:underline">
              Lihat rating mereka →
            </Link>
          </p>
        </div>
        <div className="card flex flex-col items-center text-center gap-3">
          <div className="w-24"><TrustPrice /></div>
          <h3 className="font-display font-semibold text-navy">Harga transparan</h3>
          <p className="text-sm text-ink-soft">Harga tercantum jelas di awal, tanpa biaya tersembunyi.</p>
        </div>
      </section>

      {/* KATEGORI */}
      <section id="kategori" className="max-w-6xl mx-auto px-5 py-14">
        <h2 className="font-display text-2xl text-navy mb-7">Kategori layanan</h2>
        <div className="grid sm:grid-cols-3 gap-5 mb-16">
          {grouped.map((cat) => (
            <a key={cat.id} href={`#cat-${cat.id}`} className="card !p-0 overflow-hidden hover:border-brand transition group">
              <div className="h-24">
                <CategoryThumb categoryId={cat.id} className="w-full h-full" />
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-1.5">
                  <CategoryIcon name={cat.icon} size={16} className="text-brand" />
                  <h3 className="font-display font-semibold text-navy">{cat.name}</h3>
                </div>
                <p className="text-sm text-ink-soft">{cat.description}</p>
              </div>
            </a>
          ))}
        </div>

        {grouped.map((cat) => (
          <div key={cat.id} id={`cat-${cat.id}`} className="mb-14 scroll-mt-24">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center">
                <CategoryIcon name={cat.icon} size={18} />
              </div>
              <h3 className="font-display text-xl text-navy">{cat.name}</h3>
            </div>

            {CATEGORY_HEADERS[cat.id] && (
              <div className="rounded-2xl overflow-hidden border border-line shadow-sm mb-6">
                {(() => { const Header = CATEGORY_HEADERS[cat.id]; return <Header />; })()}
              </div>
            )}

            {cat.services.length === 0 ? (
              <div className="card flex flex-col items-center text-center py-8 gap-2">
                <div className="w-44"><EmptyBoxIllustration /></div>
                <p className="text-sm text-ink-soft">Tidak ada layanan yang cocok dengan pencarian.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {cat.services.map((s) => (
                  <div key={s.id} className="card !p-0 overflow-hidden flex flex-col">
                    <div className="h-24 relative">
                      <ServiceThumb categoryId={s.category_id} icon={s.icon} imageUrl={s.image_url} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-4 translate-y-1/2 w-11 h-11 rounded-xl bg-white shadow flex items-center justify-center text-brand border border-line">
                        <ServiceIcon name={s.icon} size={20} />
                      </div>
                    </div>
                    <div className="p-5 pt-8 flex flex-col flex-1">
                      <h4 className="font-display font-semibold text-navy mb-1.5">{s.name}</h4>
                      <p className="text-sm text-ink-soft flex-1 min-h-[40px]">{s.description}</p>
                      <div className="flex items-baseline justify-between my-3">
                        <span className="text-xs text-ink-soft">{s.price_note}</span>
                        <span className="font-display font-bold text-brand text-lg">{formatRupiah(s.base_price)}</span>
                      </div>
                      <p className="text-xs text-ink-soft mb-4">Estimasi: {s.duration_estimate}</p>
                      <Link href={`/booking?service=${s.id}`} className="btn-outline w-full">
                        Pesan sekarang <ArrowRight size={16} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
