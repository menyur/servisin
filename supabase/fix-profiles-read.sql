-- =========================================================
-- PERBAIKAN: pelanggan tidak bisa melihat nama teknisi.
-- Gejala: embed `technician:profiles!...` selalu NULL di
-- dashboard pelanggan -> tab "Beri Penilaian" kosong padahal
-- ada pesanan selesai; struk juga tak bisa menampilkan teknisi.
--
-- Penyebab: RLS tabel `profiles` hanya mengizinkan membaca
-- profil sendiri. Embed profil teknisi pun disaring jadi NULL.
--
-- Solusi: SIAPA PUN (termasuk pengunjung yang belum login) boleh
-- membaca profil ber-role `technician` yang berstatus approved —
-- reputasi teknisi memang halaman publik (/teknisi).
-- Profil non-teknisi (pelanggan, admin) tetap tertutup.
-- Jalankan di SQL Editor. Idempoten.
-- =========================================================

drop policy if exists "technician profiles readable by authenticated" on profiles;
drop policy if exists "approved technician profiles readable by everyone" on profiles;
create policy "approved technician profiles readable by everyone"
  on profiles
  for select
  using (role = 'technician' and approval_status = 'approved');
