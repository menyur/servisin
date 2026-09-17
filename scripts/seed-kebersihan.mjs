// One-off seed runner untuk kategori "Kebersihan & Laundry".
// Idempoten: cek dulu by id/name sebelum insert. Tidak pernah mencetak nilai rahasia —
// hanya NAMA key env dan jumlah baris.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// --- muat .env.local manual (diluar Next.js) ---
const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Env yang tersedia:", Object.keys(env).join(", ") || "(kosong)");
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY tidak ditemukan di .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const category = {
  id: "kebersihan",
  name: "Kebersihan & Laundry",
  description: "Bersih rumah, sofa/kasur, dan laundry setrika",
  icon: "brush",
  sort_order: 4,
};

const services = [
  {
    category_id: "kebersihan",
    name: "Bersih Rumah / Apartemen",
    description: "Menyapu, mengepel, merapikan, dan membersihkan kamar mandi.",
    base_price: 150000,
    price_note: "mulai dari",
    duration_estimate: "3-4 jam",
    icon: "home",
    sort_order: 1,
  },
  {
    category_id: "kebersihan",
    name: "Cuci Sofa & Kasur",
    description: "Semprot-vakum, shampo, dan pengeringan sofa/kasur.",
    base_price: 175000,
    price_note: "mulai dari",
    duration_estimate: "2-3 jam",
    icon: "armchair",
    sort_order: 2,
  },
  {
    category_id: "kebersihan",
    name: "Laundry & Setrika Panggilan",
    description: "Cuci, keringkan, lipat, dan setrika di tempat.",
    base_price: 50000,
    price_note: "mulai dari",
    duration_estimate: "per kg / 1-2 hari",
    icon: "shirt",
    sort_order: 3,
  },
];

async function main() {
  // kategori sudah ada?
  const { data: existingCat, error: catErr } = await supabase
    .from("categories")
    .select("id, icon, sort_order")
    .eq("id", category.id)
    .maybeSingle();
  if (catErr) {
    console.error("Gagal membaca categories:", catErr.message);
    process.exit(1);
  }

  if (existingCat) {
    console.log(`Kategori "${category.id}" sudah ada — update icon/sort_order saja.`);
    const { error: updErr } = await supabase
      .from("categories")
      .update({ icon: category.icon, sort_order: category.sort_order, name: category.name, description: category.description })
      .eq("id", category.id);
    if (updErr) {
      console.error("Gagal update kategori (kemungkinan RLS memblokir write dengan anon key):", updErr.message);
      process.exit(2);
    }
  } else {
    const { error: insErr } = await supabase.from("categories").insert(category);
    if (insErr) {
      console.error("Gagal insert kategori (kemungkinan RLS memblokir write dengan anon key):", insErr.message);
      process.exit(2);
    }
    console.log(`Kategori "${category.id}" ditambahkan.`);
  }

  // layanan: cek per nama, insert bila belum ada, update ikon bila sudah ada
  for (const s of services) {
    const { data: existing, error: sErr } = await supabase
      .from("services")
      .select("id, icon")
      .eq("name", s.name)
      .maybeSingle();
    if (sErr) {
      console.error(`Gagal membaca service "${s.name}":`, sErr.message);
      process.exit(1);
    }
    if (existing) {
      if (existing.icon !== s.icon) {
        const { error: uErr } = await supabase.from("services").update({ icon: s.icon }).eq("id", existing.id);
        if (uErr) {
          console.error(`Gagal update ikon service "${s.name}":`, uErr.message);
          process.exit(2);
        }
        console.log(`Service "${s.name}" — ikon di-update ke "${s.icon}".`);
      } else {
        console.log(`Service "${s.name}" sudah ada & lengkap.`);
      }
    } else {
      const { error: iErr } = await supabase.from("services").insert(s);
      if (iErr) {
        console.error(`Gagal insert service "${s.name}":`, iErr.message);
        process.exit(2);
      }
      console.log(`Service "${s.name}" ditambahkan.`);
    }
  }

  // verifikasi akhir
  const { count: svcCount, error: cErr } = await supabase
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("category_id", "kebersihan");
  if (cErr) {
    console.error("Gagal verifikasi:", cErr.message);
    process.exit(1);
  }
  console.log(`Selesai. Kategori "kebersihan" kini punya ${svcCount} layanan.`);
}

main();
