$ErrorActionPreference = "Stop"

# 一次性停止 backend、worker 与 agent 三个本地开发服务。

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $root "stop-agent.ps1")
Write-Host ""
& (Join-Path $root "stop-dev.ps1")
