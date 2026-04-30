$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "dev-tools.ps1")

$backendDir  = Join-Path $root "backend"
$agentDir    = Join-Path $root "agent"
$backendLogs = Join-Path $backendDir "logs"
$agentLogs   = Join-Path $agentDir   "logs"

if (-not (Test-Path $backendDir)) {
  throw "Backend directory not found: $backendDir"
}
if (-not (Test-Path $agentDir)) {
  throw "Agent directory not found: $agentDir"
}

Write-Host "=== Starting backend + worker ==="

Start-ManagedProcess `
  -Name "Backend server" `
  -WorkingDirectory $backendDir `
  -NpmScript "dev" `
  -Patterns @("test_platform\\backend\\node_modules.+tsx.+watch src/server\.ts") `
  -StdoutFile (Join-Path $backendLogs "dev-server.out.log") `
  -StderrFile (Join-Path $backendLogs "dev-server.err.log") | Out-Null

Start-ManagedProcess `
  -Name "Execution worker" `
  -WorkingDirectory $backendDir `
  -NpmScript "worker:dev" `
  -Patterns @("test_platform\\backend\\node_modules.+tsx.+src/worker/index\.ts") `
  -StdoutFile (Join-Path $backendLogs "worker-dev.out.log") `
  -StderrFile (Join-Path $backendLogs "worker-dev.err.log") | Out-Null

Write-Host ""
Write-Host "=== Starting agent ==="

$agentPatterns = @(
  "test_platform\\agent\\dist\\server\.js",
  "test_platform\\agent\\node_modules.+tsx.+src/server\.ts"
)
$existingAgent = Find-ProcessByPattern -Patterns $agentPatterns
if ($existingAgent) {
  Write-Host "Agent server is already running (PID $($existingAgent.ProcessId))."
} else {
  Ensure-LogsDirectory -Path $agentLogs
  Push-Location $agentDir
  try {
    & npm.cmd run build
    $process = Start-Process `
      -FilePath "node" `
      -ArgumentList (Join-Path $agentDir "dist\server.js") `
      -WorkingDirectory $agentDir `
      -RedirectStandardOutput (Join-Path $agentLogs "agent-dev.out.log") `
      -RedirectStandardError  (Join-Path $agentLogs "agent-dev.err.log") `
      -PassThru
    Start-Sleep -Seconds 2
    Write-Host "Agent server started (PID $($process.Id))."
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "=== All services started ==="
Write-Host "Backend logs: $backendLogs\dev-server.out.log"
Write-Host "Worker logs:  $backendLogs\worker-dev.out.log"
Write-Host "Agent logs:   $agentLogs\agent-dev.out.log"
Write-Host ""
Write-Host "Management console: http://localhost:3000/"
Write-Host "Backend health:     http://localhost:3000/health"
Write-Host "Agent health:       http://127.0.0.1:37665/health"
