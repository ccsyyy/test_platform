$ErrorActionPreference = "Stop"

# 停止本地 Agent 服务。

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "dev-tools.ps1")

$patterns = @(
  "test_platform\\agent\\dist\\server\.js",
  "test_platform\\agent\\node_modules.+tsx.+src/server\.ts"
)

Stop-ManagedProcessTree -Name "Agent server" -Patterns $patterns | Out-Null

Write-Host ""
Write-Host "Done."
