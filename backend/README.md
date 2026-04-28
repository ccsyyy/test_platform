# Test Platform Backend

这是低代码自动化测试平台的首版 API 服务骨架，负责认证、项目/环境、元素入库、录制会话和执行任务入队。

## 启动前准备

1. 执行根目录的数据库初始化脚本，确保 MySQL 中存在 `test_platform` 数据库和基础表。
2. 复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

3. 修改 `.env` 中的 MySQL、Redis、JWT 和管理员密码。

## 安装依赖

```powershell
npm install
```

## 创建管理员

```powershell
npm run create:admin
```
username: admin
password: Admin-f4dcfada62cc4d598a14c838d4a591e3A1

该命令会创建或重置 `.env` 中配置的管理员账号，不会删除其他用户。

## 初始化冒烟用例

```powershell
npm run seed:smoke
```

该命令会幂等创建：

- 项目：`smoke-demo`
- 环境：`local-api`
- 页面：`/demo/login`
- 元素：用户名、密码、登录按钮、欢迎语
- 用例：`SMOKE_LOGIN_001`

该用例用于验证 API 创建任务、Redis 入队、Worker 执行和 MySQL 结果落库的完整链路。

## 开发启动

```powershell
npm run dev
```

启动后访问：

```text
GET http://localhost:3000/health
```

最小管理台入口：

```text
http://localhost:3000/
```

管理台当前支持登录、项目切换、元素库分组展示、录制会话物化、用例执行、执行任务和步骤结果查看。
若本机启动了 Agent 服务，管理台还支持检测 Agent、开始录制和停止录制。

## 启动 Worker

Worker 会从 Redis 队列 `test-platform:queue:execution` 消费任务，执行 Playwright 用例，并把结果写回 MySQL。

```powershell
npm run worker:dev
```

执行产物默认写入：

```text
backend/artifacts/{jobNo}
```

若本机没有安装 Playwright 浏览器，可先执行：

```powershell
npx playwright install chromium
```

如果浏览器下载受网络影响，可以创建执行任务时选择 `chrome` 或 `edge`，Worker 会尝试使用本机已安装的 Chrome 或 Edge。

## 已实现 API

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId/environments`
- `POST /api/projects/:projectId/environments`
- `GET /api/elements`
- `POST /api/elements`
- `POST /api/recording-sessions`
- `POST /api/recording-events`
- `POST /api/recording-sessions/:sessionNo/materialize`
- `POST /api/execution-jobs`
- `GET /api/execution-jobs/:jobNo`

## 录制会话物化

Agent 上传事件后，可以将录制会话转换为元素和用例草稿：

```text
POST /api/recording-sessions/{sessionNo}/materialize
```

当前物化规则：

- 仅处理带 `testId` 的事件，过滤隐藏代理控件和无稳定定位的事件。
- 合并同一元素、同一动作、同一输入值的重复事件。
- 自动创建或更新页面、元素、候选 locator、用例和步骤。
- 自动添加第一步 `goto`。

## 执行队列

创建执行任务后，API 会向 Redis 写入：

```text
test-platform:queue:execution
test-platform:execution:{jobNo}:status
```

后续 Playwright Worker 从该队列消费任务。

## 当前 Worker 支持的步骤动作

- `goto`
- `click`
- `dblclick`
- `rightclick`
- `fill`
- `press`
- `select`
- `check`
- `uncheck`
- `wait`
- `assert`
