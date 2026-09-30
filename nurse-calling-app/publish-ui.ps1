<#
  Builds care-call-ui as a Next.js standalone tree and zips it as UI-prod.zip
  for manual copy to C:\care-call\ on the server (PM2 runs UI-prod\server.js).

  Run from this folder in PowerShell:
      powershell -ExecutionPolicy Bypass -File .\publish-ui.ps1

  Every gate from the publish procedure is enforced; the script stops on the
  first failure and nothing is zipped.
#>
param(
  [string]$ApiUrl = 'http://20.163.9.187:5001',
  # BUILD_ID currently live on the server - a new build must differ from it.
  [string]$LiveBuildId = 'muY6wZI4jSB9sUhdZjZbz',
  # Only pass this if you have decided to ship lockfile versions that differ from the server's.
  [switch]$AllowVersionMismatch
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Fail([string]$msg) { Write-Host "FAIL: $msg" -ForegroundColor Red; exit 1 }
function Pass([string]$msg) { Write-Host "PASS: $msg" -ForegroundColor Green }

# --- Pre-build conditions ----------------------------------------------------

# Node 22.x, matching the server's 22.18.0
$nodeVersion = (node -v).Trim()
if ($nodeVersion -notmatch '^v22\.') { Fail "Node $nodeVersion - Node 22.x is required (server runs v22.18.0)." }
Pass "Node $nodeVersion"

# next.config.ts must produce a standalone build with server.js at the root
$config = Get-Content 'next.config.ts' -Raw
if ($config -notmatch 'output:\s*"standalone"') { Fail 'next.config.ts is missing output: "standalone".' }
if ($config -notmatch 'outputFileTracingRoot:\s*path\.join\(__dirname\)') { Fail 'next.config.ts is missing outputFileTracingRoot: path.join(__dirname).' }
Pass 'next.config.ts has output: "standalone" and outputFileTracingRoot'

# Locked versions must match what the server runs
$expected = [ordered]@{ 'next' = '15.5.20'; 'react' = '19.2.7'; 'react-dom' = '19.2.7'; 'typescript' = '5.9.3' }
# Read with node: Windows PowerShell's ConvertFrom-Json rejects the lockfile's empty "" package key.
$lockedJson = node -e "const p=require('./package-lock.json').packages;const o={};for(const n of process.argv.slice(1))o[n]=(p['node_modules/'+n]||{}).version||'';console.log(JSON.stringify(o))" $expected.Keys
if ($LASTEXITCODE -ne 0) { Fail 'Could not read package-lock.json.' }
$lock = $lockedJson | ConvertFrom-Json
$mismatch = @()
foreach ($name in $expected.Keys) {
  $locked = $lock.$name
  if ($locked -ne $expected[$name]) { $mismatch += "$name locked $locked, server $($expected[$name])" }
}
if ($mismatch.Count -gt 0) {
  if (-not $AllowVersionMismatch) { Fail ("package-lock.json differs from the server:`n  " + ($mismatch -join "`n  ") + "`n  Re-run with -AllowVersionMismatch only if shipping these versions is intended.") }
  Write-Host ("WARN: shipping versions that differ from the server:`n  " + ($mismatch -join "`n  ")) -ForegroundColor Yellow
} else {
  Pass 'package-lock.json versions match the server'
}

# The API URL is inlined into the client bundle at build time. A process env var
# takes precedence over .env.local, so this wins even if .env.local says otherwise.
$env:NEXT_PUBLIC_API_URL = $ApiUrl
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
if (Test-Path '.env.local') {
  $envLine = Select-String -Path '.env.local' -Pattern '^\s*NEXT_PUBLIC_API_URL\s*=\s*(.*)$' | Select-Object -Last 1
  if ($envLine -and $envLine.Matches[0].Groups[1].Value.Trim() -ne $ApiUrl) {
    Write-Host "WARN: .env.local has $($envLine.Matches[0].Groups[1].Value.Trim()); the build uses $ApiUrl from the environment." -ForegroundColor Yellow
  }
}
Pass "NEXT_PUBLIC_API_URL = $ApiUrl"

# --- Install, type-check, build ----------------------------------------------

npm ci
if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed.' }

# Report type errors but do not fix app code during a publish.
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
  Fail "tsc reported errors. Do not fix app code during a publish: add typescript: { ignoreBuildErrors: true } to next.config.ts, keep the error list above, and re-run."
}
Pass 'tsc --noEmit clean'

# npx next build, not npm run build (that script asks for 8 GB of heap).
Remove-Item '.next' -Recurse -Force -ErrorAction SilentlyContinue
npx next build
if ($LASTEXITCODE -ne 0) { Fail 'next build failed.' }

# --- Assemble deploy tree ------------------------------------------------------

$deploy = Join-Path $PWD 'deploy'
Remove-Item $deploy -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $deploy -Force | Out-Null
Copy-Item '.next\standalone\*' $deploy -Recurse -Force
# standalone omits .next/static and public - copy both in by hand
New-Item -ItemType Directory "$deploy\.next\static" -Force | Out-Null
Copy-Item '.next\static\*' "$deploy\.next\static" -Recurse -Force
Copy-Item 'public' $deploy -Recurse -Force
# Never ship local env files; the API URL is already baked into the bundle.
Get-ChildItem $deploy -Filter '.env*' -Force | Remove-Item -Force

# --- Gates: all six must pass -------------------------------------------------

if (-not (Test-Path "$deploy\server.js")) { Fail 'deploy\server.js missing (nested standalone layout).' }
Pass 'server.js at deploy root'

if (-not (Test-Path "$deploy\.next\BUILD_ID")) { Fail '.next\BUILD_ID missing - not a production build.' }
$buildId = (Get-Content "$deploy\.next\BUILD_ID" -Raw).Trim()
if ($buildId -eq $LiveBuildId) { Fail "BUILD_ID $buildId equals the live build." }
Pass "BUILD_ID $buildId"

$staticCount = (Get-ChildItem "$deploy\.next\static" -Recurse -File).Count
if ($staticCount -eq 0) { Fail '.next\static is empty.' }
Pass ".next\static has $staticCount files"

if (Get-ChildItem "$deploy\.next\static" -Directory | Where-Object Name -eq 'development') { Fail ".next\static contains 'development' - dev build." }
Pass "no 'development' folder in .next\static"

$js = Get-ChildItem "$deploy\.next\static" -Recurse -Filter *.js
$urlPattern = [regex]::Escape(([uri]$ApiUrl).Host)
$apiHits = @($js | Select-String -Pattern $urlPattern -List).Count
if ($apiHits -lt 1) { Fail "API host not found in client chunks." }
Pass "API host found in $apiHits chunk(s)"

$badHits = @($js | Select-String -Pattern 'undefined/api|localhost:5001' -List)
if ($badHits.Count -gt 0) { Fail ("'undefined/api' or 'localhost:5001' found in:`n  " + (($badHits | ForEach-Object { $_.Path }) -join "`n  ")) }
Pass "no 'undefined/api' or 'localhost:5001' in client chunks"

# --- Zip (contents at archive root) -------------------------------------------

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $PWD 'UI-prod.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
[IO.Compression.ZipFile]::CreateFromDirectory($deploy, $zip)

$arch = $env:PROCESSOR_ARCHITECTURE
Write-Host ''
Write-Host ("{0:N2} MB -> $zip" -f ((Get-Item $zip).Length / 1MB)) -ForegroundColor Cyan
Write-Host "Built on Windows $arch, Node $nodeVersion, BUILD_ID $buildId" -ForegroundColor Cyan
Write-Host 'Copy UI-prod.zip to C:\care-call\ on the server.' -ForegroundColor Cyan
