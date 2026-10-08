#!/usr/bin/env bash
# ============================================================================
# purge-apk-history.sh — pangkas SEMUA APK dari riwayat git (history rewrite)
#
# MENGHAPUS dari seluruh history (semua commit):
#   public/apk/*.apk   (25 blob: fixify-arm64/armv7a ×11, fixify.apk, servisin.apk)
# File APK di working tree TIDAK disentuh — tetap ada di disk, tinggal
# di-commit ulang sebagai 1 commit segar (lihat docs/purge-apk-history.md).
#
# ⚠️  REWRITE HISTORY: SEMUA commit SHA berubah. Wajib force push setelahnya.
#     Jalankan HANYA setelah membaca checklist di docs/purge-apk-history.md.
#
# Pemakaian:
#   bash scripts/purge-apk-history.sh          # mode interaktif (ada konfirmasi)
#   bash scripts/purge-apk-history.sh --yes    # tanpa konfirmasi (untuk CI/otomatis)
#
# Prefensi mesin: python/git-filter-repo TIDAK ada di mesin ini → skrip
# memakai `git filter-branch --index-filter` (built-in, cukup untuk 102 commit).
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

TS="$(date +%Y%m%d-%H%M%S)"
APK_PATHS=( "public/apk/fixify-arm64.apk" "public/apk/fixify-armv7a.apk" "public/apk/fixify.apk" "public/apk/servisin.apk" )
BACKUP="../servisin-backup-${TS}.bundle"
YES=0
[[ "${1:-}" == "--yes" ]] && YES=1

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
say "0) Pra-cek"
# ---------------------------------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || { echo "BATAL: harus di branch main (sekarang: $BRANCH)"; exit 1; }

# Guard: working tree harus bersih dari perubahan TERTRACK (untracked bebas).
# Kalau tidak, reset/gc pasca-rewrite bisa memakan perubahan yang belum di-commit.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "BATAL: ada perubahan tracked yang belum di-commit."
  echo "Commit dulu (disarankan) atau git stash, lalu jalankan ulang skrip ini."
  git status --porcelain | grep -v '^??' | head -20
  exit 1
fi

COUNT="$(git rev-list --count HEAD)"
echo "Branch: $BRANCH · commit: $COUNT · 25 blob APK akan dihapus dari history"

if [[ $YES -ne 1 ]]; then
  read -r -p "Lanjut rewrite history? (ketik PURGE untuk lanjut): " CONFIRM
  [[ "$CONFIRM" == "PURGE" ]] || { echo "Batal."; exit 1; }
fi

# ---------------------------------------------------------------------------
say "1) Backup penuh (bundle) — jalan pintas kalau ada apa-apa"
# ---------------------------------------------------------------------------
git bundle create "$BACKUP" --all
echo "Backup dibuat: $BACKUP ($(du -h "$BACKUP" | cut -f1))"
# Verifikasi bundle bisa dibaca:
git bundle verify "$BACKUP" >/dev/null
echo "Bundle terverifikasi ✅  (restore: git clone '$BACKUP' servisin-restored)"

# ---------------------------------------------------------------------------
say "2) Rewrite: hapus public/apk/*.apk dari SEMUA commit"
# ---------------------------------------------------------------------------
# --index-filter: tidak menyentuh working tree, hanya index per commit.
# Tag/filter khusus tidak dipakai; --prune-empty buang commit yang kosong.
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch \
  --index-filter 'git rm -r --cached --ignore-unmatch public/apk' \
  --prune-empty \
  --tag-name-filter cat \
  -- --all

# ---------------------------------------------------------------------------
say "3) Bersihkan reflog & object lama (barulah .git mengecil)"
# ---------------------------------------------------------------------------
rm -rf .git/refs/original
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# ---------------------------------------------------------------------------
say "4) Verifikasi"
# ---------------------------------------------------------------------------
LEFT="$(git rev-list --objects --all | grep -icE '\.(apk|aab)$' || true)"
echo "Blob APK tersisa di history: $LEFT (harus 0)"
[[ "$LEFT" == "0" ]] || { echo "⚠️  Masih ada sisa! JANGAN push. Cek: git rev-list --objects --all | grep -iE '\\.apk$'"; exit 1; }

NEW_SIZE="$(du -sh .git | cut -f1)"
echo "Ukuran .git sekarang: $NEW_SIZE (sebelumnya 247M)"

# ---------------------------------------------------------------------------
say "5) Re-commit APK versi terbaru (1 commit segar) — OPSIONAL"
# ---------------------------------------------------------------------------
if compgen -G "public/apk/*.apk" > /dev/null; then
  echo "File APK di working tree masih ada:"
  ls -lh public/apk/
  read -r -p "Commit ulang APK versi terbaru sekarang? (y/N): " READD
  if [[ "$READD" == "y" ]]; then
    git add public/apk
    git commit -m "chore: re-add APK unduhan versi terbaru (single latest, tanpa duplikat history)"
    echo "✅ APK ter-commit ulang sebagai versi terbaru saja."
  fi
fi

# ---------------------------------------------------------------------------
say "SELESAI — lanjut ke checklist force push di docs/purge-apk-history.md"
# ---------------------------------------------------------------------------
echo "Ringkasan:"
echo "  - Backup bundle : $BACKUP"
echo "  - Remote        : $(git remote get-url origin)"
echo "  - Force push    : git push --force origin main   (BACA CHECKLIST DULU)"
