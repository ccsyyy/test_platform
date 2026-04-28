$ErrorActionPreference = "Stop"

# 共享的进程管理工具，供根目录下的 start/stop 脚本复用。

function Ensure-LogsDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Find-ProcessByPattern {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Patterns
  )

  $processes = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -or $_.Name -eq "npm.cmd" }
  foreach ($process in $processes) {
    $commandLine = [string]$process.CommandLine
    foreach ($pattern in $Patterns) {
      if ($commandLine -match $pattern) {
        return $process
      }
    }
  }

  return $null
}

function Get-ManagedProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Patterns
  )

  $all = Get-CimInstance Win32_Process
  $matched = $all | Where-Object {
    $commandLine = [string]$_.CommandLine
    foreach ($pattern in $Patterns) {
      if ($commandLine -match $pattern) {
        return $true
      }
    }
    return $false
  }

  if (-not $matched) {
    return @()
  }

  $byParent = @{}
  foreach ($process in $all) {
    if (-not $byParent.ContainsKey($process.ParentProcessId)) {
      $byParent[$process.ParentProcessId] = @()
    }
    $byParent[$process.ParentProcessId] += $process
  }

  $result = @{}
  $stack = [System.Collections.Generic.Stack[object]]::new()
  foreach ($process in $matched) {
    $stack.Push($process)
  }

  while ($stack.Count -gt 0) {
    $current = $stack.Pop()
    if ($result.ContainsKey($current.ProcessId)) {
      continue
    }

    $result[$current.ProcessId] = $current
    foreach ($child in ($byParent[$current.ProcessId] | ForEach-Object { $_ })) {
      $stack.Push($child)
    }
  }

  return $result.Values | Sort-Object ProcessId -Descending
}

function Start-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string]$NpmScript,
    [Parameter(Mandatory = $true)]
    [string[]]$Patterns,
    [Parameter(Mandatory = $true)]
    [string]$StdoutFile,
    [Parameter(Mandatory = $true)]
    [string]$StderrFile
  )

  $existing = Find-ProcessByPattern -Patterns $Patterns
  if ($existing) {
    Write-Host "$Name is already running (PID $($existing.ProcessId))."
    return $false
  }

  Ensure-LogsDirectory -Path (Split-Path -Parent $StdoutFile)
  $process = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run", $NpmScript `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $StdoutFile `
    -RedirectStandardError $StderrFile `
    -PassThru

  Start-Sleep -Seconds 2
  Write-Host "$Name started (PID $($process.Id))."
  return $true
}

function Stop-ManagedProcessTree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string[]]$Patterns
  )

  $processes = Get-ManagedProcesses -Patterns $Patterns
  if (-not $processes.Count) {
    Write-Host "$Name is not running."
    return $false
  }

  foreach ($process in $processes) {
    try {
      Stop-Process -Id $process.ProcessId -ErrorAction Stop
      Write-Host "Stopping $Name PID $($process.ProcessId): $($process.Name)"
    } catch {
      Write-Host "Skip PID $($process.ProcessId): $($_.Exception.Message)"
    }
  }

  Start-Sleep -Seconds 2

  foreach ($process in $processes) {
    $alive = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if ($alive) {
      & taskkill /PID $process.ProcessId /T > $null 2>&1
      Start-Sleep -Milliseconds 500
    }
  }

  foreach ($process in $processes) {
    $alive = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if ($alive) {
      & taskkill /PID $process.ProcessId /T /F > $null 2>&1
      Write-Host "Force stopped $Name PID $($process.ProcessId): $($process.Name)"
    }
  }

  return $true
}
