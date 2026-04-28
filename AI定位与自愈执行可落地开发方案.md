# AI定位与自愈执行可落地开发方案

## 1. 背景与目标

当前平台已经不是一个从零开始的 AI 方案预研状态，而是已经具备了较完整的录制、物化、执行、报告链路，并且已经上线了第一阶段的 locator 增强能力。

基于当前系统实际能力，后续 AI 建设不应再重复设计以下已经具备的内容：

- Agent 已支持采集多种 locator 与丰富元素快照
- 物化链路已支持候选 locator 落库与去重
- Worker 已支持主 locator 失败后自动切换候选 locator
- 执行报告已支持记录实际命中的 locator
- 元素详情页已支持展示全部 locator

因此，本方案的目标从“是否引入 locator fallback”升级为“如何在现有 fallback 之上继续加入 AI 能力”，重点建设以下四块：

1. AI 自愈定位  
   当主 locator、候选 locator、快照 locator 全部失败后，进入 AI 自愈流程。
2. AI 验证码识别  
   在登录、短信校验、图形验证码等场景中，允许按项目策略接入 AI 识别。
3. AI 推荐 locator  
   在录制、物化、元素验证失败后，为元素补充可审核的 AI 推荐 locator。
4. AI 配置与审计  
   为项目提供 AI 开关、模型配置、调用审计、人工审核与回写能力。

---

## 2. 当前系统实际能力基线

### 2.1 Agent 已具备能力

当前 Agent 已经能够采集并上传以下信息：

- locator 类型
  - `testId`
  - `css`
  - `compactCss`
  - `relativeXPath`
  - `xpath`
  - `role`
  - `text`
  - `placeholder`
- 元素基础信息
  - `text`
  - `tag/tagName`
  - `id`
  - `name`
  - `className/classList`
  - `data-testid / data-test / data-qa / data-id`
  - `placeholder`
  - `href / src / value`
- 元素状态信息
  - `disabled`
  - `checked`
  - `visible`
  - `editable`
- 页面上下文
  - `pageUrl`
  - `pageTitle`
  - `pageLoadState`
  - `iframePath`
  - `insideShadowDom`
  - `shadowDomExists`
  - `shadowHost`
- 几何信息
  - `x / y / width / height`

结论：Agent 侧已经具备 AI 自愈所需的第一批上下文，不需要为 AI 一期重复建设基础采集。

### 2.2 物化链路已具备能力

当前录制物化链路已经实现：

- 页面名称优先使用 `pageTitle`
- 候选 locator 与快照 locator 合并后再参与主 locator 选择
- `compactCss`、`relativeXPath`、`testId` 等定位方式已进入主排序逻辑
- 物化时会做 locator 去重，避免重复候选 locator 落库
- 已物化会话支持再次物化，走增量更新

结论：AI 推荐 locator 可以直接挂接到现有物化结果上，不需要重做页面、元素、步骤物化框架。

### 2.3 Worker 已具备能力

当前 Worker 已经实现：

- 主 locator 执行
- 候选 locator fallback
- 步骤快照 locator fallback
- 记录本次实际命中的 locator
- 报告中展示命中来源、命中顺序
- 多页面执行跟踪
- 截图、视频、trace 产物落库

结论：AI 自愈应放在现有 fallback 链尾部，作为最后一级定位能力，而不是替换现有 resolver。

### 2.4 管理台已具备能力

当前管理台已经支持：

- 元素详情中查看 locator 列表
- 用例步骤查看命中 locator
- 执行报告查看步骤结果与产物
- 项目级管理能力

结论：后续 AI 能力更适合以“配置页 + 审核页 + 日志页”的形式增量接入。

---

## 3. 二期 AI 建设范围

本次更新后的 AI 建设范围分为“已完成基线”和“本期新增建设”两部分。

### 3.1 已完成基线

- Agent 增加 `xpath`
- Agent 增加 `compactCss`、`relativeXPath`
- Worker 支持候选 locator fallback
- 报告记录实际命中的 locator
- 元素详情展示全部 locator

### 3.2 本期新增建设

1. AI 自愈执行
2. AI 验证码识别
3. AI 推荐 locator
4. AI 配置与人工审核
5. AI 调用日志与效果统计

### 3.3 不在本期范围

- 用 AI 完全替代录制逻辑
- 用 AI 完全替代 Playwright 原生定位
- 在 Agent 端直接接大模型并做强耦合推理
- 自动无审核覆盖元素主 locator

---

## 4. 目标架构

后续执行定位链路统一定义为五层：

1. 主 locator  
   元素当前主定位方式。
2. 候选 locator  
   元素库候选 locator、步骤快照 locator。
3. AI 规则自愈 locator  
   当常规 locator 全失败时，由 AI 根据页面上下文生成候选定位方案。
4. AI 视觉定位  
   当 AI 规则自愈 locator 仍失败时，使用 Midscene.js 基于自然语言描述、页面截图和当前页面状态完成视觉定位与动作执行。
5. 人工审核回写  
   AI 自愈命中后，可按策略写回元素库，或进入人工审核队列。

建议执行顺序如下：

```text
主 locator
  -> 元素候选 locator
  -> 步骤快照 locator
  -> AI 规则自愈 locator
  -> AI 视觉定位
  -> 失败
```

建议系统架构如下：

```text
Agent
  -> 上传录制事件、元素快照、locator 候选

Backend
  -> 物化元素/用例
  -> 管理元素 locator
  -> 提供 AI 配置接口
  -> 提供 AI 自愈日志接口

Worker
  -> 执行 locator fallback
  -> 全失败后触发 AI 规则自愈
  -> 规则自愈仍失败后触发 Midscene.js 视觉定位
  -> 记录实际命中 locator 与 AI 调用结果

管理台
  -> 展示 locator 全量信息
  -> 展示 AI 推荐 locator
  -> 审核 AI 自愈结果
  -> 配置项目级 AI 策略
```

---

## 5. 数据库改造

数据库设计必须基于当前真实表结构做增量扩展，不建议一次性把所有 AI 字段硬塞进现有主表。

### 5.1 `tp_element_locator` 增强

当前表已具备：

- `locator_type`
- `locator_value`
- `locator_expression`
- `score`
- `is_primary`
- `is_unique`
- `is_visible`
- `is_actionable`
- `last_checked_at`
- `last_error`

建议新增字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| source | varchar(32) | `recording / manual / ai / healed` |
| status | varchar(32) | `active / disabled / invalid` |
| priority | int | 手工优先级，值越小越优先 |
| confidence | decimal(5,2) | AI 或规则评分 |
| last_success_at | datetime | 最近一次成功命中时间 |
| last_failed_at | datetime | 最近一次失败时间 |
| success_count | int | 成功命中次数 |
| failed_count | int | 失败次数 |

索引建议：

- `idx_tp_element_locator_element_status`
- `idx_tp_element_locator_element_priority`
- `idx_tp_element_locator_source`

### 5.2 `tp_project_ai_config`

新增项目级 AI 配置表。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint | 主键 |
| project_id | bigint | 项目 ID |
| enable_locator_fallback | tinyint | 是否启用 locator fallback，默认 1 |
| enable_ai_healing | tinyint | 是否启用 AI 自愈 |
| enable_ai_captcha | tinyint | 是否启用 AI 验证码识别 |
| ai_provider | varchar(64) | AI 服务提供方 |
| ai_model | varchar(128) | 模型名称 |
| ai_base_url | varchar(500) | 模型服务地址 |
| ai_api_key_encrypted | text | 加密后的 API Key |
| ai_timeout_ms | int | AI 调用超时时间 |
| max_ai_attempts | int | 单步最多 AI 尝试次数 |
| ai_locator_confidence_threshold | decimal(5,2) | AI 自愈 locator 置信度准入阈值，默认 70 |
| captcha_confidence_threshold | decimal(5,2) | 验证码识别置信度准入阈值，默认 80 |
| auto_promote_healed_locator | tinyint | 是否自动将 AI 自愈 locator 写回元素库 |
| require_manual_review | tinyint | 是否必须人工审核后才能写回 |
| allow_ai_on_prod | tinyint | 是否允许生产环境使用 AI |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

唯一约束：

```text
project_id
```

### 5.3 `tp_locator_heal_log`

新增 AI 自愈日志表，用于沉淀 AI 命中、审核、回写链路。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint | 主键 |
| project_id | bigint | 项目 ID |
| element_id | bigint | 元素 ID，可为空 |
| case_id | bigint | 用例 ID |
| step_id | bigint | 步骤 ID |
| job_id | bigint | 执行任务 ID |
| step_result_id | bigint | 步骤执行结果 ID |
| page_url | varchar(1000) | 当前页面 URL |
| page_title | varchar(500) | 当前页面标题 |
| action | varchar(64) | 当前步骤动作 |
| old_locator_json | json | 原 locator 信息 |
| attempted_locators_json | json | 已尝试 locator 列表 |
| ai_input_json | json | AI 输入摘要 |
| ai_candidates_json | json | AI 返回候选 locator |
| selected_locator_json | json | 最终采用的 AI locator |
| confidence | decimal(5,2) | AI 置信度 |
| reason | varchar(1000) | AI 原因说明 |
| status | varchar(32) | `generated / verified / applied / rejected / failed` |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 5.4 `tp_execution_step_result` 扩展策略

当前系统已经把 `resolvedLocator` 写入 `snapshot_json`。

基于现状，建议分两步走：

#### 第一步

继续沿用 `snapshot_json`，新增以下嵌套结构即可：

```json
{
  "resolvedLocator": {},
  "locatorAttempts": [],
  "aiHeal": {
    "used": true,
    "confidence": 92.5,
    "reason": "button text changed but role is stable"
  }
}
```

优点：

- 对现有代码侵入小
- 兼容当前报告接口
- 适合快速上线

#### 第二步

如果后续统计分析需求增强，再补结构化字段：

- `resolved_locator_id`
- `locator_source`
- `ai_heal_used`
- `ai_heal_confidence`

---

## 6. 后端接口改造

### 6.1 保持现有接口继续可用

以下接口已经存在，不建议重做：

- `GET /api/elements/:id`
- `PATCH /api/elements/:id`
- `POST /api/recording-sessions/:sessionNo/materialize`
- `GET /api/executions/:jobNo`

本期应在这些接口上做增量增强。

### 6.2 元素接口增强

#### `GET /api/elements/:id`

继续返回元素详情与全部 locator，同时补充：

- `source`
- `status`
- `priority`
- `confidence`
- `successCount`
- `failedCount`

#### `PATCH /api/elements/:id`

增强支持：

- 设置主 locator
- 调整 locator 优先级
- 启用/禁用 locator
- 应用 AI 推荐 locator

### 6.3 项目 AI 配置接口

新增：

- `GET /api/projects/:projectId/ai-config`
- `PATCH /api/projects/:projectId/ai-config`

用途：

- 控制项目是否开启 AI 自愈
- 控制是否允许 AI 识别验证码
- 配置 AI provider、model、timeout
- 配置 AI 是否自动回写 locator

### 6.4 AI 自愈日志接口

新增：

- `GET /api/locator-heal-logs`
- `GET /api/locator-heal-logs/:id`
- `POST /api/locator-heal-logs/:id/apply`
- `POST /api/locator-heal-logs/:id/reject`

用途：

- 查询 AI 自愈结果
- 查看 AI 输入与输出
- 审核是否写回元素库

### 6.5 验证码识别接口

建议新增：

- `POST /api/ai/captcha/recognize`

输入：

- 图片路径或截图文件
- 场景类型
- 当前项目 ID

输出：

- 识别文本
- 置信度
- 原始响应摘要

### 6.6 locator 验证接口

当前已有元素验证能力，建议补充以下增强接口：

- `POST /api/elements/:id/verify-locators`
- `POST /api/test-cases/:caseId/steps/:stepId/verify-locators`

作用：

- 批量验证 locator 是否仍然有效
- 刷新 locator 成功/失败统计
- 为 AI 推荐 locator 提供预验证入口

---

## 7. Worker 改造

### 7.1 当前 Worker 现状

当前 Worker 已实现：

- 主 locator 执行
- 候选 locator fallback
- 步骤快照 locator 参与候选链
- 实际命中 locator 回写步骤结果

因此本期 Worker 改造重点是：在现有 resolver 末尾接入 AI，而不是推翻已有逻辑。

### 7.2 建议新增 `aiLocatorResolver`

建议新增：

- `backend/src/worker/aiLocatorResolver.ts`

职责：

- 接收当前步骤的失败上下文
- 整理页面上下文与元素快照
- 调用 AI 服务
- 输出标准化的 locator 候选
- 返回验证通过的 locator

### 7.3 新的执行顺序

```text
1. 主 locator
2. 元素候选 locator
3. 步骤快照 locator
4. AI 自愈 locator
5. 失败
```

### 7.4 AI 自愈触发条件

仅在以下条件都满足时触发：

- 当前步骤不是 `goto`
- 主 locator 与候选 locator 全部失败
- 项目开启 `enable_ai_healing`
- 当前环境允许使用 AI
- 当前步骤不是只读断言之外的危险动作，或者已明确允许

### 7.5 传给 AI 的上下文

建议输入：

- 当前页面 URL
- 当前页面标题
- 当前动作类型
- 当前步骤名称
- 当前元素名称
- 当前元素快照
- 已尝试 locator 列表及失败原因
- 页面截图
- 当前页面简要 DOM 片段

### 7.6 AI 输出约束

AI 不直接输出自然语言操作，而是只输出结构化 locator 候选。AI 返回的 locator 类型必须限制在以下范围，并按稳定性优先级排序：

1. `get_by_role()`  
   语义角色定位，优先使用，适合按钮、链接、输入框、菜单项等可访问性语义明确的元素。
2. `get_by_text()`  
   文本定位，最通用，适合页面文本稳定但语义角色不足的元素。
3. `get_by_test_id()`  
   测试 ID 定位，最可靠，适合存在 `data-testid / data-test / data-qa` 的元素。
4. `css` 或 `xpath`  
   兜底定位，仅在语义定位和测试 ID 不可用时使用。

AI 返回时需要同时给出置信度 `confidence`。Worker 需要做置信度准入判断：

```text
confidence >= ai_locator_confidence_threshold
```

默认阈值：

```text
ai_locator_confidence_threshold = 70
```

低于阈值的 AI locator 不进入 Playwright 验证和正式执行，只记录在 AI 自愈日志中，状态建议为 `rejected_by_confidence`。

```json
{
  "candidates": [
    {
      "locatorType": "get_by_role",
      "locatorValue": "{\"role\":\"button\",\"name\":\"登录\"}",
      "confidence": 93.5,
      "reason": "button text changed but role and accessible name are stable"
    },
    {
      "locatorType": "get_by_test_id",
      "locatorValue": "login-btn",
      "confidence": 88.2,
      "reason": "stable test attribute"
    },
    {
      "locatorType": "get_by_text",
      "locatorValue": "登录",
      "confidence": 82,
      "reason": "visible text is stable on the current page"
    },
    {
      "locatorType": "css",
      "locatorValue": "button.login",
      "confidence": 72,
      "reason": "fallback selector when semantic locator is unavailable"
    }
  ]
}
```

### 7.7 AI locator 验证策略

AI 返回后不能直接执行，必须先做置信度过滤，再做短超时探测：

1. 过滤低置信度候选。
2. 按定位类型优先级排序：`get_by_role` -> `get_by_text` -> `get_by_test_id` -> `css/xpath`。
3. 同一类型下按置信度从高到低排序。
4. 对通过阈值的候选做短超时探测。

短超时探测内容：

- 是否存在
- 是否唯一
- 是否可见
- 是否可操作
- 是否匹配当前动作类型

只有同时满足“置信度达标”和“探测通过”的 locator 才能进入正式执行。

### 7.8 AI 验证码识别策略

对于验证码步骤，建议 Worker 增加单独分支：

1. 截取验证码区域
2. 调用 `POST /api/ai/captcha/recognize`
3. 判断识别置信度是否达到 `captcha_confidence_threshold`
4. 将识别结果填入输入框
5. 记录识别置信度与调用日志

默认阈值：

```text
captcha_confidence_threshold = 80
```

低于阈值时视为识别失败，需要刷新验证码并重试。

不建议由 Agent 在录制阶段直接识别验证码。

---

## 8. Agent 改造

### 8.1 当前 Agent 现状

Agent 当前已经能够满足大部分 AI 自愈输入要求，因此本期 Agent 不需要大改，只需要补充少量“AI 更友好”的上下文。

### 8.2 建议增量能力

建议补充以下采集项：

- 当前元素邻近文本摘要
- 当前元素父级链路摘要
- 当前 frame 层级名称或索引
- 是否处于登录区块、弹窗区块、表单区块
- 可选：当前页面局部截图标记信息

### 8.3 Agent 不建议承担的职责

以下能力不建议放在 Agent：

- 直接调用大模型
- 在本地执行复杂 AI 推理
- 在录制阶段直接做自愈决策

Agent 应保持“轻采集、强上下文、弱决策”。

---

## 9. 管理台改造

### 9.1 基于现有页面继续扩展

当前管理台已经有元素详情、执行报告、项目设置等页面，建议新增三个 AI 相关模块：

1. AI 配置
2. AI 自愈日志
3. AI 推荐 locator 审核

### 9.2 元素详情页增强

在现有“全部 locator”基础上，继续展示：

- locator 来源
- 优先级
- 置信度
- 最近成功时间
- 最近失败时间
- 成功次数 / 失败次数
- 是否来自 AI

并支持：

- 应用为主 locator
- 调整优先级
- 启用/禁用
- 人工确认 AI locator

### 9.3 执行报告增强

在现有“实际命中 locator”基础上，继续增加：

- locator 尝试链
- 是否触发 AI 自愈
- AI 自愈原因
- AI 返回候选列表
- 验证码识别结果

### 9.4 系统设置 / 项目设置增强

在项目设置中新增 AI 配置页签：

- 是否启用 AI 自愈
- 是否启用验证码识别
- AI Provider
- AI Model
- API Key
- 调用超时
- 是否自动回写 locator
- 是否要求人工审核
- 是否允许生产环境使用 AI

### 9.5 自愈日志页

新增列表字段建议：

| 字段 | 说明 |
|---|---|
| 时间 | AI 调用时间 |
| 项目 | 所属项目 |
| 用例 | 所属用例 |
| 步骤 | 所属步骤 |
| 动作 | click / fill / assert 等 |
| 原 locator | 原始失败 locator |
| AI locator | AI 推荐 locator |
| 置信度 | AI 评分 |
| 状态 | generated / applied / rejected / failed |
| 操作人 | 审核人 |

---

## 10. 分阶段实施建议

### 第一阶段：AI 基础接入

目标：先把 AI 路由和配置能力打通。

范围：

- 新增 `tp_project_ai_config`
- 新增 `tp_locator_heal_log`
- 新增 AI 配置接口
- 新增 AI 自愈日志接口
- 元素详情增加 locator 来源与统计字段

### 第二阶段：Worker AI 自愈接入

目标：把 AI 接入现有 fallback 链尾部。

范围：

- 新增 `aiLocatorResolver`
- Fallback 全失败后调用 AI
- 记录 locatorAttempts 与 aiHeal 信息
- 报告页展示 AI 自愈结果

### 第三阶段：AI 验证码识别

目标：解决登录和验证码执行问题。

范围：

- 新增验证码识别接口
- Worker 增加验证码处理分支
- 报告记录识别结果与置信度

### 第四阶段：AI 推荐 locator 回写

目标：把执行期 AI 收益沉淀回元素库。

范围：

- 人工审核 AI locator
- 应用为候选 locator
- 可选升级为主 locator
- 统计 AI locator 成功率

---

## 11. 验收标准

### 11.1 基线能力验收

- 元素详情可查看主 locator 与全部候选 locator
- 执行报告可查看实际命中的 locator
- 主 locator 失败时可自动切换候选 locator

### 11.2 AI 自愈验收

- 当主 locator、候选 locator、快照 locator 全部失败时，系统可按项目配置触发 AI
- AI 返回 locator 后，系统会先验证再执行
- AI 命中后，报告可展示 AI 命中信息
- AI 失败后，错误信息可在日志中查看

### 11.3 AI 配置验收

- 可按项目开启或关闭 AI 自愈
- 可按项目配置模型、超时、回写策略
- 生产环境可单独控制是否允许调用 AI

### 11.4 AI 审核验收

- 管理台可查看 AI 自愈日志
- 可对 AI 推荐 locator 执行应用或拒绝
- 应用后的 locator 可在元素详情中查看

### 11.5 验证码识别验收

- 在开启 AI 验证码识别的项目中，Worker 可识别验证码并完成填充
- 报告中可查看识别结果、置信度与调用记录

---

## 12. 最终建议

基于当前系统现状，最合理的推进顺序不是“再重做一套 locator 体系”，而是：

1. 保留当前 locator fallback 体系作为稳定底座
2. 把 AI 放到 fallback 链末尾
3. 先做项目级 AI 配置与 AI 日志
4. 再做 AI 自愈执行
5. 最后做 AI locator 回写与验证码识别

这样可以保证：

- 对现有系统侵入最小
- 能快速验证 AI 是否真正带来命中率提升
- AI 结果有日志、有审核、有回滚
- 不会把执行链路一次性改得过重

这版方案可以直接作为下一阶段开发排期的基础文档使用。

---

## 13. 需求优化补充：Midscene.js 视觉定位与验证码闭环

本节基于当前系统已经具备的主 locator、候选 locator fallback、AI 配置、执行报告、截图产物和 AI 调用日志能力，继续补充下一阶段需求。目标不是替换现有 Playwright 执行链路，而是在现有定位链路末尾增加“视觉定位兜底”和“验证码自动处理”能力。

### 13.1 优化目标

执行时元素定位链路升级为：

```text
主定位
  -> 备选定位
  -> AI 规则自愈 locator
  -> AI 视觉定位（Midscene.js）
  -> 失败并生成修复建议
```

验证码输入链路升级为：

```text
输入框步骤
  -> 判断是否为验证码输入框
  -> 普通输入框正常输入
  -> 验证码输入框触发 OCR / 多模态识别
  -> 自动填入
  -> 识别失败时刷新验证码并重试，最多 3 次
  -> 仍失败时抛出异常并支持人工介入
```

### 13.2 定位链路需求

#### 13.2.1 主定位

主定位仍使用元素库中的 `primary_locator_id` 或步骤快照中的主定位信息。

执行要求：

- 主定位命中且满足动作条件时，直接执行当前步骤。
- 执行报告记录命中方式为 `primary`。
- 主定位失败时，不立即失败，进入备选定位链路。

#### 13.2.2 备选定位

备选定位沿用当前已有能力，包括：

- 元素库候选 locator。
- 步骤快照 locator。
- 录制时采集的 `testId / role / text / placeholder / compactCss / relativeXPath / xpath` 等定位信息。

执行要求：

- 按优先级、有效状态、历史成功率排序。
- 每个候选 locator 使用短超时探测。
- 遇到匹配多个元素、元素不可见、元素不可操作时继续尝试下一个候选。
- 命中后执行当前步骤，并在报告中记录实际命中的 locator。
- 全部失败后进入 AI 规则自愈 locator。

#### 13.2.3 AI 规则自愈 locator

AI 规则自愈是当前系统已有能力的延续：将当前失败步骤、页面文本、元素快照、失败 locator 及失败原因传给模型，由模型生成新的结构化 locator 候选。

触发条件：

- 项目开启 `enable_ai_healing`。
- 当前环境允许 AI。
- 当前步骤不是 `goto`。
- 主定位和全部备选定位均失败。
- AI 模型配置完整。

执行要求：

- AI 返回候选必须先满足 `ai_locator_confidence_threshold`，默认 70。
- AI 返回的 locator 必须先验证存在性、唯一性、可见性和可操作性。
- 验证通过后再执行当前动作。
- 成功后记录 AI 命中 locator、置信度、原因和候选列表。
- 如果规则自愈 locator 仍全部失败，进入 Midscene.js 视觉定位。

#### 13.2.4 AI 视觉定位（Midscene.js）

AI 视觉定位用于处理以下场景：

- 页面结构复杂，DOM locator 不稳定。
- 菜单、下拉框、悬浮层中存在多个相同文本。
- 元素存在但 Playwright locator 因可见性、遮挡、动态渲染等原因无法稳定点击。
- 录制得到的是容器节点或错误节点，常规 locator 无法指向真实业务元素。

Midscene.js 视觉定位输入：

- 当前页面截图。
- 当前页面 URL。
- 当前页面标题。
- 当前步骤名称。
- 当前动作类型。
- 当前元素名称。
- 当前元素业务描述。
- 已失败 locator 列表及失败原因。
- 页面可见文本摘要。
- iframe / shadow DOM 上下文。

视觉定位自然语言描述生成规则：

```text
在当前页面中，找到“元素名称/步骤名称”对应的业务控件，并执行“动作”。
如果存在多个相同文本，优先选择位于当前业务区域、菜单区域、表单区域或最近交互上下文中的元素。
```

示例：

```text
在当前页面导航菜单中点击“云服务器”。
```

```text
在登录表单中找到验证码输入框，并填入识别出的验证码。
```

执行要求：

- Midscene.js 只作为最后一层兜底，不替代主 locator 和备选 locator。
- 视觉定位执行前必须保存当前截图和页面上下文。
- 视觉定位成功后，报告记录命中方式为 `ai_visual`。
- 视觉定位成功后，可生成一个建议 locator，但默认不直接覆盖主 locator。
- 视觉定位失败时，必须生成修复建议。

#### 13.2.5 失败修复建议

当所有定位方式均失败时，系统不只抛出原始异常，还需要生成可读的修复建议。

修复建议来源：

- 主 locator 失败原因。
- 候选 locator 失败统计。
- AI 规则自愈失败原因。
- Midscene.js 视觉定位失败原因。
- 当前页面截图和页面文本摘要。

建议内容包括：

- 是否存在多个同名元素。
- 是否元素不可见或被遮挡。
- 是否录制到了容器节点。
- 是否需要补充 `data-testid`。
- 是否需要调整元素所属页面或组件。
- 是否需要重新录制该步骤。
- 是否建议人工维护主 locator。

报告展示示例：

```text
定位失败：主 locator 和 3 个候选 locator 均未命中，AI 视觉定位也未找到稳定目标。
建议：当前页面存在多个“云服务器”文本，建议将元素 locator 限定到导航菜单区域，或为目标菜单项增加 data-testid。
```

### 13.3 验证码输入需求

#### 13.3.1 验证码输入框识别

执行 `fill` 步骤时，Worker 需要判断目标输入框是否为验证码输入框。

判断来源：

- 用例步骤参数：`aiCaptcha = true`。
- 元素属性：`placeholder / name / id / class / label / aria-label` 中包含验证码特征词。
- 元素名称或步骤名称包含：验证码、captcha、verify code、校验码、图形码。
- 项目配置中启用验证码识别策略。

判断结果：

- 普通输入框：按原有 Playwright 输入逻辑执行。
- 验证码输入框：进入验证码识别链路。

#### 13.3.2 验证码图片定位

验证码识别需要先定位验证码图片或验证码区域。

定位来源优先级：

1. 步骤参数中显式配置的验证码图片 locator。
2. 元素快照中的关联图片候选。
3. 当前输入框附近的图片、canvas、svg 或背景图。
4. AI 视觉定位识别出的验证码区域。

截图要求：

- 优先截取验证码区域。
- 如果无法稳定截取区域，可截取当前视口并交给多模态模型识别。
- 截图需要写入报告产物，便于排查识别失败原因。

#### 13.3.3 OCR / 多模态识别

识别方式：

- 优先使用项目配置的多模态模型。
- 如果配置了专用 OCR 服务，可优先走 OCR。
- 多模态模型需要接收验证码截图、页面标题、URL 和识别提示词。

识别输出：

```json
{
  "text": "A7K9",
  "confidence": 86,
  "reason": "image contains four alphanumeric characters"
}
```

执行要求：

- 识别成功且置信度达到项目阈值时，自动填入验证码输入框。
- 识别结果、置信度、截图路径和调用日志写入步骤结果。
- 识别结果属于敏感数据，报告展示时可按项目配置决定是否脱敏。

#### 13.3.4 识别失败重试

识别失败定义：

- 模型未返回文本。
- 置信度低于阈值。
- 返回文本不符合验证码格式。
- 填入后页面提示验证码错误。

重试策略：

```text
识别失败
  -> 尝试点击验证码图片或刷新按钮
  -> 等待验证码图片更新
  -> 重新截图
  -> 再次识别
  -> 最多 3 次
```

刷新验证码方式：

- 优先点击显式刷新按钮。
- 其次点击验证码图片。
- 再次尝试重新加载验证码图片资源。
- 不建议刷新整个页面，除非步骤明确允许。

失败处理：

- 3 次仍失败时，步骤失败。
- 报告中展示每次识别尝试、置信度、失败原因和截图。
- 支持人工介入：在执行详情中提示用户手动处理验证码或维护验证码定位策略。

### 13.4 数据模型补充

在现有表基础上建议增量补充，不要求一次性重构。

#### 13.4.1 `tp_project_ai_config` 增强

建议新增字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| enable_ai_visual_locator | tinyint | 是否启用 Midscene.js 视觉定位 |
| ai_visual_provider | varchar(64) | 视觉定位服务类型，默认 `midscene` |
| ai_visual_timeout_ms | int | 单次视觉定位超时时间 |
| ai_visual_max_attempts | int | 单步骤视觉定位最大尝试次数 |
| captcha_max_attempts | int | 验证码识别最大尝试次数，默认 3 |
| ai_locator_confidence_threshold | decimal(5,2) | AI 自愈 locator 置信度准入阈值，默认 70 |
| captcha_confidence_threshold | decimal(5,2) | 验证码识别最低置信度，默认 80 |
| captcha_refresh_strategy | varchar(32) | `click_image / click_refresh / custom_locator` |
| allow_manual_captcha_intervention | tinyint | 是否允许人工介入验证码 |

#### 13.4.2 `tp_locator_heal_log` 增强

建议新增字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| heal_type | varchar(32) | `rule_locator / visual_locator / captcha` |
| visual_prompt | text | Midscene.js 使用的自然语言描述 |
| screenshot_artifact_id | bigint | 视觉定位使用的截图产物 ID |
| repair_suggestion | text | 失败后的修复建议 |

#### 13.4.3 新增 `tp_ai_captcha_attempt`

用于记录验证码识别多次尝试。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint | 主键 |
| project_id | bigint | 项目 ID |
| job_id | bigint | 执行任务 ID |
| case_id | bigint | 用例 ID |
| step_id | bigint | 步骤 ID |
| step_result_id | bigint | 步骤结果 ID |
| attempt_no | int | 第几次识别 |
| image_artifact_id | bigint | 验证码截图产物 ID |
| recognized_text | varchar(128) | 识别结果 |
| confidence | decimal(5,2) | 置信度 |
| status | varchar(32) | `success / failed / refreshed` |
| failure_reason | text | 失败原因 |
| created_at | datetime | 创建时间 |

### 13.5 后端接口补充

建议新增或增强接口：

- `POST /api/ai/visual/locate`  
  用于接收页面截图、步骤描述和失败 locator 上下文，返回 Midscene.js 可执行结果或视觉定位建议。

- `POST /api/ai/captcha/recognize`  
  继续沿用当前验证码识别接口，补充 `attemptNo`、`refreshStrategy`、`captchaLocator`、`inputLocator` 等字段。

- `GET /api/executions/:jobNo/ai-attempts`  
  查询某次执行中的 AI 视觉定位和验证码识别尝试记录。

- `POST /api/ai/heal-logs/:id/apply`  
  对 AI 视觉定位生成的建议 locator 做人工审核和回写。

接口要求：

- 所有 AI 接口必须校验项目权限。
- 生产环境默认不允许视觉定位和验证码识别，除非项目显式开启。
- API Key 不允许明文返回前端。
- AI 调用失败时需要返回真实供应商错误、请求降级链路和可读失败原因。

### 13.6 Worker 改造补充

Worker 执行单步骤时建议统一封装为：

```text
executeStep
  -> runWithPrimaryLocator
  -> runWithFallbackLocators
  -> runWithAiRuleLocator
  -> runWithAiVisualLocator
  -> buildRepairSuggestionAndThrow
```

输入框步骤建议封装为：

```text
executeFillStep
  -> detectCaptchaInput
  -> 普通输入：fill
  -> 验证码输入：recognizeCaptchaWithRetry
  -> fill recognized text
```

Worker 需要记录：

- 每个 locator 尝试结果。
- AI 规则自愈候选。
- Midscene.js 视觉定位 prompt。
- Midscene.js 执行结果。
- 验证码每次识别截图、识别结果和失败原因。
- 最终失败修复建议。

### 13.7 Agent 改造补充

Agent 仍然不直接调用大模型，但需要继续强化视觉定位上下文采集。

建议补充：

- 录制时记录元素周边可见文本。
- 记录元素所属视觉区域，例如导航栏、表单、弹窗、表格、菜单。
- 记录元素中心点截图或局部截图。
- 记录点击前后的页面截图哈希，用于判断验证码是否刷新。
- 对输入框记录关联 label、placeholder、附近图片和附近按钮。
- 对验证码图片记录刷新按钮候选、图片节点、canvas 节点和背景图信息。

### 13.8 管理台改造补充

#### 13.8.1 AI 配置

项目设置中 AI 配置需要增加：

- 是否启用 AI 视觉定位。
- Midscene.js 服务配置或运行方式。
- 视觉定位超时时间。
- 视觉定位最大尝试次数。
- 验证码识别最大重试次数，默认 3。
- 验证码识别置信度阈值。
- 是否允许人工介入验证码。

#### 13.8.2 执行报告

步骤结果中增加展示：

- 定位阶段：主定位、备选定位、AI 规则自愈、AI 视觉定位。
- AI 视觉定位 prompt。
- AI 视觉定位截图。
- AI 视觉定位执行结果。
- 验证码识别尝试列表。
- 最终修复建议。

#### 13.8.3 人工介入

当验证码识别 3 次失败时，执行报告需要展示：

- 失败验证码截图。
- 识别尝试记录。
- 人工处理建议。
- 重新执行入口。
- 可选：维护验证码图片 locator 和刷新按钮 locator 的入口。

### 13.9 验收标准补充

#### 13.9.1 定位链路验收

- 主定位成功时，不触发备选定位和 AI。
- 主定位失败后，系统自动尝试备选定位。
- 备选定位全部失败后，项目开启 AI 自愈时触发 AI 规则自愈。
- AI 自愈 locator 低于 `ai_locator_confidence_threshold` 时，不进入正式执行。
- 达到置信度阈值的 AI locator 会继续做 Playwright 短超时验证。
- AI 规则自愈仍失败后，项目开启 AI 视觉定位时触发 Midscene.js。
- Midscene.js 成功后，步骤结果展示命中方式为 `ai_visual`。
- 所有方式失败后，步骤结果展示可读修复建议。

#### 13.9.2 验证码验收

- 普通输入框不会触发验证码识别。
- 验证码输入框可自动识别并填入。
- 验证码识别结果低于 `captcha_confidence_threshold` 时视为失败。
- 识别失败后可自动刷新验证码并重试。
- 最大重试次数默认为 3 次。
- 3 次失败后，步骤失败并展示人工介入建议。
- 报告可查看每次验证码识别截图、识别结果、置信度和失败原因。

#### 13.9.3 兼容性验收

- 未开启 AI 视觉定位时，系统行为与当前版本保持一致。
- 未开启验证码识别时，输入框步骤按原有逻辑执行。
- AI 调用失败不会吞掉 Playwright 原始失败原因。
- 视觉定位和验证码识别均受项目权限、环境策略和 AI 开关控制。
