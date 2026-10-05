#!/usr/bin/env bash
# ============================================================================
# backup-keystore.sh — Backup & pemulihan release keystore Fixify
# ============================================================================
# Mengenkripsi fixify-release.keystore + key.properties menjadi SATU file
# backup terenkripsi (AES-256-CBC, PBKDF2 600k iterasi), sehingga cukup
# DIINGAT SATU passphrase backup untuk memulihkan semuanya.
#
# Pemakaian:
#   bash backup-keystore.sh backup [-o file-backup.enc]
#   bash backup-keystore.sh restore file-backup.enc [-o folder-tujuan]
#
# Passphrase diambil dari env FIXIFY_BACKUP_PASS bila ada, kalau tidak
# akan diminta interaktif (tidak ditampilkan saat diketik).
#
# File backup hasilnya AMAN untuk disimpan di mana saja (cloud/drive) —
# tanpa passphrase isinya tidak bisa dibuka. Tetap simpan passphrase di
# password manager, BUKAN di file yang sama.
#
# Panduan lengkap: docs/keystore-recovery.md (di root repo).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYSTORE="$SCRIPT_DIR/fixify-release.keystore"
KEY_PROPS="$SCRIPT_DIR/key.properties"

CIPHER_OPTS=(-aes-256-cbc -pbkdf2 -iter 600000 -salt)

die() { echo "ERROR: $*" >&2; exit 1; }

usage() { grep '^#   bash' "$0" | sed 's/^# *//'; exit 1; }

# Ambil passphrase: env FIXIFY_BACKUP_PASS atau prompt interaktif (2x).
get_passphrase() {
  if [ -n "${FIXIFY_BACKUP_PASS:-}" ]; then
    PASS_PHRASE="$FIXIFY_BACKUP_PASS"
    return
  fi
  printf 'Passphrase backup: ' >&2
  read -rs PASS_PHRASE; echo >&2
  printf 'Ulangi passphrase : ' >&2
  read -rs PASS2; echo >&2
  [ "$PASS_PHRASE" = "$PASS2" ] || die "Passphrase tidak sama."
  [ ${#PASS_PHRASE} -ge 8 ] || die "Passphrase minimal 8 karakter."
}

# Cetak subject + fingerprint SHA-256 sertifikat di dalam keystore.
print_cert_info() {
  local ks="$1" pass="$2"
  local pem
  pem="$(openssl pkcs12 -in "$ks" -nokeys -clcerts -passin "pass:$pass" 2>/dev/null)" || return 1
  printf '%s' "$pem" | openssl x509 -noout -subject -fingerprint -sha256 2>/dev/null
}

cmd_backup() {
  local out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -o) out="$2"; shift 2 ;;
      *) die "Argumen tak dikenal: $1" ;;
    esac
  done

  [ -f "$KEYSTORE" ] || die "Keystore tidak ditemukan: $KEYSTORE"
  [ -f "$KEY_PROPS" ] || die "key.properties tidak ditemukan: $KEY_PROPS"

  local store_pass
  store_pass="$(sed -n 's/^storePassword=//p' "$KEY_PROPS" | tr -d '\r\n')"
  [ -n "$store_pass" ] || die "storePassword kosong di key.properties."

  # Pastikan keystore bisa dibuka dengan password yang tercatat.
  local cert_info
  cert_info="$(print_cert_info "$KEYSTORE" "$store_pass")" || \
    die "Keystore tidak bisa dibuka dengan storePassword di key.properties."

  get_passphrase

  out="${out:-$SCRIPT_DIR/fixify-keystore-backup-$(date +%Y%m%d).enc}"

  # RECOVERY.txt ikut dienkripsi: mencatat kapan & sertifikat apa.
  local tmp; tmp="$(mktemp -d)"
  {
    echo "Fixify release keystore — dibackup $(date -u '+%Y-%m-%d %H:%M UTC')"
    echo "$cert_info"
    echo "Pulihkan dengan: bash backup-keystore.sh restore <file-ini>"
  } > "$tmp/RECOVERY.txt"
  cp "$KEYSTORE" "$KEY_PROPS" "$tmp/"

  # Enkripsi: tar (keystore + key.properties + RECOVERY.txt) → openssl.
  BP="$PASS_PHRASE" tar -C "$tmp" -cf - RECOVERY.txt fixify-release.keystore key.properties \
    | BP="$PASS_PHRASE" openssl enc "${CIPHER_OPTS[@]}" -pass env:BP -out "$out"
  rm -rf "$tmp"

  # Verifikasi: dekripsi ulang & bandingkan byte-per-byte dengan aslinya.
  local vtmp; vtmp="$(mktemp -d)"
  BP="$PASS_PHRASE" openssl enc -d "${CIPHER_OPTS[@]}" -pass env:BP -in "$out" \
    | tar -C "$vtmp" -xf -
  cmp -s "$vtmp/fixify-release.keystore" "$KEYSTORE" || { rm -rf "$vtmp"; die "Verifikasi gagal — backup TIDAK valid."; }
  cmp -s "$vtmp/key.properties" "$KEY_PROPS" || { rm -rf "$vtmp"; die "Verifikasi key.properties gagal."; }
  rm -rf "$vtmp"

  echo ""
  echo "✓ Backup valid & terverifikasi: $out"
  echo "  SHA-256 file backup :"
  sha256sum "$out" | sed 's/^/    /'
  echo "$cert_info" | sed 's/^/  /'
  echo ""
  echo "Simpan:"
  echo "  1. File backup di ≥2 tempat (cloud pribadi, drive eksternal)."
  echo "  2. Passphrase di password manager — JANGAN di file yang sama."
}

cmd_restore() {
  local src="" dest="$SCRIPT_DIR"
  while [ $# -gt 0 ]; do
    case "$1" in
      -o) dest="$2"; shift 2 ;;
      *) if [ -z "$src" ]; then src="$1"; shift; else die "Argumen tak dikenal: $1"; fi ;;
    esac
  done
  [ -n "$src" ] || usage
  [ -f "$src" ] || die "File backup tidak ditemukan: $src"

  get_passphrase

  echo "Memulihkan ke: $dest"
  local tmp; tmp="$(mktemp -d)"
  if ! BP="$PASS_PHRASE" openssl enc -d "${CIPHER_OPTS[@]}" -pass env:BP -in "$src" \
       | tar -C "$tmp" -xf -; then
    rm -rf "$tmp"; die "Dekripsi gagal — passphrase salah atau file rusak."
  fi
  [ -f "$tmp/fixify-release.keystore" ] || { rm -rf "$tmp"; die "Keystore tidak ada di dalam backup."; }

  # Tampilkan identitas sertifikat yang dipulihkan.
  local pass
  pass="$(sed -n 's/^storePassword=//p' "$tmp/key.properties" | tr -d '\r\n')"
  if cert_info="$(print_cert_info "$tmp/fixify-release.keystore" "$pass")"; then
    echo "$cert_info" | sed 's/^/  /'
  else
    echo "  (PERINGATAN: keystore tidak bisa dibuka dengan password di backup!)" >&2
  fi

  [ -f "$tmp/RECOVERY.txt" ] && sed 's/^/  info: /' "$tmp/RECOVERY.txt"

  # Jangan menimpa tanpa konfirmasi bila sudah ada keystore di tujuan.
  if [ -f "$dest/fixify-release.keystore" ]; then
    printf '\n%s sudah ada. Timpa? [y/N] ' "$dest/fixify-release.keystore" >&2
    read -r ans
    [ "${ans:-n}" = "y" ] || { rm -rf "$tmp"; echo "Dibatalkan."; exit 0; }
  fi

  cp "$tmp/fixify-release.keystore" "$dest/" && cp "$tmp/key.properties" "$dest/"
  rm -rf "$tmp"
  echo ""
  echo "✓ Keystore & key.properties dipulihkan ke $dest"
  echo "  Build ulang APK akan memakai sertifikat di atas."
}

case "${1:-}" in
  backup)  shift; cmd_backup "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  *)       usage ;;
esac
