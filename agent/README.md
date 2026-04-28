# Test Platform Agent

本地 Agent MVP 用于验证“本机浏览器采集元素并上传平台”的链路。

## 能力

- 登录后端 API。
- 创建录制会话。
- 启动本机 Chrome、Edge 或 Chromium。
- 注入页面采集脚本。
- 采集 `click`、`input`、`change` 事件。
- 上传元素快照、候选 locator、脱敏输入值到 `/api/recording-events`。

## 配置

复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

关键配置：

```text
API_BASE_URL=http://localhost:3000
USERNAME=admin
PASSWORD=管理员密码
PROJECT_ID=2
ENVIRONMENT_ID=1
START_URL=http://localhost:3000/demo/login
BROWSER=chrome
MODE=record
HEADLESS=false
AUTO_DEMO=false
```

## 启动

```powershell
npm install
npm run dev
```

如果本机 npm 网络导致 `tsx` 的 esbuild 可选二进制缺失，可以改用编译后启动：

```powershell
npm run build
npm run start
```

## 自动冒烟采集

自动操作 demo 登录页并退出：

```powershell
$env:AUTO_DEMO='true'
npm run build
npm run start
```

## 本地服务模式

启动本地 Agent 服务后，管理台可以从浏览器直接调用 Agent：

```powershell
npm run build
npm run serve:start
```

默认监听：

```text
http://127.0.0.1:37665
```

服务接口：

- `GET /health`
- `POST /start-recording`
- `POST /recordings/{sessionNo}/stop`

管理台会把平台 token、项目、环境、目标 URL 和浏览器类型传给 Agent。Agent 只监听 `127.0.0.1`，不要暴露到公网或局域网。

## locator 采集策略

Agent 当前会生成以下候选定位：

- `testId`
- `role`
- `placeholder`
- `text`
- `css`

后续应补充唯一性校验、iframe/shadow DOM 支持、拾取模式 UI 和本地 token 握手。
