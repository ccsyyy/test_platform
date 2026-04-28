# Redis Keyspace 规划

Redis 只保存短期状态、队列和协调信息，不保存永久业务数据。永久业务数据必须落 MySQL。

## 命名规范

统一前缀：

```text
test-platform:{domain}:{id-or-name}
```

## 核心 key

|用途|Key 示例|类型|TTL|说明|
|---|---|---|---|---|
|执行队列|`test-platform:queue:execution`|list/stream|无|待执行任务队列|
|失败队列|`test-platform:queue:execution:failed`|list/stream|7 天|失败任务暂存|
|执行任务状态|`test-platform:execution:{jobNo}:status`|hash|24 小时|任务实时进度|
|执行日志缓冲|`test-platform:execution:{jobNo}:logs`|list|24 小时|实时日志推送缓冲|
|录制会话|`test-platform:recording:{sessionNo}`|hash|4 小时|录制临时状态|
|录制事件缓冲|`test-platform:recording:{sessionNo}:events`|list|4 小时|Agent 上传事件缓冲|
|Agent 心跳|`test-platform:agent:{agentId}:heartbeat`|string|90 秒|本地 Agent 在线状态|
|Worker 心跳|`test-platform:worker:{workerId}:heartbeat`|hash|90 秒|Worker 在线状态和负载|
|任务锁|`test-platform:lock:execution:{jobNo}`|string|30 分钟|防止任务重复执行|
|录制锁|`test-platform:lock:recording:{sessionNo}`|string|4 小时|防止录制会话重复绑定|
|接口限流|`test-platform:ratelimit:{userId}:{api}`|string|60 秒|用户接口限流计数|
|token 黑名单|`test-platform:token:blacklist:{jti}`|string|按 token 剩余时间|退出登录或撤销 token|
|元素校验缓存|`test-platform:element:{elementId}:validation`|hash|10 分钟|短期校验结果缓存|
|schema 版本|`test-platform:meta:schema_version`|string|无|初始化脚本维护|

## 队列建议

首版可以使用 Redis list 简化实现：

```text
LPUSH test-platform:queue:execution <jobNo>
BRPOP test-platform:queue:execution 5
```

如果需要延迟任务、失败重试、优先级、可观测性，建议改用 BullMQ 或 Redis Streams。

## 分布式锁建议

锁必须使用 `SET key value NX EX seconds`，释放锁时校验 value，避免误删其他 Worker 持有的锁。

## 初始化约定

初始化脚本只写入：

```text
test-platform:meta:schema_version = 2026.04.13
test-platform:meta:mysql_database = test_platform
```

不得清空 Redis，不得删除已有业务 key。
