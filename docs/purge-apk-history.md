# Checklist Aman: Pangkas APK dari History Git

> Terakhir diperbarui: 8 Oktober 2026
> Skrip: [scripts/purge-apk-history.sh](../scripts/purge-apk-history.sh)
> Target: menghapus 25 blob APK (~210 MB raw) dari seluruh riwayat → `.git` 247 MB diperkirakan turun ke **±30–60 MB**.

## ⚠️ Konsekuensi yang HARUS dipahami dulu

1. **Semua SHA commit berubah** (rewrite). PR lama di GitHub kehilangan kaitannya; issue yang menyebut SHA lama jadi basi (teks tetap, link mati).
2. **Force push wajib.** Semua clone lain (laptop lain, CI, HP dev) jadi invalid — harus **re-clone**, bukan pull.
3. Commit besar apa pun (selain APK) yang "hilang dari history" tidak bisa dikembalikan kecuali lewat backup bundle yang dibuat skrip di langkah 1.
4. Ini **sekali jalan** — lakukan saat tidak ada aktivitas tim/CI berjalan.

## Pra-syarat (sudah diverifikasi 8 Okt 2026)

- ✅ Hanya 1 branch (`main`), tanpa tag, tanpa stash — rewrite sederhana.
- ✅ 102 commit — `git filter-branch --index-filter` cukup cepat; tidak perlu python.
- ✅ Working tree: **masih ada file modified lama yang belum di-commit** → SKRIP AKAN MENOLAK JALAN sampai di-commit (ini disengaja demi keamanan).

## Urutan eksekusi

### Tahap A — persiapan (Anda)
1. **Commit semua perubahan yang ada sekarang** (≈13 file modified dari sesi-sesi sebelumnya: api.dart, models.dart, jobs_screen.dart, dll.). Jangan stash lupa — stash bisa tercerai-berai saat reset. Commit biasa dengan pesan jelas.
2. Tutup/bersihkan job CI yang berjalan (workflow build-apk bisa di-disable sementara: GitHub → Actions → build-apk.yml → ⋯ → Disable).
3. Pastikan tidak ada orang lain yang akan push selama proses (proyek solo: aman).

### Tahap B — jalankan skrip (boleh saya yang eksekusi kalau diminta)
```bash
bash scripts/purge-apk-history.sh
```
Skrip otomatis: guard clean-tree → backup bundle `../servisin-backup-<timestamp>.bundle` + verify → filter-branch hapus `public/apk` dari semua commit → reflog expire + `git gc --prune=now --aggressive` → verifikasi 0 blob APK → tawarkan re-commit APK versi terbaru (satu commit, file yang sama ditimpa ke depan).

### Tahap C — force push (Anda, manual — sengaja tidak diotomasi)
1. `git push --force origin main`
2. Buka GitHub → repo → ukuran harus turun dalam beberapa menit–jam (GitHub melakukan GC sendiri; link commit lama masih bisa diakses via API/events sampai GC, itu normal).
3. Re-enable workflow build-apk.

### Tahap D — pencegahan (biar tidak membesar lagi)
- APK baru: **timpa file yang sama** (`public/apk/fixify.apk`) per rilis, TANPA menambah nama baru per build (itu penyebab 11 versi arm64 menumpuk), ATAU pindahkan ke Supabase Storage/Release GitHub dan hapus dari repo.
- Pertimbangkan `git lfs` hanya kalau memang tetap butuh versioning biner di git.

## Rollback (kalau ada apa-apa salah)

```bash
git clone ../servisin-backup-<timestamp>.bundle servisin-restored
```
Lalu salin file yang dibutuhkan, atau jadikan remote sementara dan reset ulang.

## Verifikasi setelah semua selesai

```bash
git rev-list --objects --all | grep -icE '\.(apk|aab)$'   # harus 0 (sebelum re-commit)
du -sh .git                                               # diperkirakan 30–60 MB
```
