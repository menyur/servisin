-- =========================================================
-- MIGRASI: approval_status untuk pendaftar teknisi
-- Jalankan di Supabase SQL Editor (aman dijalankan berulang).
-- Teknisi baru = 'pending' menunggu persetujuan admin;
-- customer & admin = 'approved'.
-- =========================================================

alter table profiles add column if not exists approval_status
  text not null default 'approved';

-- rapikan nilai di luar constraint (jaga-jaga) sebelum pasang check
update profiles set approval_status = 'approved'
where approval_status not in ('pending', 'approved', 'rejected');

alter table profiles drop constraint if exists profiles_approval_status_check;
alter table profiles add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

-- pendaftar teknisi yang sudah terlanjur ada sebelum kolom ini: jadikan pending
update profiles set approval_status = 'pending'
where role = 'technician' and approval_status = 'approved'
  and created_at > now() - interval '30 days';

-- trigger status awal
create or replace function set_initial_approval_status()
returns trigger as $$
begin
  if new.role = 'technician' then
    new.approval_status := 'pending';
  else
    new.approval_status := 'approved';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists trg_set_approval_status on profiles;
create trigger trg_set_approval_status
  before insert on profiles
  for each row execute function set_initial_approval_status();

-- verifikasi
select role, approval_status, count(*) from profiles group by 1, 2 order by 1, 2;
