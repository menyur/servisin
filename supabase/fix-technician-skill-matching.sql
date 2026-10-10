-- =========================================================
-- FIX: PENCOCOKAN KEAHLIAN TEKNISI (label lama -> id kategori)
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- MASALAH yang ditemukan di produksi (9 Okt 2026):
--   RPC available_jobs()/available_jobs_nearby()/claim_job() memfilter
--   pekerjaan lewat technician_matches_service(), yang membandingkan
--     services.category_id = profiles.skill
--   dengan asumsi profiles.skill berisi ID kategori ('ac'|'tukang'|
--   'kendaraan'|'kebersihan'). Namun baris lama bisa berisi LABEL
--   ('Service AC'), sehingga helper selalu false ->
--     * daftar "Tersedia" KOSONG untuk teknisi itu,
--     * push "pekerjaan baru" tak pernah sampai,
--     * klaim ditolak walau pekerjaan cocok.
--   Inilah sebab "teknisi tidak otomatis dapat pesanan" walau area &
--   keahliannya sesuai — tanpa kaitan apa pun dengan penugasan admin.
--
-- PERBAIKAN:
--   1) Normalisasi nilai skill warisan: LABEL -> categories.id.
--   2) technician_matches_service() dibuat TOLERAN: cocok bila nilai
--      skill sama dengan ID kategori ATAU NAMA kategori
--      (case-insensitive). Karena helper ini dipakai ketiga RPC,
--      aturan baru otomatis berlaku tanpa membuat ulang RPC-nya.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Normalisasi nilai skill warisan ke categories.id.
--    Nilai yang SUDAH berupa id kategori tidak disentuh.
-- ---------------------------------------------------------

-- 1a) Cocok persis dengan nama kategori (mis. 'Service AC' -> 'ac').
update profiles p
   set skill = c.id
  from categories c
 where p.role = 'technician'
   and p.skill is not null
   and btrim(p.skill) <> ''
   and not exists (select 1 from categories x where x.id = btrim(p.skill))
   and lower(btrim(p.skill)) = lower(btrim(c.name));

-- 1b) Sisa label bebas: cocokkan lewat kata kunci label pendaftaran.
--     Kata kunci tak dikenal DIBIARKAN apa adanya (bukan di-null-kan)
--     supaya teknisi tak tiba-tiba menerima SEMUA pekerjaan.
update profiles
   set skill = case
     when lower(skill) like 'service ac%' then 'ac'
     when lower(skill) like 'service kendaraan%' then 'kendaraan'
     when lower(skill) like 'kebersihan%' then 'kebersihan'
     when lower(skill) like '%tukang%' then 'tukang'
     else skill
   end
 where role = 'technician'
   and skill is not null
   and not exists (select 1 from categories x where x.id = btrim(skill));

-- ---------------------------------------------------------
-- 2) Helper pencocokan yang toleran (id ATAU nama kategori).
--    Aturan sama dengan klien Flutter (models.dart:
--    skillMatchesCategory) dan filter push web (src/lib/skill-match.js).
-- ---------------------------------------------------------
create or replace function technician_matches_service(p_tech uuid, p_service uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(btrim((select skill from profiles where id = p_tech)), ''), '') = ''
      or exists (
           select 1
             from services s
             join categories c on c.id = s.category_id
            where s.id = p_service
              and (
                c.id = btrim((select skill from profiles where id = p_tech))
                or lower(btrim(c.name)) =
                   lower(btrim((select skill from profiles where id = p_tech)))
              )
         )
$$;

-- Hak eksekusi helper tetap seperti semula (dijalankan dari dalam RPC
-- security definer; tidak ada perubahan GRANT di sini).

-- =========================================================
-- VERIFIKASI setelah dijalankan:
--
--   a) Tidak ada lagi skill teknisi berupa label yang bisa dipetakan:
--      select p.skill, count(*) from profiles p
--       where p.role='technician' and p.skill is not null
--         and not exists (select 1 from categories c where c.id = btrim(p.skill))
--       group by 1;
--      -- Baris yang tersisa = nilai benar-benar tak dikenal (perbaiki
--      -- manual lewat panel admin / SQL), bukan label standar.
--
--   b) Helper toleran id maupun nama (dua-duanya harus true):
--      select technician_matches_service(
--               (select id from profiles where role='technician' limit 1),
--               (select id from services order by id limit 1));
--
--   c) Smoke test daftar lowongan (harus memuat pekerjaan kategori
--      yang cocok dengan skill teknisi):
--      -- jalankan dari sesi teknisi:
--      select count(*) from available_jobs();
-- =========================================================

do $$
begin
  raise notice 'OK: pencocokan keahlian teknisi kini toleran terhadap ID maupun LABEL kategori.';
end $$;
