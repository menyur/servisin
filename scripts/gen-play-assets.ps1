# ============================================================================
# gen-play-assets.ps1 — hasilkan aset listing Google Play dari berkas merek
# yang sudah ada di repo, supaya aset toko tidak pernah "hasil desain manual"
# yang tak bisa dibuat ulang.
#
# Hasil (store/play/):
#   icon-512.png               — ikon aplikasi Play (WAJIB 512x512, PNG 32-bit,
#                                tanpa transparansi/alpha di area ikon)
#   feature-graphic-1024x500.png — banner toko (WAJIB 1024x500, tanpa teks kecil)
#
# Pemakaian (Windows, tanpa dependensi tambahan — memakai System.Drawing):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-play-assets.ps1
#
# Sumber gambar: docs/brand/fixify-logo.png + public/icons/icon-512.png.
# Skrip GAGAL bila sumber tidak ada atau hasilnya tidak berukuran tepat —
# lebih baik tahu di sini daripada ditolak Play Console saat unggah.
# ============================================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'store/play'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$logoSrc = Join-Path $root 'docs/brand/fixify-logo.png'
$iconSrc = Join-Path $root 'public/icons/icon-512.png'
foreach ($p in @($logoSrc, $iconSrc)) {
  if (-not (Test-Path $p)) { throw "Sumber gambar tidak ada: $p" }
}

# Warna merek — HARUS sama dengan tailwind.config.js (navy/brand/paper).
$navy = [System.Drawing.ColorTranslator]::FromHtml('#0B3556')
$brand = [System.Drawing.ColorTranslator]::FromHtml('#1C86C7')
$brandLight = [System.Drawing.ColorTranslator]::FromHtml('#6FC3E8')
$tint = [System.Drawing.ColorTranslator]::FromHtml('#EAF6FC')
$white = [System.Drawing.Color]::White

function Get-FontFamily {
  param([string[]]$Kandidat)
  $terpasang = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
  foreach ($k in $Kandidat) { if ($terpasang -contains $k) { return $k } }
  return 'Arial'
}

function New-RoundedPath {
  param([System.Drawing.RectangleF]$Rect, [float]$Radius)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $Radius * 2
  $p.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
  $p.AddArc($Rect.Right - $d, $Rect.Y, $d, $d, 270, 90)
  $p.AddArc($Rect.Right - $d, $Rect.Bottom - $d, $d, $d, 0, 90)
  $p.AddArc($Rect.X, $Rect.Bottom - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# ---------- 1) Ikon 512x512 (tanpa alpha: Play menolaknya) ----------
$icon = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($icon)
$g.Clear($white)
$g.InterpolationMode = 'HighQualityBicubic'
$src = [System.Drawing.Image]::FromFile($iconSrc)
$g.DrawImage($src, 0, 0, 512, 512)
$src.Dispose()
$g.Dispose()
$iconPath = Join-Path $outDir 'icon-512.png'
$icon.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Dispose()

# ---------- 2) Feature graphic 1024x500 ----------
$W = 1024; $H = 500
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'HighQuality'
$g.InterpolationMode = 'HighQualityBicubic'
$g.TextRenderingHint = 'AntiAliasGridFit'

# Latar gradien navy → brand (sudut 20°) + dua lingkaran cahaya lembut.
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $navy, $brand, 20.0
$g.FillRectangle($grad, $rect)
$grad.Dispose()

$glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(46, $brandLight))
$g.FillEllipse($glow, 700, -140, 520, 520)
$g.FillEllipse($glow, 860, 260, 320, 320)
$glow.Dispose()

# Logo (dibuat sedikit lebih kecil dari tinggi banner supaya ada margin aman).
$logo = [System.Drawing.Image]::FromFile($logoSrc)
$logoSize = 268
$g.DrawImage($logo, 76, [int](($H - $logoSize) / 2), $logoSize, $logoSize)
$logo.Dispose()

$namaFont = Get-FontFamily @('Segoe UI Semibold', 'Segoe UI', 'Arial')
$fontJudul = New-Object System.Drawing.Font $namaFont, 68, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontTag = New-Object System.Drawing.Font $namaFont, 26, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fontPil = New-Object System.Drawing.Font $namaFont, 20, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$brushPutih = New-Object System.Drawing.SolidBrush $white
$brushLembut = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(226, $tint))
$brushPil = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, 255, 255, 255))
$brushPilTeks = New-Object System.Drawing.SolidBrush $white

$g.DrawString('Fixify', $fontJudul, $brushPutih, 388, 118)
$g.DrawString('Teknisi terpercaya, datang ke lokasi', $fontTag, $brushLembut, 392, 204)

# Pil kategori — menegaskan cakupan layanan tanpa teks kecil.
$x = 392
foreach ($label in @('Service AC', 'Tukang Rumah', 'Servis Kendaraan')) {
  $ukur = $g.MeasureString($label, $fontPil)
  $pw = [int]$ukur.Width + 34
  $ph = 42
  $phRect = New-Object System.Drawing.RectangleF $x, 268, $pw, $ph
  $path = New-RoundedPath -Rect $phRect -Radius 21
  $g.FillPath($brushPil, $path)
  $g.DrawString($label, $fontPil, $brushPilTeks, ($x + 17), 277)
  $path.Dispose()
  $x += $pw + 14
}

# Catatan kecil di dasar banner (tetap di dalam area aman 80px).
$fontKecil = New-Object System.Drawing.Font $namaFont, 18, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$brushKecil = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(170, $tint))
$g.DrawString('Pelanggan & teknisi terverifikasi · pembayaran aman · garansi pekerjaan', $fontKecil, $brushKecil, 392, 404)

foreach ($o in @($fontJudul, $fontTag, $fontPil, $fontKecil, $brushPutih, $brushLembut, $brushPil, $brushPilTeks, $brushKecil)) { $o.Dispose() }
$g.Dispose()
$fgPath = Join-Path $outDir 'feature-graphic-1024x500.png'
$bmp.Save($fgPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# ---------- Pemeriksaan ukuran hasil ----------
function Assert-Ukuran {
  param([string]$Path, [int]$W, [int]$H)
  $img = [System.Drawing.Image]::FromFile($Path)
  $ok = ($img.Width -eq $W -and $img.Height -eq $H)
  $info = "$([System.IO.Path]::GetFileName($Path)) $($img.Width)x$($img.Height)"
  $img.Dispose()
  if (-not $ok) { throw "Ukuran salah: $info (harus ${W}x${H})" }
  Write-Output "OK  $info"
}

Assert-Ukuran $iconPath 512 512
Assert-Ukuran $fgPath 1024 500
Write-Output "Aset Play tersimpan di store/play/"
