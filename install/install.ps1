# XClaw — Windows PowerShell install helper
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Root) { $Root = Get-Location }
Set-Location $Root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js >= 22 required. Install from https://nodejs.org"
  exit 1
}
$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt 22) {
  Write-Host "Node $major detected — need >= 22"
  exit 1
}

Write-Host "[xclaw] root=$Root"
Write-Host "[xclaw] node=$(node -v)"

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
