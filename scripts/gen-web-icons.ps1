# Generate semua ikon web Fixify dari logo master docs/brand/fixify-logo.png.
# Menggantikan generator lama berbasis SVG wrench (gen-favicon.mjs, gen-pwa-icons.mjs).
# Jalankan: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\gen-web-icons.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot   # root repo
$source = Join-Path $root "docs\brand\fixify-logo.png"
$srcImg = [System.Drawing.Image]::FromFile($source)

function Resize-Png([System.Drawing.Image]$img, [int]$size, [single]$zoom) {
    $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $draw = $size * $zoom
    $off = ($size - $draw) / 2
    $g.DrawImage($img, $off, $off, $draw, $draw)
    $g.Dispose()
    return $out
}

function Save-Png($bmp, $path) {
    $dir = Split-Path -Parent $path
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host ("OK {0} ({1} B)" -f $path, (Get-Item $path).Length)
}

# PNG biasa (ikon PWA + favicon PNG): logo penuh
foreach ($spec in @(
    @{ p = "public\icons\icon-192.png";  s = 192; z = 0.92 },
    @{ p = "public\icons\icon-512.png";  s = 512; z = 0.92 },
    @{ p = "public\apple-touch-icon.png"; s = 180; z = 1.0 }   # iOS memotong sudut sendiri -> full-bleed
)) {
    $bmp = Resize-Png $srcImg $spec.s $spec.z
    Save-Png $bmp (Join-Path $root $spec.p)
    $bmp.Dispose()
}

# Maskable: konten 66% agar aman dari mask OS (lingkaran/squircle)
foreach ($s in @(192, 512)) {
    $bmp = Resize-Png $srcImg $s 0.66
    Save-Png $bmp (Join-Path $root "public\icons\icon-maskable-$s.png")
    $bmp.Dispose()
}

# favicon.ico multi-resolusi (16/32/48) dari logo
$icoPath = Join-Path $root "public\favicon.ico"
$mem = New-Object System.IO.MemoryStream
$srcImg.Save($mem, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $mem.ToArray(); $mem.Dispose()

$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
# Header ICO
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]3)   # reserved, type=icon, count=3
$entries = @()
foreach ($s in @(16, 32, 48)) {
    $bmp = Resize-Png $srcImg $s 0.92
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $entries += ,@($s, $ms.ToArray())
    $bmp.Dispose(); $ms.Dispose()
}
$offset = 6 + 16 * 3
foreach ($e in $entries) {
    $bw.Write([byte]$(if ($e[0] -ge 256) { 0 } else { $e[0] }))  # width
    $bw.Write([byte]$e[0])                                        # height
    $bw.Write([byte]0); $bw.Write([byte]0)                        # palette
    $bw.Write([uint16]1); $bw.Write([uint16]32)                   # planes, bpp
    $bw.Write([uint32]$e[1].Length)                               # size
    $bw.Write([uint32]$offset)                                    # offset
    $offset += $e[1].Length
}
foreach ($e in $entries) { $bw.Write($e[1]) }
$bw.Dispose(); $fs.Dispose()
Write-Host ("OK {0} (multi-res 16/32/48)" -f $icoPath)

$srcImg.Dispose()
Write-Host "SELESAI - ikon web Fixify dari logo master."
