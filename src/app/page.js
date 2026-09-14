import Link from "next/link";
import { Search, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CategoryIcon, ServiceIcon } from "@/lib/icons";
import { formatRupiah } from "@/lib/pricing";

export default async function HomePage({ searchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const q = params?.q?.trim() || "";

  const { data: categories } = await supabase.from("categories").select("*").order("sort_order");

  let servicesQuery = supabase.from("services").select("*").eq("is_active", true).order("sort_order");
  if (q) servicesQuery = servicesQuery.ilike("name", `%${q}%`);
  const { data: services } = await servicesQuery;

  const grouped = (categories || []).map((cat) => ({
    ...cat,
    services: (services || []).filter((s) => s.category_id === cat.id),
  }));

  return (
    <div>
      {/* HERO */}
      <section className="bg-brand-tint">
        <div className="max-w-6xl mx-auto px-5 pt-16 pb-14 text-center">
          <span className="pill bg-white text-brand-deep">Platform jasa serba bisa</span>
          <h1 className="font-display text-3xl sm:text-5xl text-navy mt-5 mb-4 leading-tight">
            Butuh bantuan apa hari ini?
          </h1>
          <p className="text-ink-soft max-w-xl mx-auto mb-8">
            Service AC, tukang rumah, dan service kendaraan — booking teknisi terpercaya dalam beberapa menit.
          </p>

          <form action="/" className="max-w-lg mx-auto flex gap-2">
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
        </div>
      </section>

      {/* KATEGORI */}
      <section id="kategori" className="max-w-6xl mx-auto px-5 py-14">
        <h2 className="font-display text-2xl text-navy mb-7">Kategori layanan</h2>
        <div className="grid sm:grid-cols-3 gap-5 mb-14">
          {grouped.map((cat) => (
            <a key={cat.id} href={`#cat-${cat.id}`} className="card hover:border-brand transition group">
              <div className="w-12 h-12 rounded-xl bg-brand-tint text-brand flex items-center justify-center mb-4 group-hover:bg-brand group-hover:text-white transition">
                <CategoryIcon name={cat.icon} size={22} />
              </div>
              <h3 className="font-display font-semibold text-navy mb-1">{cat.name}</h3>
              <p className="text-sm text-ink-soft">{cat.description}</p>
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

            {cat.services.length === 0 ? (
              <p className="text-sm text-ink-soft">Tidak ada layanan yang cocok dengan pencarian.</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {cat.services.map((s) => (
                  <div key={s.id} className="card flex flex-col">
                    <div className="w-11 h-11 rounded-xl bg-brand-tint text-brand flex items-center justify-center mb-3">
                      <ServiceIcon name={s.icon} size={20} />
                    </div>
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
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
