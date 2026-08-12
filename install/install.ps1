# XClaw R6 — Windows PowerShell install helper
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

Write-Host ""
Write-Host "Next:"
Write-Host '  $env:XAI_API_KEY="xai-..."'
Write-Host "  node bin/xclaw.mjs doctor"
Write-Host "  node bin/xclaw.mjs gateway"
Write-Host "  open http://127.0.0.1:18790/chat/"
