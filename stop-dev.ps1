$ErrorActionPreference = "Stop"

# 停止后台开发服务：API 服务 + 执行 worker。

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "dev-tools.ps1")

$patterns = @(
  "test_platform\\backend\\node_modules.+tsx.+watch src/server\.ts",
  "test_platform\\backend\\node_modules.+tsx.+src/worker/index\.ts"
)

Stop-ManagedProcessTree -Name "Backend dev services" -Patterns $patterns | Out-Null

Write-Host ""
Write-Host "Done."
