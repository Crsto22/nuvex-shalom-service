param(
  [string]$OutDir = "",
  [int]$KeepDays = 7
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $OutDir) { $OutDir = Join-Path $root "backups" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$user = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "nuvex_shalom" }
$db = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "nuvex_shalom" }
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$file = Join-Path $OutDir "shalom-$stamp.sql"

Write-Host "Generando backup: $file"

Push-Location $root
try {
  docker compose exec -T postgres pg_dump -U $user -d $db | Set-Content -Path $file -Encoding utf8
} finally {
  Pop-Location
}

if (-not (Test-Path $file) -or (Get-Item $file).Length -lt 1000) {
  throw "El backup quedo vacio o incompleto: $file"
}

Write-Host ("OK {0:N1} KB" -f ((Get-Item $file).Length / 1KB))

# Retencion
$limit = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem $OutDir -Filter "shalom-*.sql" |
  Where-Object { $_.LastWriteTime -lt $limit } |
  ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-Host "Eliminado por antiguedad: $($_.Name)"
  }
