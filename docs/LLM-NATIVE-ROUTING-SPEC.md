# SmartRouter Pro — LLM-Native 路由架构重设计

> 版本：v2.0.0-draft | 日期：2026-04-18 | 状态：规划中，待实施

---

## 1. 问题定义

### 现状

```
用户输入
    ↓
[硬编码规则层] → 关键词匹配 / 长度阈值 / 复杂度公式
    ↓
Fast 模型（无工具）→ 瞎蒙 / 上下文超限被迫截断
```

**硬编码路由的本质问题：**

| 模块 | 问题 |
|------|------|
| `rule-router.ts` | 评分规则 + 关键词列表写死在代码里 |
| `complexity-scorer.ts` | 5 因子公式是经验值，不反映真实任务难度 |
| `intent-analyzer.ts` | 9 种意图用正则匹配，永远覆盖不全 |
| orchestrator `shouldDelegate()` | 又一套关键词 + 模式匹配 |

**这些规则是人写的，不是模型理解的。** 加一个 weather-search 只是把猫鼠游戏从代码挪到数据库，五十步笑百步。

### 核心矛盾

```
用户问天气 → 加 weather 工具 → 用户问股票 → 加 stock 工具
    → 用户问新闻 → 加 news 工具 → ...
    → 永无止境
```

Rule-router + complexity-scorer 是同构问题：试图用静态规则替代动态决策。

---

## 2. 设计原则

### 原则一：模型自己决定，不是规则替模型决定

```
用户输入
    ↓
[ Fast 模型 ] ← 系统 prompt：自我判断"需要什么"
    ↓
模型自己决定：
  → 内建知识够用 → 直接回复
  → 需要实时数据 → 调用 web_search
  → 需要复杂推理 → 请求升级慢模型
```

### 原则二：Fast/Slow 共享工作台，不靠上下文压缩

```
Fast 模型把"现场"写入 Archive
Slow 模型执行中随时查 Archive
Slow 模型完成后把结果写回 Archive
```

不是 pipeline（Fast 等 Slow），是共享空间（Archive 为唯一事实源）。

### 原则三：简单、鲁棒、可审计

- 不引入 EventEmitter / Redis pub/sub / WebSocket 双向通道
- Archive 用 PostgreSQL（已有 stack）
- 状态同步用自适应轮询：<10s → 2s，10s~60s → 3s，>60s → 5s（减少数据库压力）
- 所有交互可追溯

---

## 3. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                         用户                                │
│                    ↕ SSE 通道                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Fast 模型（Qwen2.5-7B）                 │  │
│  │  tools: web_search                                    │  │
│  │  系统 prompt：自判断决策引导                           │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │ 写入 Archive                       │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │               Task Archive (PostgreSQL)               │  │
│  │  共享工作台：Fast/Slow 共享读写                        │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │ 后台执行                           │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │              Slow 模型（Qwen2.5-72B）                 │  │
│  │  执行中可查 Archive 上下文                            │  │
│  │  执行完写回 result                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Fast 模型的 SSE 通道全程保持 open**，Slow 模型写入 Archive 时，Fast 模型的轮询 loop 感知到变化，推送给用户。

---

## 4. Task Archive 设计

### 4.1 Schema

```sql
CREATE TABLE task_archives (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      VARCHAR(64) NOT NULL,
  turn_id         INTEGER NOT NULL,           -- 第几轮对话

  -- 任务命令（Fast → Slow 的结构化指令）
  command         JSONB NOT NULL,
  -- { action: string, task: string, constraints: string[], query_keys: string[] }

  -- 原始用户输入（供 Slow 查询）
  user_input      TEXT NOT NULL,
  constraints     TEXT[],                      -- 边界条件数组（冗余存，快速读取）

  -- Fast 模型写入：执行过程中的观察
  fast_observations JSONB DEFAULT '[]',       -- [{timestamp, observation}]

  -- Slow 模型写入：执行轨迹
  slow_execution  JSONB DEFAULT '{}',         -- {started_at, deviations[], result, errors[]}
  status          VARCHAR(16) DEFAULT 'pending',
  -- pending → running → done | failed | cancelled
  delivered       BOOLEAN DEFAULT FALSE,      -- 结果是否已推送给用户

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_archives_session ON task_archives(session_id);
CREATE INDEX idx_task_archives_status ON task_archives(status) WHERE status != 'done';
CREATE INDEX idx_task_archives_command ON task_archives USING GIN (command);
-- query_keys 可全文检索
```

### 4.2 接口

| 方法 | 路径 | 调用方 | 说明 |
|------|------|--------|------|
| POST | `/v1/archive/tasks` | Fast | 创建任务档案 |
| PATCH | `/v1/archive/tasks/:id/observation` | Fast | 追加执行观察 |
| GET | `/v1/archive/tasks/:id` | Fast/Slow | 查询任务上下文 |
| PATCH | `/v1/archive/tasks/:id/execution` | Slow | 写入执行结果 |
| GET | `/v1/archive/tasks/:id/status` | Fast | 轮询状态 |
| DELETE | `/v1/archive/tasks/:id` | Fast | 清理完成的任务 |

### 4.3 并发模型

**每条用户消息 = 一个独立任务 ID**。用户可在慢任务执行期间继续发消息，各任务互不影响。

```
消息 A → 任务 A → Slow 执行 → 结果推给用户
消息 B → 任务 B → Fast 直接答（不排队）
```

---

## 5. Fast 模型改造

### 5.1 新系统 prompt

```
你是 SmartRouter Pro 的快模型助手。

【决策规则】
收到用户请求后，依次判断：

1. 用户是否只是闲聊/打招呼/情绪表达？
   → 直接回复，1-2句话，有温度

2. 问题是否需要实时数据（天气/新闻/股价/比分/任何你不确定的事）？
   → 调用 web_search 工具获取数据，再回答

3. 问题是否超出你的知识截止日期，或需要多步复杂推理？
   → 用结构化 JSON 格式输出，然后等待。我们会把请求升级到更强模型处理。

4. 以上都不是？
   → 用你的内建知识直接回答，简短、自然

【web_search 使用时机】
- 天气查询
- 实时股价、指数、基金净值
- 最新新闻、公告
- 比分、赛果
- 任何你不确定、需要确认的实时信息
- 你的知识截止日期之后发生的事

【慢模型请求格式】
当需要升级慢模型时，先用 1-2 句自然语言告知用户（如"让我想想"、"这个问题有点深"），
然后输出结构化 JSON：

{"action": "research | analysis | code | creative", "task": "一句话任务描述", "constraints": ["约束1", "约束2"], "query_keys": ["关键词1", "关键词2"]}

然后停止输出，等待处理。
```

### 5.2 Fast 模型工具

```typescript
const fastModelTools = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for real-time information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query, max 200 characters."
          },
          max_results: {
            type: "integer",
            description: "Max results to return, 1-10.",
            default: 5
          }
        },
        required: ["query"]
      }
    }
  }
];
```

### 5.3 慢模型升级流程

1. Fast 模型输出自然语言反馈（如"让我想想"）+ 结构化 JSON command
2. Fast 模型停止流式输出
3. 系统：
   - 创建 Task Archive 记录（写入 command）
   - 后台启动 Slow 模型
   - Fast 模型开轮询 loop（自适应间隔 2s/3s/5s）
   - 感知超时常未完成 → 推安抚状态消息
4. Slow 模型执行完 → 写 Archive `slow_execution.result`
5. Fast 轮询感知到 `status === 'done'` → 推 SSE → 用户看到结果

---

## 6. 用户体验设计：反馈节奏

### 6.1 用户体验研究依据

参考 Nielsen 1993 响应时间研究 + Google 2009 Brutlag 延迟研究 + CUI 2024 "Explaining the Wait"：

| 响应时间 | 用户体验描述 |
|---------|-------------|
| 0-1s | 感觉即时，如同与人同步反应 |
| 2s | 简单查询（天气、事实问答）容忍上限 |
| 5-10s | 复杂任务可接受，前提是有反馈 |
| >10s | 体验显著下降，用户开始分心 |
| 30s+ | 真实焦虑起点，用户担心系统死了 |
| 1-2min+ | 必须主动安抚，否则流失 |

**关键洞察**（CUI 2024）：用户不怕等，怕"不确定在干嘛"。动态延迟（与任务复杂度匹配）比固定延迟感知更好。解释性反馈比通用 time-filler 更有效。

### 6.2 设计原则

用户最怕的不是慢，是"不知道在干嘛"。慢任务必须有反馈节点。

### 6.3 反馈时机

| 时机 | 触发条件 | 内容示例 | 目的 |
|------|---------|---------|------|
| **启动前** | 收到慢任务后 < 1s | "让我想想"、"这个问题有点复杂" | 确认收到，降低等待焦虑 |
| **执行中** | 慢任务运行 > 30s | "🔄 任务比较复杂，正在分析..." | 告知未卡死 |
| **执行中** | 慢任务运行 > 60s | "⏳ 资料已找到，正在整理对比..." | 说明当前阶段 |
| **执行中** | 慢任务运行 > 120s | "🔄 仍在执行，请继续等待..." | 持续安抚（每 60s 一次） |
| **完成** | status = done | 推最终结果 | 交付 |

**为什么不固定间隔发？** 30s 内完成的短任务不需要打扰用户。

### 6.4 Fast 模型回复流示例

```
用户: "对比 Qwen2.5-7B 和 GPT-4o-mini 在代码生成上的能力"

Fast 回复（< 1s）:
  → "让我想想这个问题，需要查一些资料。"

Slow 执行中（30s 后）:
  → SSE: { "type": "status", "stream": "🔄 任务比较复杂，正在深度分析..." }

Slow 执行中（60s 后）:
  → SSE: { "type": "status", "stream": "⏳ 资料已找到，正在整理对比..." }

Slow 执行中（120s 后）:
  → SSE: { "type": "status", "stream": "🔄 仍在执行，请继续等待..." }

Slow 完成:
  → SSE: { "type": "result", "stream": "📊 代码生成 benchmark 对比：\n\n| 模型 | ..." }
```

### 6.5 实现要点

轮询 loop 内嵌时间追踪：

```typescript
async function pollResult(taskId, sseEmitter) {
  const startTime = Date.now();

  // 自适应轮询间隔：初期频繁检查，后期降低数据库压力
  const getInterval = (elapsedMs) => {
    if (elapsedMs < 10000) return 2000;   // < 10s：2s
    if (elapsedMs < 60000) return 3000;  // 10s ~ 60s：3s
    return 5000;                           // > 60s：5s
  };

  while (true) {
    const task = await archive.get(taskId);
    const elapsed = Date.now() - startTime;

    // 超时安抚消息（用 elapsed < X+1000 而非 >= X，避免重复发）
    if (task.status === 'running') {
      if (elapsed > 30000 && elapsed < 31000) {
        sseEmitter.send('status', '🔄 任务比较复杂，正在深度分析...');
      } else if (elapsed > 60000 && elapsed < 61000) {
        sseEmitter.send('status', '⏳ 资料已找到，正在整理对比...');
      } else if (elapsed > 120000 && elapsed < 121000) {
        sseEmitter.send('status', '🔄 仍在执行，请继续等待...');
      }
    }

    if (task.status === 'done' && !task.delivered) {
      sseEmitter.send('result', task.slow_execution.result);
      await archive.update(taskId, { delivered: true });
      break;
    }
    if (task.status === 'failed') {
      sseEmitter.send('error', `任务失败: ${task.slow_execution.errors?.[0]}`);
      break;
    }

    await sleep(getInterval(elapsed));
  }
}
```

---

## 7. Fast/Slow 通信协议

### 7.1 核心原则：翻译层，不是传话筒

```
用户 ←→ Fast 模型（自然语言，对人说人话）
            ↓ 结构化指令（JSON，不是 prompt）
        Archive ←→ Slow 模型（结构化查询，不传上下文）
```

Fast 模型是**翻译层**，不是上下文搬运工。

- Fast → 用户：自然语言
- Fast → Archive：结构化 JSON 命令
- Slow → Archive：主动查询需要的上下文
- Slow → 用户：经 Fast 格式化后的自然语言

### 7.2 Fast 写入 Archive 的命令格式

```json
{
  "id": "task-uuid",
  "session_id": "session-xxx",
  "turn_id": 5,

  "command": {
    "action": "research | analysis | code | creative",
    "task": "用户任务的精简描述，一句话",
    "constraints": [
      "输出 Markdown 表格",
      "包含具体 benchmark 分数",
      "不超过 500 字"
    ],
    "query_keys": ["Qwen2.5", "GPT-4o-mini", "code generation", "benchmark"]
  },

  "fast_observations": [],

  "status": "pending",
  "delivered": false,
  "created_at": "2026-04-18T20:33:00Z"
}
```

**Fast → Slow 传递的只有：action + task + constraints + query_keys。**

不是用户输入的完整 history，不是截断后的 summary，是精确的查询密钥。

### 7.3 Slow 主动查 Archive

Slow 模型启动时和执行中，通过接口主动查询：

```json
// 查询任务上下文
GET /v1/archive/tasks/:id
Response: { user_input, fast_observations, constraints, query_keys }

// 查询相似历史任务（参考）
GET /v1/archive/tasks?session_id=xxx&q=代码生成+benchmark&limit=3

// 写入执行结果
PATCH /v1/archive/tasks/:id/execution
Body: {
  "status": "done",
  "slow_execution": {
    "started_at": "2026-04-18T20:33:01Z",
    "deviations": [],
    "result": "【最终结果内容】"
  }
}
```

### 7.4 Fast → 用户的流式消息格式

```json
// 任务启动中
{ "type": "status", "stream": "🔍 正在分析，已开启后台任务..." }

// 检测到偏差
{ "type": "status", "stream": "⚠️ 检测到执行偏离约束，正在调整..." }

// 慢任务完成
{ "type": "result", "stream": "📊 代码生成 benchmark 对比：\n\n| 模型 | HumanEval | MBPP | ... |" }
```

**Slow 的原始输出经 Fast 格式化后再推给用户**，Fast 做质量把关。

### 7.5 效率对比

| 方案 | Fast → Slow 传递量 | 上下文完整性 | Token 消耗 |
|------|-------------------|-------------|-----------|
| 旧（上下文压缩） | 截断 history + summary | 部分丢失 | 高（压缩后仍很长） |
| 新（档案查询） | 1 个 query_keys 数组 | Slow 自己补全 | 精确，无冗余 |

---

## 8. Slow 模型改造

### 8.1 可查 Archive

Slow 模型执行时可以调用 Archive 查询接口，获取：

- 原始用户输入
- Fast 模型的观察记录
- 已有的中间结果

这解决了"Fast 把上下文截了，慢模型拿到不完整信息"的问题。

### 8.2 执行中写偏差

Slow 模型执行中检测到偏离（如用户约束被忽略），实时写入 Archive：

```json
{
  "deviations": [
    "用户要求 JSON 格式，实际输出了 Markdown"
  ]
}
```

Fast 轮询感知到偏差 → 告知用户"检测到偏离，正在调整" → Slow 继续执行。

---

## 9. 删除清单

以下文件整删，import 链同步清理：

| 文件 | 原因 |
|------|------|
| `src/router/rule-router.ts` | 硬编码评分 + 关键词 |
| `src/router/complexity-scorer.ts` | 硬编码复杂度公式 |
| `src/router/intent-analyzer.ts` | 硬编码正则意图 |
| `src/services/orchestrator.ts` 内的 `shouldDelegate()` | 硬编码委托规则 |
| `src/services/orchestrator.ts` 内的 `NEED_DELEGATION_INTENTS` / `HIGH_COMPLEXITY_KEYWORDS` / `MULTI_STEP_PATTERNS` | 硬编码列表 |
| `src/router/router.ts` 的 `analyzeAndRoute()` | 整合层，替换为直接调用 Fast 模型 |

---

## 10. 实施计划

### Phase 0：基础设施 — Fast 模型工具化（2-3h）

**目标**：Fast 模型调用路径支持 tools 参数

| 改动 | 文件 |
|------|------|
| `callModelFull()` 支持可选 tools 参数 | `models/model-gateway.ts` |
| Fast 模型调用注入 web_search tool | `api/chat.ts` orchestrator 分支 |
| 改造 `orchestrator()` 解析 tool_calls | `api/chat.ts` |

**验收**：Fast 模型能收到 web_search 工具，模型返回 tool_calls 时能正确执行。

---

### Phase 1：Task Archive 建表 + CRUD（2-3h）

**目标**：Archive 可读写

| 改动 | 说明 |
|------|------|
| schema.sql 加 `task_archives` 表 | PostgreSQL migration |
| `TaskArchiveRepo` | CRUD repository |
| `/v1/archive/tasks/*` API routes | REST 接口 |

**验收**：`POST /v1/archive/tasks` → `GET /v1/archive/tasks/:id` 往返数据一致。

---

### Phase 2：Prompt 改造 + 慢模型升级协议（2-3h）

**目标**：删硬编码路由，模型自判断；Fast/Slow 通信结构化

| 改动 | 说明 |
|------|------|
| Fast 系统 prompt 替换 | 写入新 prompt，删旧路由引导；输出格式改为 JSON command |
| orchestrator 改造 | 解析 command JSON → 创建 Archive（写入 command）→ 启动 Slow |
| 轮询 loop | 自适应间隔 2s/3s/5s，感知 status 变化推 SSE |
| SSE 格式 | `type: status` 流式状态 / `type: result` 最终结果 |

**Fast 模型输出示例：**

```json
{"action": "research", "task": "对比 Qwen2.5-7B 和 GPT-4o-mini 代码生成能力", "constraints": ["输出表格", "不超过 500 字"], "query_keys": ["Qwen2.5-7B", "GPT-4o-mini", "code generation", "benchmark"]}
```

**验收**：用户说"今天深圳天气" → Fast 调用 web_search → 返回天气结果（不经 Slow）。

---

### Phase 3：Slow 模型查/写 Archive（1-2h）

**目标**：Slow 执行中可感知上下文

| 改动 | 说明 |
|------|------|
| Slow 模型调用前查 Archive | 获取完整上下文 |
| Slow 执行中写偏差 | 实时反馈给 Fast |
| Slow 执行完写 result | 完成状态标记 |

**验收**：Slow 执行时能从 Archive 读到 Fast 写入的 constraints。

---

### Phase 4：Streaming SSE 路径同步（1h）

**目标**：SSE 分支同等能力

- streaming 分支同样注入 web_search 工具
- 同样支持慢模型升级协议

---

### Phase 5：清理旧文件（0.5h）

**目标**：干净交付

| 改动 | 说明 |
|------|------|
| 删除 3 个硬编码文件 | rule-router / complexity-scorer / intent-analyzer |
| 清理 import 链 | tsc 无报错 |

---

## 11. 风险与缓解

| 风险 | 缓解方案 |
|------|----------|
| Fast 模型（7B）function calling 不可靠 | Phase 0 先验证；失败则降级到"模型输出特殊标记"方案 |
| 轮询间隔长导致感知延迟 | 自适应间隔（2s/3s/5s），初期快后期慢，平衡 DB 压力与感知延迟；配合安抚消息掩盖 |
| Slow 模型执行中途 Archive 无感知 | 慢任务启动时 Fast 告知用户预计时长，减少用户焦虑 |
| Archive 数据膨胀 | `delivered=true` 的记录定期归档或 TTL 清理 |

---

## 12. 与现有架构的关系

### 保留

- PostgreSQL + pgvector（Archive 复用已有连接池）
- Memory v2 retrieval pipeline（任务相关记忆注入仍然有效）
- Evidence Layer（web_search 的 provenance 追踪仍然有效）
- Tool Guardrail（web_search 的 query 长度/max_results cap 仍然有效）
- Token counter / context manager（Fast 模型内部上下文管理）

### 替换

- `rule-router.ts` → 模型自判断
- `complexity-scorer.ts` → 模型自判断
- `intent-analyzer.ts` → 模型自判断
- orchestrator `shouldDelegate()` → 结构化 JSON command 协议

### 新增

- Task Archive 表 + CRUD + GIN 索引
- 轮询 loop（内嵌在 orchestrator）
- Fast 模型 web_search 工具调用路径
- Fast/Slow 结构化通信协议（command JSON）
- SSE 推送格式（type: status / result）

### 角色重新定义

| 模块 | 旧角色 | 新角色 |
|------|--------|--------|
| Fast 模型 | 快通道（无工具） | **翻译层**：人说人话，机器说机器话 |
| Slow 模型 | 慢通道（接截断上下文） | **执行者**：主动查 Archive，按 command 执行 |
| Archive | 无 | **唯一事实源**：Fast/Slow 共享工作台 |
| Orchestrator | 路由决策 | **流程编排**：创建 Archive，开轮询，推 SSE |

---

_规划日期：2026-04-18_
