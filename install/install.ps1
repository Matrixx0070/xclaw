# XClaw — Windows PowerShell install helper
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Root) { $Root = Get-Location }
Set-Location $Root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node required: >=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0"
  Write-Host "23.x is blocked. Install from https://nodejs.org"
  exit 1
}
& node --input-type=module -e @"
import { describeHost, hostCompatBanner } from './src/runtime/host-compat.mjs';
const h = describeHost();
if (!h.allowed) { console.error(hostCompatBanner(h)); process.exit(1); }
console.log('[xclaw] node=v' + h.raw + ' band=' + h.band);
"@
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[xclaw] root=$Root"

if (-not (Test-Path .env) -and (Test-Path .env.example)) {
  Copy-Item .env.example .env
  Write-Host "[xclaw] wrote .env from example"
}
if (-not (Test-Path deploy/.env) -and (Test-Path deploy/env.example)) {
  Copy-Item deploy/env.example deploy/.env
  Write-Host "[xclaw] wrote deploy/.env from env.example"
}

$initArgs = @("--yes", "--profile", $(if ($env:XCLAW_PROFILE) { $env:XCLAW_PROFILE } else { "lab" }))
if ($env:XCLAW_MODEL) { $initArgs += @("--model", $env:XCLAW_MODEL) }
$key = $env:XAI_API_KEY; if (-not $key) { $key = $env:XCLAW_API_KEY }; if (-not $key) { $key = $env:OPENAI_API_KEY }
if ($key) { $initArgs += @("--api-key", $key) }

Write-Host "[xclaw] running init…"
& node src/cli/init.mjs @initArgs

Write-Host ""
Write-Host "Verify:"
Write-Host "  node bin/xclaw.mjs doctor"
Write-Host "  node bin/xclaw.mjs gateway"
Write-Host "  open http://127.0.0.1:18790/chat/"
Write-Host ""
Write-Host "Docker try-me:"
Write-Host "  cd deploy; docker compose up --build"
