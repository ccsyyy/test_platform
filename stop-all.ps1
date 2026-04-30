$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "dev-tools.ps1")

Write-Host "=== Stopping agent ==="

$agentPatterns = @(
  "test_platform\\agent\\dist\\server\.js",
  "test_platform\\agent\\node_modules.+tsx.+src/server\.ts"
)
Stop-ManagedProcessTree -Name "Agent server" -Patterns $agentPatterns | Out-Null

Write-Host ""
Write-Host "=== Stopping backend + worker ==="

$backendPatterns = @(
  "test_platform\\backend\\node_modules.+tsx.+watch src/server\.ts",
  "test_platform\\backend\\node_modules.+tsx.+src/worker/index\.ts"
)
Stop-ManagedProcessTree -Name "Backend dev services" -Patterns $backendPatterns | Out-Null

Write-Host ""
Write-Host "=== All services stopped ==="
