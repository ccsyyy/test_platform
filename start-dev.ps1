$ErrorActionPreference = "Stop"

# 启动后台开发服务：API 服务 + 执行 worker。

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "dev-tools.ps1")

$backendDir = Join-Path $root "backend"
$logsDir = Join-Path $backendDir "logs"

if (-not (Test-Path $backendDir)) {
  throw "Backend directory not found: $backendDir"
}

Start-ManagedProcess `
  -Name "Backend server" `
  -WorkingDirectory $backendDir `
  -NpmScript "dev" `
  -Patterns @("test_platform\\backend\\node_modules.+tsx.+watch src/server\.ts") `
  -StdoutFile (Join-Path $logsDir "dev-server.out.log") `
  -StderrFile (Join-Path $logsDir "dev-server.err.log") | Out-Null

Start-ManagedProcess `
  -Name "Execution worker" `
  -WorkingDirectory $backendDir `
  -NpmScript "worker:dev" `
  -Patterns @("test_platform\\backend\\node_modules.+tsx.+src/worker/index\.ts") `
  -StdoutFile (Join-Path $logsDir "worker-dev.out.log") `
  -StderrFile (Join-Path $logsDir "worker-dev.err.log") | Out-Null

Write-Host ""
Write-Host "Done."
Write-Host "Server logs:  $logsDir\\dev-server.out.log"
Write-Host "Worker logs:  $logsDir\\worker-dev.out.log"
