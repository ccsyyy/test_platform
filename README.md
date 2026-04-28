# Test Platform Scripts

根目录脚本用于统一管理本地开发环境中的三个服务：

- `backend` API 服务
- `backend` 执行 worker
- `agent` 本地录制服务

所有脚本均为 Windows PowerShell / CMD 入口，默认在项目根目录执行。

## 服务说明

### 1. Backend server

对应命令：

```powershell
cd backend
npm run dev
```

用途：

- 提供登录、项目、录制、元素、用例、执行任务、报告等管理台 API
- 默认监听 `http://localhost:3000`

### 2. Execution worker

对应命令：

```powershell
cd backend
npm run worker:dev
```

用途：

- 消费 Redis 执行队列
- 负责真正运行 Playwright 用例
- 如果这个服务没启动，执行任务会一直停留在 `queued`

### 3. Agent server

对应命令：

```powershell
cd agent
npm run build
npm run serve:start
```

用途：

- 提供本地 `Agent` HTTP 服务
- 供管理台发起录制、停止录制、检测健康状态
- 默认监听 `http://127.0.0.1:37665`

## 根目录脚本

### 公共工具

| 脚本 | 说明 |
|---|---|
| `dev-tools.ps1` | 共享进程管理工具，供其它脚本复用，不直接单独执行 |

### Backend + worker

| 脚本 | 说明 |
|---|---|
| `start-dev.ps1` | 启动 backend API 服务和 execution worker |
| `stop-dev.ps1` | 停止 backend API 服务和 execution worker |
| `start-dev.cmd` | `start-dev.ps1` 的 CMD 包装入口 |
| `stop-dev.cmd` | `stop-dev.ps1` 的 CMD 包装入口 |

### Agent

| 脚本 | 说明 |
|---|---|
| `start-agent.ps1` | 启动本地 Agent 服务；脚本会先编译 Agent，再启动 `dist/server.js` |
| `stop-agent.ps1` | 停止本地 Agent 服务 |
| `start-agent.cmd` | `start-agent.ps1` 的 CMD 包装入口 |
| `stop-agent.cmd` | `stop-agent.ps1` 的 CMD 包装入口 |

### 全量启停

| 脚本 | 说明 |
|---|---|
| `start-all.ps1` | 一次性启动 backend、worker、agent |
| `stop-all.ps1` | 一次性停止 backend、worker、agent |
| `status-all.ps1` | 查看 backend、worker、agent 当前运行状态、端口与日志位置 |
| `start-all.cmd` | `start-all.ps1` 的 CMD 包装入口 |
| `stop-all.cmd` | `stop-all.ps1` 的 CMD 包装入口 |
| `status-all.cmd` | `status-all.ps1` 的 CMD 包装入口 |

## 推荐用法

### 启动全部服务

```powershell
.\start-all.ps1
```

或：

```cmd
start-all.cmd
```

### 停止全部服务

```powershell
.\stop-all.ps1
```

或：

```cmd
stop-all.cmd
```

### 查看全部服务状态

```powershell
.\status-all.ps1
```

或：

```cmd
status-all.cmd
```

### 只启动管理台和执行服务

```powershell
.\start-dev.ps1
```

### 只启动 Agent

```powershell
.\start-agent.ps1
```

## 日志位置

### Backend 日志

- `backend/logs/dev-server.out.log`
- `backend/logs/dev-server.err.log`
- `backend/logs/worker-dev.out.log`
- `backend/logs/worker-dev.err.log`

### Agent 日志

- `agent/logs/agent-dev.out.log`
- `agent/logs/agent-dev.err.log`

## 脚本行为说明

### 1. 避免重复启动

`start-*.ps1` 会先检测对应服务是否已经存在，如果已经运行，不会重复拉起新的进程。

### 2. 优雅停止

`stop-*.ps1` 会先尝试正常停止进程。

如果遇到 `tsx watch`、`esbuild`、`conhost` 等子进程残留，会继续按进程树清理，避免服务假死或端口被占用。

### 3. 建议顺序

日常开发推荐直接使用：

```powershell
.\start-all.ps1
```

结束时使用：

```powershell
.\stop-all.ps1
```

这样不用分别管理多个终端窗口。

## 备注

当前机器上 `agent` 的 `serve:dev` 依赖的 `esbuild` 可执行文件缺失，因此根目录的 `start-agent.ps1` 没有直接调用 `npm run serve:dev`，而是改成：

1. 先执行 `npm run build`
2. 再启动 `node dist/server.js`

这样能保证 Agent 服务在当前环境下稳定启动。
