$ErrorActionPreference = "Stop"

# 一次性启动 backend、worker 与 agent 三个本地开发服务。

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $root "start-dev.ps1")
Write-Host ""
& (Join-Path $root "start-agent.ps1")
