$ErrorActionPreference = "Stop"

# Show the current status of backend, worker, and agent services.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "dev-tools.ps1")

function Test-ListeningPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($listener) {
    return $listener.OwningProcess
  }

  return $null
}

function Write-ServiceStatus {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string[]]$Patterns,
    [int]$Port = 0,
    [string[]]$LogFiles = @()
  )

  $process = Find-ProcessByPattern -Patterns $Patterns
  $portOwner = if ($Port -gt 0) { Test-ListeningPort -Port $Port } else { $null }

  Write-Host "[$Name]"
  if ($process) {
    Write-Host "  Process: RUNNING (PID $($process.ProcessId))"
  } else {
    Write-Host "  Process: STOPPED"
  }

  if ($Port -gt 0) {
    if ($portOwner) {
      Write-Host "  Port ${Port}: LISTENING (PID $portOwner)"
    } else {
      Write-Host "  Port ${Port}: CLOSED"
    }
  }

  foreach ($logFile in $LogFiles) {
    Write-Host "  Log: $logFile"
  }

  Write-Host ""
}

$backendPatterns = @("test_platform\\backend\\node_modules.+tsx.+watch src/server\.ts")
$workerPatterns = @("test_platform\\backend\\node_modules.+tsx.+src/worker/index\.ts")
$agentPatterns = @(
  "test_platform\\agent\\dist\\server\.js",
  "test_platform\\agent\\node_modules.+tsx.+src/server\.ts"
)

Write-ServiceStatus `
  -Name "Backend server" `
  -Patterns $backendPatterns `
  -Port 3000 `
  -LogFiles @(
    (Join-Path $root "backend/logs/dev-server.out.log"),
    (Join-Path $root "backend/logs/dev-server.err.log")
  )

Write-ServiceStatus `
  -Name "Execution worker" `
  -Patterns $workerPatterns `
  -LogFiles @(
    (Join-Path $root "backend/logs/worker-dev.out.log"),
    (Join-Path $root "backend/logs/worker-dev.err.log")
  )

Write-ServiceStatus `
  -Name "Agent server" `
  -Patterns $agentPatterns `
  -Port 37665 `
  -LogFiles @(
    (Join-Path $root "agent/logs/agent-dev.out.log"),
    (Join-Path $root "agent/logs/agent-dev.err.log")
  )
