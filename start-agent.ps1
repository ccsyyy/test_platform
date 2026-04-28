$ErrorActionPreference = "Stop"

# Start the local Agent service used by the management console for recording.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "dev-tools.ps1")

$agentDir = Join-Path $root "agent"
$logsDir = Join-Path $agentDir "logs"
$stdoutFile = Join-Path $logsDir "agent-dev.out.log"
$stderrFile = Join-Path $logsDir "agent-dev.err.log"
$distServer = Join-Path $agentDir "dist/server.js"
$patterns = @(
  "test_platform\\agent\\dist\\server\.js",
  "test_platform\\agent\\node_modules.+tsx.+src/server\.ts"
)

if (-not (Test-Path $agentDir)) {
  throw "Agent directory not found: $agentDir"
}

$existing = Find-ProcessByPattern -Patterns $patterns
if ($existing) {
  Write-Host "Agent server is already running (PID $($existing.ProcessId))."
} else {
  Ensure-LogsDirectory -Path $logsDir
  Push-Location $agentDir
  try {
    # Fall back to build + serve:start for environments where tsx/esbuild
    # cannot launch the local Agent service reliably.
    & npm.cmd run build
    $process = Start-Process `
      -FilePath "node" `
      -ArgumentList $distServer `
      -WorkingDirectory $agentDir `
      -RedirectStandardOutput $stdoutFile `
      -RedirectStandardError $stderrFile `
      -PassThru
    Start-Sleep -Seconds 2
    Write-Host "Agent server started (PID $($process.Id))."
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Done."
Write-Host "Agent logs:  $logsDir\\agent-dev.out.log"
