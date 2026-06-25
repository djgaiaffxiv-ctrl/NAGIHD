# NAGIHD — descarga los motores de IA (Real-ESRGAN + RIFE) ncnn-vulkan
# © 2026 NAGI STUDIOS
# Estos binarios son portables, corren en GPU vía Vulkan (NVIDIA/AMD/Intel),
# no necesitan Python ni internet una vez descargados.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root 'bin'
$tmp = Join-Path $env:TEMP ('nagihd_bin_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Get-Tool {
    param(
        [string]$Name,
        [string]$Url,
        [string]$DestSubdir,
        [string]$ExeName
    )
    $destDir = Join-Path $binDir $DestSubdir
    $exePath = Join-Path $destDir $ExeName
    if (Test-Path $exePath) {
        Write-Host "[OK] $Name ya está instalado." -ForegroundColor Green
        return
    }
    Write-Host "[..] Descargando $Name ..." -ForegroundColor Cyan
    $zip = Join-Path $tmp ($DestSubdir + '.zip')
    Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing
    Write-Host "[..] Extrayendo $Name ..." -ForegroundColor Cyan
    $unzipTo = Join-Path $tmp $DestSubdir
    Expand-Archive -Path $zip -DestinationPath $unzipTo -Force

    # El zip puede traer una carpeta raíz; localizamos el .exe y aplanamos.
    $foundExe = Get-ChildItem -Path $unzipTo -Filter $ExeName -Recurse | Select-Object -First 1
    if (-not $foundExe) { throw "No se encontró $ExeName dentro de $Name" }
    $srcDir = $foundExe.Directory.FullName

    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Copy-Item -Path (Join-Path $srcDir '*') -Destination $destDir -Recurse -Force
    Write-Host "[OK] $Name instalado en $destDir" -ForegroundColor Green
}

Write-Host "==== NAGIHD :: instalando motores de IA ====" -ForegroundColor Magenta

# Real-ESRGAN ncnn-vulkan (escalado con IA + modelos anime/general/video)
Get-Tool -Name 'Real-ESRGAN' `
    -Url 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip' `
    -DestSubdir 'realesrgan' `
    -ExeName 'realesrgan-ncnn-vulkan.exe'

# RIFE ncnn-vulkan (interpolación de fotogramas — sube los FPS)
Get-Tool -Name 'RIFE' `
    -Url 'https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-windows.zip' `
    -DestSubdir 'rife' `
    -ExeName 'rife-ncnn-vulkan.exe'

# Limpieza
Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "==== Listo. Motores instalados en bin\ ====" -ForegroundColor Magenta
Write-Host "Real-ESRGAN modelos disponibles:" -ForegroundColor Gray
Get-ChildItem (Join-Path $binDir 'realesrgan\models') -Filter '*.param' -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host ("  - " + $_.BaseName) -ForegroundColor Gray }
