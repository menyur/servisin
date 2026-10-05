# Generate semua aset ikon Fixify dari logo sumber (PNG transparan).
# Pakai System.Drawing .NET - tanpa dependensi tambahan.
# Jalankan: powershell -NoProfile -File flutter_app\tool\gen-icons.ps1
param(
    [string]$Source = "E:\Fixify\ChatGPT Image 24 Sep 2026, 14.06.51.png"
)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent $PSScriptRoot          # flutter_app/
$repo    = Split-Path -Parent $root                  # root repo
$srcImg  = [System.Drawing.Image]::FromFile($Source)

function Resize-Png([System.Drawing.Image]$img, [int]$size, [single]$zoom = 1.0) {
    # Konten logo di-zoom (crop tepi transparan) lalu fit ke square $size.
    $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $drawW = $size * $zoom; $drawH = $size * $zoom
    $x = ($size - $drawW) / 2; $y = ($size - $drawH) / 2
    $g.DrawImage($img, $x, $y, $drawW, $drawH)
    $g.Dispose()
    return $out
}

function Save-Png($bmp, $path) {
    $dir = Split-Path -Parent $path
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host ("OK {0} ({1} B)" -f $path, (Get-Item $path).Length)
}

# ---- 1. Web: favicon + ikon PWA Flutter web (dengan sedikit zoom agar penuh) ----
foreach ($spec in @(
    @{ f = "web\favicon.png";       s = 32  },
    @{ f = "web\icons\Icon-192.png";          s = 192; z = 0.96 },
    @{ f = "web\icons\Icon-512.png";          s = 512; z = 0.96 },
    @{ f = "web\icons\Icon-maskable-192.png"; s = 192; z = 0.78 },
    @{ f = "web\icons\Icon-maskable-512.png"; s = 512; z = 0.78 }
)) {
    $zoom = if ($spec.ContainsKey("z")) { $spec.z } else { 0.92 }
    $bmp = Resize-Png $srcImg $spec.s $zoom
    Save-Png $bmp (Join-Path $root $spec.f)
    $bmp.Dispose()
}

# ---- 2. Android legacy mipmap ic_launcher (rounded sudah di dalam logo) ----
foreach ($pair in @{ "mdpi" = 48; "hdpi" = 72; "xhdpi" = 96; "xxhdpi" = 144; "xxxhdpi" = 192 }.GetEnumerator()) {
    $bmp = Resize-Png $srcImg $pair.Value 0.92
    Save-Png $bmp ("{0}\android\app\src\main\res\mipmap-{1}\ic_launcher.png" -f $root, $pair.Key)
    $bmp.Dispose()
}

# ---- 3. Android adaptive: foreground (logo penuh, aman dari mask) + warna background ----
foreach ($pair in @{ "mdpi" = 108; "hdpi" = 162; "xhdpi" = 216; "xxhdpi" = 324; "xxxhdpi" = 432 }.GetEnumerator()) {
    $bmp = Resize-Png $srcImg $pair.Value 0.62
    Save-Png $bmp ("{0}\android\app\src\main\res\mipmap-{1}\ic_launcher_foreground.png" -f $root, $pair.Key)
    $bmp.Dispose()
}
$bgXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#0880F5</color>
</resources>
"@
Set-Content -Path (Join-Path $root "android\app\src\main\res\values\ic_launcher_background.xml") -Value $bgXml -Encoding UTF8
Write-Host "OK values/ic_launcher_background.xml"

# ---- 4. Logo in-app (login/register/profil) ----
$logo = Resize-Png $srcImg 512 0.98
Save-Png $logo (Join-Path $root "assets\logo.png")
$logo.Dispose()

$srcImg.Dispose()
Write-Host "SELESAI - semua aset ikon Fixify dihasilkan."
