-- =========================================================
-- MIGRASI: BUKU ALAMAT PELANGGAN
--
-- Sebelumnya profil hanya menyimpan SATU alamat (profiles.address). Pelanggan
-- yang punya rumah + kantor harus mengetik ulang alamat kedua setiap memesan.
--
-- Sekarang alamat berlabel disimpan di profiles.saved_addresses (jsonb):
--   [ { "id", "label", "address", "lat", "lng", "is_primary", "created_at" } ]
--
-- Aturan:
--   * maksimal 10 alamat per akun (cukup untuk rumah/kantor/orang tua);
--   * satu alamat ditandai utama; profiles.address SELALU mengikuti alamat
--     utama supaya pengisian otomatis wizard yang lama tetap bekerja;
--   * alamat yang sama (tanpa beda huruf besar/kecil & spasi) tidak
--     diduplikasi — menyimpan ulang hanya memperbarui label/titiknya;
--   * semua tulisan lewat RPC security definer yang memakai auth.uid(),
--     jadi pelanggan tidak bisa menyentuh buku alamat orang lain.
--
-- Idempoten. Jalankan kapan saja setelah schema.sql.
-- =========================================================

alter table public.profiles
  add column if not exists saved_addresses jsonb not null default '[]'::jsonb;

comment on column public.profiles.saved_addresses is
  'Buku alamat pelanggan: [{id,label,address,lat,lng,is_primary,created_at}]. profiles.address = alamat utama.';

do $$
begin
  alter table public.profiles
    add constraint profiles_saved_addresses_array
    check (jsonb_typeof(saved_addresses) = 'array') not valid;
exception when duplicate_object then
  null;
end $$;

-- Pelanggan lama yang sudah punya alamat otomatis mendapat satu entri
-- "Rumah" utama — tanpa ini buku alamatnya kosong padahal alamatnya ada.
update public.profiles p
   set saved_addresses = jsonb_build_array(jsonb_build_object(
         'id', gen_random_uuid()::text,
         'label', 'Rumah',
         'address', btrim(p.address),
         'lat', null,
         'lng', null,
         'is_primary', true,
         'created_at', now()
       ))
 where jsonb_array_length(coalesce(p.saved_addresses, '[]'::jsonb)) = 0
   and coalesce(btrim(p.address), '') <> '';

-- ---------- RPC: simpan / perbarui alamat berlabel ----------
create or replace function public.save_my_address(
  p_label text,
  p_address text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_make_primary boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_addr text := btrim(coalesce(p_address, ''));
  v_list jsonb;
  v_baru jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_id text;
  v_ketemu boolean := false;
  v_primary boolean := false;
  v_jumlah int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if char_length(v_addr) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Alamat terlalu pendek (minimal 5 karakter).');
  end if;
  if char_length(v_addr) > 300 then
    return jsonb_build_object('ok', false, 'error', 'Alamat terlalu panjang (maksimal 300 karakter).');
  end if;
  if v_label = '' then
    v_label := 'Alamat';
  end if;
  if char_length(v_label) > 24 then
    return jsonb_build_object('ok', false, 'error', 'Label alamat maksimal 24 karakter.');
  end if;
  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    return jsonb_build_object('ok', false, 'error', 'Koordinat lokasi tidak valid.');
  end if;
  if p_lng is not null and (p_lng < -180 or p_lng > 180) then
    return jsonb_build_object('ok', false, 'error', 'Koordinat lokasi tidak valid.');
  end if;

  select coalesce(saved_addresses, '[]'::jsonb)
    into v_list
    from public.profiles
   where id = v_uid
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profil tidak ditemukan.');
  end if;

  v_jumlah := jsonb_array_length(v_list);

  -- Alamat yang sama tidak diduplikasi: perbarui label & titiknya saja.
  select elem
    into v_elem
    from jsonb_array_elements(v_list) elem
   where lower(btrim(elem->>'address')) = lower(v_addr)
   limit 1;
  if v_elem is not null then
    v_ketemu := true;
    v_id := v_elem->>'id';
    -- Pertahankan ejaan alamat yang sudah tersimpan: "Jl. Melati" yang
    -- diketik ulang sebagai "jl. melati" tidak boleh mengubah profil jadi
    -- huruf kecil semua hanya karena pengguna mengetik ulang.
    v_addr := coalesce(nullif(btrim(v_elem->>'address'), ''), v_addr);
  else
    if v_jumlah >= 10 then
      return jsonb_build_object('ok', false, 'error', 'Maksimal 10 alamat tersimpan. Hapus salah satu lebih dulu.');
    end if;
    v_id := gen_random_uuid()::text;
  end if;

  v_primary := coalesce(p_make_primary, false)
    or not exists (
      select 1 from jsonb_array_elements(v_list) e
       where coalesce((e->>'is_primary')::boolean, false)
    );

  for v_elem in select value from jsonb_array_elements(v_list)
  loop
    if (v_elem->>'id') = v_id then
      v_baru := v_baru || jsonb_build_array(jsonb_build_object(
        'id', v_id,
        'label', v_label,
        'address', v_addr,
        'lat', p_lat,
        'lng', p_lng,
        'is_primary', v_primary,
        'created_at', coalesce(v_elem->>'created_at', now()::text)
      ));
    elsif v_primary then
      v_baru := v_baru || jsonb_build_array(
        jsonb_set(v_elem, '{is_primary}', 'false'::jsonb, true)
      );
    else
      v_baru := v_baru || jsonb_build_array(v_elem);
    end if;
  end loop;

  if not v_ketemu then
    v_baru := v_baru || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'label', v_label,
      'address', v_addr,
      'lat', p_lat,
      'lng', p_lng,
      'is_primary', v_primary,
      'created_at', now()
    ));
  end if;

  -- profiles.address = alamat utama, supaya pengisian otomatis wizard (dan
  -- pesanan lama) tetap memakai satu sumber yang sama.
  update public.profiles
     set saved_addresses = v_baru,
         address = case when v_primary then v_addr else address end
   where id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'is_primary', v_primary,
    'saved_addresses', v_baru
  );
end $fn$;

-- ---------- RPC: hapus satu alamat ----------
create or replace function public.delete_my_address(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_list jsonb;
  v_baru jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_hapus_primary boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if coalesce(btrim(p_id), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Alamat yang dihapus tidak dikenal.');
  end if;

  select coalesce(saved_addresses, '[]'::jsonb)
    into v_list
    from public.profiles
   where id = v_uid
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profil tidak ditemukan.');
  end if;

  for v_elem in select value from jsonb_array_elements(v_list)
  loop
    if (v_elem->>'id') = p_id then
      v_hapus_primary := coalesce((v_elem->>'is_primary')::boolean, false);
    else
      v_baru := v_baru || jsonb_build_array(v_elem);
    end if;
  end loop;

  if jsonb_array_length(v_baru) = jsonb_array_length(v_list) then
    return jsonb_build_object('ok', false, 'error', 'Alamat itu sudah tidak ada di buku.');
  end if;

  -- Alamat utama dihapus → alamat pertama yang tersisa naik jadi utama dan
  -- profiles.address ikut berganti supaya pengisian otomatis tetap benar.
  if v_hapus_primary and jsonb_array_length(v_baru) > 0 then
    v_baru := jsonb_set(v_baru, '{0,is_primary}', 'true'::jsonb, true);
  end if;

  update public.profiles
     set saved_addresses = v_baru,
         address = case
           when jsonb_array_length(v_baru) = 0 then address
           when v_hapus_primary then v_baru->0->>'address'
           else address
         end
   where id = v_uid;

  return jsonb_build_object('ok', true, 'saved_addresses', v_baru);
end $fn$;

-- ---------- Izin eksekusi ----------
revoke all on function public.save_my_address(text, text, double precision, double precision, boolean) from public, anon, authenticated;
revoke all on function public.delete_my_address(text) from public, anon, authenticated;

grant execute on function public.save_my_address(text, text, double precision, double precision, boolean) to authenticated, service_role;
grant execute on function public.delete_my_address(text) to authenticated, service_role;

-- =========================================================
-- VERIFIKASI (read-only):
--   select column_name from information_schema.columns
--    where table_name='profiles' and column_name='saved_addresses'; -- 1
--   select proname from pg_proc where proname in
--     ('save_my_address','delete_my_address'); -- 2
-- =========================================================
