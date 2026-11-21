param(
    [string]$ProjectDirectory = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = [System.IO.Path]::GetFullPath($ProjectDirectory)
$iconDirectory = Join-Path $projectRoot 'public\icons'
$logoPath = Join-Path $iconDirectory 'mio-logo.jpg'
$image = [System.Drawing.Bitmap]::new($logoPath)

try {
    # Find the coloured mark so the white margins in the supplied JPG do not
    # make the logo too small inside application icons. The original stays intact.
    $left = $image.Width
    $top = $image.Height
    $right = 0
    $bottom = 0
    for ($y = 0; $y -lt $image.Height; $y++) {
        for ($x = 0; $x -lt $image.Width; $x++) {
            $pixel = $image.GetPixel($x, $y)
            $maximum = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
            $minimum = [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))
            if (($maximum - $minimum) -gt 40 -and $minimum -lt 180) {
                $left = [Math]::Min($left, $x)
                $right = [Math]::Max($right, $x)
                $top = [Math]::Min($top, $y)
                $bottom = [Math]::Max($bottom, $y)
            }
        }
    }
    if ($right -le $left -or $bottom -le $top) {
        throw 'The supplied logo must contain a coloured mark.'
    }
    $left = [Math]::Max(0, $left - 8)
    $top = [Math]::Max(0, $top - 8)
    $right = [Math]::Min($image.Width - 1, $right + 8)
    $bottom = [Math]::Min($image.Height - 1, $bottom + 8)
    $sourceRectangle = [System.Drawing.Rectangle]::new($left, $top, $right - $left + 1, $bottom - $top + 1)

    $outputs = @(
        @{ Name = 'mio-logo-square.png'; Size = 512; Fraction = 0.88 },
        @{ Name = 'icon-192.png'; Size = 192; Fraction = 0.88 },
        @{ Name = 'icon-512.png'; Size = 512; Fraction = 0.88 },
        @{ Name = 'maskable-512.png'; Size = 512; Fraction = 0.70 },
        @{ Name = 'apple-touch-icon-180.png'; Size = 180; Fraction = 0.88 }
    )
    foreach ($output in $outputs) {
        $size = [int]$output.Size
        $canvas = [System.Drawing.Bitmap]::new($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($canvas)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $scale = ($size * $output.Fraction) / [Math]::Max($sourceRectangle.Width, $sourceRectangle.Height)
            $width = [int][Math]::Round($sourceRectangle.Width * $scale)
            $height = [int][Math]::Round($sourceRectangle.Height * $scale)
            $destination = [System.Drawing.Rectangle]::new([int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)
            $graphics.DrawImage($image, $destination, $sourceRectangle, [System.Drawing.GraphicsUnit]::Pixel)
            $canvas.Save((Join-Path $iconDirectory $output.Name), [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output ('Created public/icons/' + $output.Name)
        }
        finally {
            $graphics.Dispose()
            $canvas.Dispose()
        }
    }
}
finally {
    $image.Dispose()
}
