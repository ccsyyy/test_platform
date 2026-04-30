# Test Platform

根目录脚本用于统一管理本地开发环境中的三个服务：

- `backend` API 服务
- `backend` 执行 worker
- `agent` 本地录制服务

所有脚本均为 Windows PowerShell / CMD 入口，默认在项目根目录执行。

## 目录说明

- `backend`：管理台 API、执行任务入队、执行结果查询、静态管理台页面
- `agent`：本地录制服务，供管理台发起录制和健康检查
- `database`：MySQL 初始化脚本与 Redis keyspace 说明
- `scripts`：基础设施初始化脚本

## 启动前准备

### 1. 安装依赖

根目录没有统一的 `package.json`，需要分别安装：

```powershell
cd backend
npm install

cd ..\agent
npm install
```

### 2. 准备环境变量

后端需要本地 `.env`：

```powershell
cd ..\backend
Copy-Item .env.example .env
```

然后修改 `backend/.env` 中至少这些配置：

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

`agent` 默认可以直接使用 [agent/.env.example](/D:/03_Project/Test/test_platform/agent/.env.example) 作为参考；如果你需要本地独立配置，可以自行复制为 `agent/.env`。

### 3. 准备 MySQL 和 Redis

在启动项目之前，先确保：

- MySQL 可连接
- Redis 可连接
- MySQL 用户有建库建表权限

### 4. 初始化数据库结构

方式一：直接执行 SQL 脚本

```powershell
mysql -h <MYSQL_HOST> -P <MYSQL_PORT> -u <MYSQL_USER> -p < D:\03_Project\Test\test_platform\database\init_mysql.sql
```

这个脚本会：

- 创建 `test_platform` 数据库
- 初始化平台基础表、项目表、元素表、执行表等

方式二：使用仓库脚本初始化 MySQL 和 Redis 元数据

先安装 Python 依赖：

```powershell
pip install pymysql redis
```

再设置环境变量并执行：

```powershell
$env:TP_MYSQL_HOST="<MYSQL_HOST>"
$env:TP_MYSQL_PORT="<MYSQL_PORT>"
$env:TP_MYSQL_USER="<MYSQL_USER>"
$env:TP_MYSQL_PASSWORD="<MYSQL_PASSWORD>"
$env:TP_REDIS_HOST="<REDIS_HOST>"
$env:TP_REDIS_PORT="<REDIS_PORT>"
$env:TP_REDIS_PASSWORD="<REDIS_PASSWORD>"
python .\scripts\init_infra.py
```

### 5. 创建管理员账号

```powershell
cd D:\03_Project\Test\test_platform\backend
npm run create:admin
```

该命令会按照 `backend/.env` 中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 创建或重置管理员账号。

### 6. 初始化示例项目数据

```powershell
cd D:\03_Project\Test\test_platform\backend
npm run seed:smoke
```

该命令会幂等创建一套最小可跑通的数据：

- 项目：`smoke-demo`
- 环境：`local-api`
- 页面：`/demo/login`
- 一组基础元素
- 用例：`SMOKE_LOGIN_001`

如果你只是想先验证“任务能否跑通”，建议执行这一步。

### 7. 安装 Playwright 浏览器

如果本机还没有可用浏览器，先执行：

```powershell
cd D:\03_Project\Test\test_platform\backend
npx playwright install chromium
```

如果你准备直接使用本机已安装的 Chrome 或 Edge，也可以在执行任务时切换浏览器。

## 启动整个项目

根目录现在只保留全量启停入口，推荐始终使用 `all` 脚本管理本地服务。

### 第 1 步：启动全部服务

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\start-all.ps1
```

这个脚本内部会按顺序启动：

1. `backend` API 服务
2. `backend` 执行 worker
3. `agent` 本地录制服务

### 第 2 步：检查服务状态

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\status-all.ps1
```

### 第 3 步：打开管理台

- 管理台首页：`http://localhost:3000/`
- 后端健康检查：`http://localhost:3000/health`
- Agent 健康检查：`http://127.0.0.1:37665/health`

## 手动启动顺序

如果你只是想了解 `start-all.ps1` 背后实际拉起的顺序，可以参考下面这三个服务：

### 1. 启动 backend API

```powershell
cd D:\03_Project\Test\test_platform\backend
npm run dev
```

### 2. 启动 execution worker

```powershell
cd D:\03_Project\Test\test_platform\backend
npm run worker:dev
```

### 3. 编译并启动 agent

```powershell
cd D:\03_Project\Test\test_platform\agent
npm run build
npm run serve:start
```

## 停止服务

### 停止全部服务

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\stop-all.ps1
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

## 根目录脚本说明

### 公共工具

| 脚本 | 说明 |
|---|---|
| `dev-tools.ps1` | 共享进程管理工具，供其它脚本复用，不直接单独执行 |

### 全量启停

| 脚本 | 说明 |
|---|---|
| `start-all.ps1` | 一次性启动 backend、worker、agent |
| `stop-all.ps1` | 一次性停止 backend、worker、agent |
| `status-all.ps1` | 查看 backend、worker、agent 当前运行状态、端口与日志位置 |
| `start-all.cmd` | `start-all.ps1` 的 CMD 包装入口 |
| `stop-all.cmd` | `stop-all.ps1` 的 CMD 包装入口 |
| `status-all.cmd` | `status-all.ps1` 的 CMD 包装入口 |

## 备注

当前机器上 `agent` 的 `serve:dev` 依赖的 `esbuild` 可执行文件缺失，因此根目录的 `start-all.ps1` 在启动 agent 时没有直接调用 `npm run serve:dev`，而是改成：

1. 先执行 `npm run build`
2. 再启动 `node dist/server.js`

这样能保证 Agent 服务在当前环境下稳定启动。
