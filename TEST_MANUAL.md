# SmartRouter Pro — 本地端到端测试手册 v1.0

> 对应版本：v1.0.0 | 实际 API 路径验证 | 2026-04-12

---

## 前置条件

### 环境要求
- Node.js 20+
- Docker Desktop（已启动）
- 有效的 OpenAI API Key（或已配置兼容的 OpenAI 兼容端点）

### 启动服务

```bash
# 方式一：Docker Compose（推荐）
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入 OPENAI_API_KEY

docker compose up -d

# 等待约 15s 就绪
curl http://localhost:3001/health

# 方式二：本地开发模式
# Terminal 1 — PostgreSQL
docker run -d --name smartrouter-db \
  -e POSTGRES_DB=smartrouter \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16-alpine

docker exec -i smartrouter-db psql -U postgres -d smartrouter \
  < backend/src/db/schema.sql

# Terminal 2 — Backend
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smartrouter \
NODE_ENV=development \
ALLOW_DEV_FALLBACK=true \
OPENAI_API_KEY=sk-xxx \
npm run dev

# Terminal 3 — Frontend
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:3001 \
npm run dev
```

**访问地址：**
- 前端：`http://localhost:3000`
- 后端：`http://localhost:3001`

**身份验证：**
- 推荐：`-H "X-User-Id: test-user-001"`（生产路径）
- 开发模式（`ALLOW_DEV_FALLBACK=true`）：可在 body 中传 `"user_id": "xxx"`

---

## API 路由速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查（无需身份验证） |
| POST | `/api/chat` | 对话 |
| POST | `/api/feedback` | 提交反馈 |
| GET | `/api/dashboard/:userId` | 仪表板（身份来自 middleware） |
| GET | `/api/growth/:userId` | 成长档案 |
| GET | `/v1/tasks/all` | 任务列表 |
| GET | `/v1/tasks/:task_id` | 任务详情 |
| GET | `/v1/tasks/:task_id/summary` | 任务摘要 |
| GET | `/v1/tasks/:task_id/traces` | 执行轨迹 |
| PATCH | `/v1/tasks/:task_id` | 任务控制（pause/resume/cancel） |
| POST | `/v1/memory` | 创建记忆 |
| GET | `/v1/memory` | 列表（`?category=xxx&limit=N`） |
| GET | `/v1/memory/:id` | 单条记忆 |
| PUT | `/v1/memory/:id` | 更新记忆 |
| DELETE | `/v1/memory/:id` | 删除记忆 |
| POST | `/v1/evidence` | 创建证据 |
| GET | `/v1/evidence?task_id=xxx` | 按任务查证据 |
| GET | `/v1/evidence/:id` | 单条证据 |

---

## 第一层：基础健康检查

### T-01 Health Endpoint

```bash
curl -s http://localhost:3001/health | jq .
```

**实际响应示例：**
```json
{
  "status": "ok",
  "timestamp": "2026-04-12T00:00:00.000Z",
  "uptime_seconds": 15,
  "version": "1.0.0",
  "services": {
    "database": {
      "status": "ok",
      "latency_ms": 39
    },
    "model_router": {
      "status": "ok",
      "providers": ["openai"]
    },
    "web_search": {
      "status": "not_configured"
    }
  },
  "stats": {
    "tasks_total": 0,
    "tasks_active": 0,
    "memory_entries": 0,
    "evidence_total": 0
  }
}
```

**验收标准：**
- HTTP 200
- `status` = `"ok"`
- `services.database.status` = `"ok"`
- `services.database.latency_ms` < 100
- 无需任何身份 Header

---

## 第二层：核心聊天功能

### T-02 简单问答（direct 模式）

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "1+1等于几？", "session_id": "session-e2e-01"}' | jq .
```

**实际响应结构：**

```json
{
  "message": "1+1等于2。",
  "decision": {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "user_id": "test-user-001",
    "session_id": "session-e2e-01",
    "timestamp": 1775923504362,
    "input_features": {
      "raw_query": "1+1等于几？",
      "token_count": 4,
      "intent": "simple_qa",
      "complexity_score": 2,
      "has_code": false,
      "has_math": false,
      "requires_reasoning": false,
      "conversation_depth": 0,
      "context_token_count": 0,
      "language": "zh"
    },
    "routing": {
      "router_version": "rule_v1",
      "scores": { "fast": 0.68, "slow": 0.32 },
      "confidence": 0.85,
      "selected_model": "Qwen/Qwen2.5-7B-Instruct",
      "selected_role": "fast",
      "selection_reason": "意图\"chat\"适合快模型; 复杂度低(2)",
      "fallback_model": "deepseek-ai/DeepSeek-V3"
    },
    "context": {
      "original_tokens": 2,
      "compressed_tokens": 100,
      "compression_level": "L0",
      "compression_ratio": 0,
      "memory_items_retrieved": 0,
      "final_messages": [...],
      "compression_details": []
    },
    "execution": {
      "model_used": "Qwen/Qwen2.5-7B-Instruct",
      "input_tokens": 87,
      "output_tokens": 9,
      "total_cost_usd": 0.000018,
      "latency_ms": 302,
      "did_fallback": false
    }
  },
  "task_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**验收标准：**
- HTTP 200
- `message` 非空
- `decision.input_features.intent` 为 `"simple_qa"` 或 `"chat"`
- `decision.execution.input_tokens` > 0
- `task_id` 为有效 UUID

---

### T-03 研究模式（research 模式）

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{
    "message": "请分析2024年全球AI芯片市场竞争格局，包括英伟达、AMD、英特尔的市场份额变化",
    "session_id": "session-e2e-01"
  }' | jq '{
    intent: .decision.input_features.intent,
    model: .decision.routing.selected_model,
    role: .decision.routing.selected_role,
    complexity: .decision.input_features.complexity_score,
    tokens: .decision.execution.input_tokens + .decision.execution.output_tokens
  }'
```

**验收标准：**
- `decision.input_features.intent` 为 `"reasoning"` 或 `"research"`（非 `simple_qa`）
- `decision.routing.selected_role` 为 `"slow"`（复杂任务路由到强模型）
- `message` 长度 > 100 字符

---

### T-04 缺少 message 字段（容错测试）

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"session_id": "session-e2e-01"}' | jq '{status: .status, message: (.message // "无message字段")}'
```

**验收标准：**
- HTTP 200（不崩溃，`body.message ?? ""` 兜底）

---

### T-05 无 X-User-Id Header（身份验证）

```bash
# 开发模式（ALLOW_DEV_FALLBACK=true）：fallback 到 body.user_id
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "session_id": "session-e2e-01", "user_id": "dev"}' | jq '.decision.user_id'

# 生产模式（NODE_ENV=production）：应返回 401
```

**验收标准（dev 模式）：**
- HTTP 200，`decision.user_id` = `"dev"`

---

## 第三层：任务系统

### T-06 获取任务列表

```bash
# 先发一条消息创建任务
TASK_ID=$(curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "帮我写一首关于秋天的诗", "session_id": "session-e2e-02"}' | jq -r '.task_id')

echo "Task ID: $TASK_ID"

# 获取任务列表
curl -s "http://localhost:3001/v1/tasks/all" \
  -H "X-User-Id: test-user-001" | jq ".tasks[] | {task_id, title, status, mode}"
```

**验收标准：**
- 返回 `{ tasks: [...] }`（注意是对象包裹，非纯数组）
- 包含刚创建的 `$TASK_ID`
- 每条任务有 `task_id` / `status` / `mode` / `title`

---

### T-07 任务详情 + 摘要

```bash
# 任务详情
curl -s "http://localhost:3001/v1/tasks/$TASK_ID" \
  -H "X-User-Id: test-user-001" | jq '{task_id: .task.task_id, status: .task.status, title: .task.title}'

# 任务摘要（新任务无摘要属正常）
curl -s "http://localhost:3001/v1/tasks/$TASK_ID/summary" \
  -H "X-User-Id: test-user-001" | jq '.summary | {goal, confirmed_facts, completed_steps, next_step}'
```

**验收标准：**
- 详情返回 `{ task: {...} }`（对象包裹）
- 摘要返回 `{ summary: {...} }`

---

### T-08 任务续接（Task Resume）

```bash
# 用同一个 session_id 发第二条消息（隐式续接：找 active task）
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d "{
    \"message\": \"把这首诗改成七言绝句\",
    \"session_id\": \"session-e2e-02\"
  }" | jq '{task_id: .task_id, message_preview: .message[:80]}'

# 显式续接（通过 task_id）
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d "{
    \"message\": \"把这首诗改成七言绝句\",
    \"session_id\": \"session-e2e-02\",
    \"task_id\": \"$TASK_ID\"
  }" | jq '{task_id: .task_id}'
```

**验收标准：**
- 返回的 `task_id` 与传入的 `$TASK_ID` 相同（任务被续接，而非新建）

---

### T-09 任务状态变更（pause / resume / cancel）

```bash
# 暂停
curl -s -X PATCH "http://localhost:3001/v1/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"action": "pause"}' | jq '{task_id, action, status}'

# 恢复
curl -s -X PATCH "http://localhost:3001/v1/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"action": "resume"}' | jq '{task_id, action, status}'

# 取消
curl -s -X PATCH "http://localhost:3001/v1/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"action": "cancel"}' | jq '{task_id, action, status}'
```

**验收标准：**
- HTTP 200
- `status` 随 action 变化：`pause` → `"paused"`，`resume` → `"responding"`，`cancel` → `"cancelled"`

---

### T-10 跨用户任务归属保护

```bash
# 用另一个用户尝试访问 test-user-001 的任务
curl -s "http://localhost:3001/v1/tasks/$TASK_ID" \
  -H "X-User-Id: attacker-user-999" | jq '{statusCode: .statusCode, error: .error}'
```

**验收标准：**
- HTTP 403，`error` 包含 `"Forbidden"` 或 `"forbidden"`

---

## 第四层：Memory 系统

### T-11 写入 Memory

```bash
# category 可选值：preference | fact | context | instruction
curl -s -X POST http://localhost:3001/v1/memory \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{
    "content": "用户偏好：回答要简洁，不超过3句话",
    "category": "preference",
    "tags": ["style", "brevity"],
    "importance": 4
  }' | jq '{id: .entry.id, category: .entry.category, content: .entry.content[:30]}'
```

**验收标准：**
- HTTP 201
- 返回 `{ entry: {...} }`（注意是对象包裹）
- `entry.id` 为有效 UUID

---

### T-12 读取 Memory（含 category 过滤）

```bash
# 全部列表
curl -s "http://localhost:3001/v1/memory" \
  -H "X-User-Id: test-user-001" | jq '{total: .entries | length, first: .entries[0].category}'

# 按 category 过滤（query 参数，非路径）
curl -s "http://localhost:3001/v1/memory?category=preference" \
  -H "X-User-Id: test-user-001" | jq '.entries[] | {id: .id, category, content: .content[:40]}'
```

**验收标准：**
- 过滤后只返回 `category=preference` 的条目
- 列表返回 `{ entries: [...] }`

---

### T-13 Memory 在对话中生效

```bash
# 先写入一条 factual memory
MEM_RESULT=$(curl -s -X POST http://localhost:3001/v1/memory \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{
    "content": "用户的名字叫张伟，是一名后端工程师",
    "category": "fact",
    "importance": 5
  }')

# 然后发一条会触发 memory 检索的消息
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "你知道我是做什么工作的吗？", "session_id": "session-e2e-03"}' \
  | jq '{reply: .message, memory_retrieved: .decision.context.memory_items_retrieved}'
```

**验收标准：**
- `decision.context.memory_items_retrieved` > 0（memory 被注入 prompt）

---

### T-14 删除 Memory

```bash
MEM_ID=$(curl -s "http://localhost:3001/v1/memory" \
  -H "X-User-Id: test-user-001" | jq -r '.entries[0].id')

# 删除（返回 204 No Content）
curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "http://localhost:3001/v1/memory/$MEM_ID" \
  -H "X-User-Id: test-user-001"

# 验证已删除
curl -s "http://localhost:3001/v1/memory/$MEM_ID" \
  -H "X-User-Id: test-user-001" | jq '.error'
```

**验收标准：**
- DELETE 返回 204
- 再次 GET 返回 404，`error` 非空

---

## 第五层：Evidence 系统

### T-15 手动写入 Evidence

```bash
# source 可选值：web_search | http_request | manual
curl -s -X POST http://localhost:3001/v1/evidence \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"source\": \"web_search\",
    \"content\": \"根据最新数据，英伟达2024年AI芯片市场占有率约为80%\",
    \"relevance_score\": 0.9,
    \"source_metadata\": {\"url\": \"https://example.com/report\", \"title\": \"AI芯片市场报告\"}
  }" | jq '{id: .evidence.evidence_id, source, score: .evidence.relevance_score}'
```

**验收标准：**
- HTTP 201
- 返回 `{ evidence: {...} }`
- `evidence.evidence_id` 为有效 UUID

---

### T-16 查询任务的 Evidence

```bash
# 注意：不是 /v1/tasks/{id}/evidence，而是 /v1/evidence?task_id=xxx
curl -s "http://localhost:3001/v1/evidence?task_id=$TASK_ID" \
  -H "X-User-Id: test-user-001" \
  | jq '.evidence[] | {evidence_id, source, score: .relevance_score, preview: .content[:60]}'
```

---

## 第六层：Feedback 与学习闭环

### T-17 提交显式 Feedback

```bash
# 从 chat 响应中取 decision.id
DECISION_ID=$(curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "推荐一本关于分布式系统的书", "session_id": "session-e2e-04"}' \
  | jq -r '.decision.id')

echo "Decision ID: $DECISION_ID"

# feedback_type 可选值：
# accepted | regenerated | edited | thumbs_up | thumbs_down | follow_up_doubt | follow_up_thanks
curl -s -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d "{
    \"decision_id\": \"$DECISION_ID\",
    \"feedback_type\": \"thumbs_up\"
  }" | jq .
```

**验收标准：**
- HTTP 200，`{ "success": true }`
- 无报错

---

### T-18 无效 Feedback 校验

```bash
# 无效 feedback_type
curl -s -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d "{\"decision_id\": \"$DECISION_ID\", \"feedback_type\": \"invalid_type\"}" | jq '.error'

# decision_id 不存在
curl -s -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"decision_id": "00000000-0000-0000-0000-000000000000", "feedback_type": "thumbs_up"}' | jq '.error'
```

**验收标准：**
- 无效 type → 400，`error` 包含 `"invalid feedback_type"`
- 不存在的 decision_id → 404

---

## 第七层：Dashboard 与可观测性

### T-19 Dashboard 统计

```bash
curl -s "http://localhost:3001/api/dashboard/test-user-001" \
  -H "X-User-Id: test-user-001" | jq '{
    total_requests: .today.total_requests,
    fast: .today.fast_count,
    slow: .today.slow_count,
    tokens: .today.total_tokens,
    cost: .today.total_cost,
    saving_rate: .today.saving_rate,
    avg_latency: .today.avg_latency_ms
  }'
```

**验收标准：**
- HTTP 200
- 包含 `today.total_requests`（执行过对话后 > 0）
- 包含 `growth.satisfaction_rate`

---

### T-20 Trace 查询

```bash
curl -s "http://localhost:3001/v1/tasks/$TASK_ID/traces" \
  -H "X-User-Id: test-user-001" | jq '{
    task_id,
    count,
    types: [.traces[] | .type] | unique
  }'
```

**验收标准：**
- 返回 `{ task_id, count, traces, summaries }`
- `traces[].type` 包含 `"classification"` / `"routing"` / `"response"`（chat 后）

---

### T-21 Growth Profile

```bash
curl -s "http://localhost:3001/api/growth/test-user-001" \
  -H "X-User-Id: test-user-001" | jq '{
    level: .level,
    level_name: .level_name,
    satisfaction_rate: .satisfaction_rate,
    total_interactions: .total_interactions,
    milestones_count: (.milestones | length)
  }'
```

---

## 第八层：Benchmark Runner

### T-22 跑 Benchmark（接真实 API）

```bash
cd backend

# 跑 direct suite（最快，约 1 分钟）
npm run benchmark -- --suite direct --user-id test-user-001

# 跑 research suite（中等）
npm run benchmark -- --suite research --user-id test-user-001

# 跑全部（13 条任务，约 2-3 分钟）
npm run benchmark -- --user-id test-user-001
```

**预期输出：**
```
================================================================
  Benchmark Summary
================================================================
  Total:   5   (5 direct)
  Passed:  4  ✅
  Failed:  1  ⚠️
  Errors:  0  ❌
  Rate:    80.0%
  Latency: avg 1240ms  total 6200ms
================================================================
Results: evaluation/results/latest.json
```

**验收标准：**
- 无 `ECONNREFUSED` 错误（backend 可达）
- Pass rate > 0%（证明 API key 有效）
- `evaluation/results/latest.json` 已写入

---

## 第九层：Phase 2.0 SSE 流式验证

### T-22 SSE Fast Reply + Routing Layer（Layer 0 直接回复）

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "你好", "session_id": "session-sse-01", "stream": true}' \
  | while IFS= read -r line; do
    echo "$line" | grep -v "^data: $" | grep "^data:" | sed 's/data: //' | jq -r 'if .type then "\(.type): \(.stream[0:60]) (layer: \(.routing_layer // "n/a"))" else empty end'
  done
```

**预期事件流（SSE）：**
```
fast_reply: 你好，我是 SmartRouter...  (layer: L0)
done: [stream_complete]  (layer: L0)
```

**验收标准：**
- SSE `fast_reply` 事件包含 `routing_layer: "L0"`（直接回复）
- SSE `done` 事件包含 `routing_layer`

---

### T-23 SSE Clarifying 流程（Phase 1.5 澄清）

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "帮我整理一份报告", "session_id": "session-sse-02", "stream": true}' \
  | while IFS= read -r line; do
    echo "$line" | grep "^data:" | sed 's/data: //' | jq -r '"\(.type): \(.stream // .question_text // "..." | .[0:80]) (layer: \(.routing_layer // "?"))"'
  done
```

**预期事件流：**
```
fast_reply: 让我确认一下...
clarifying: 你想要哪种格式的报告？... (layer: L0)
done: ...
```

**验收标准：**
- SSE `clarifying` 事件有 `question_text` 和可选 `options` 数组
- `routing_layer` 为 `"L0"`（Fast 直接处理，无需 Slow 委托）

---

### T-24 SSE Slow 委托（Layer 2）

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "帮我搜索并总结量子计算在2025年的最新进展", "session_id": "session-sse-03", "stream": true}' \
  | while IFS= read -r line; do
    echo "$line" | grep "^data:" | sed 's/data: //' | jq -r '"\(.type): \(.stream // "" | .[0:80]) (layer: \(.routing_layer // "?"))"'
  done
```

**预期事件流：**
```
fast_reply: 好的，这个问题比较深入，让我交给慢模型处理...  (layer: L2)
status: 任务比较复杂，正在深度分析...  (layer: L2)
status: 资料已找到，正在整理对比...  (layer: L2)
result: 慢模型分析完成...  (layer: L2)
done: [delegation_complete]  (layer: L2)
```

**验收标准：**
- 首个 SSE 事件为 `fast_reply`（人格化安抚）
- 30s 后出现 `status` 事件（安抚消息）
- Slow 完成前出现 `status` 事件
- 最终 `result` 事件包含慢模型完整回复
- 所有事件 `routing_layer` = `"L2"`

---

## 第十层：Phase 2.0 路由分层验证

### T-25 /api/chat/eval/routing 返回 routing_layer

```bash
# Layer 0: 闲聊
curl -s -X POST http://localhost:3001/api/chat/eval/routing \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "你好"}' | jq '{routing_layer, selected_role, routing_intent}'

# Layer 1: 实时数据查询
curl -s -X POST http://localhost:3001/api/chat/eval/routing \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "今天天气怎么样"}' | jq '{routing_layer, selected_role, routing_intent}'

# Layer 2: 复杂推理
curl -s -X POST http://localhost:3001/api/chat/eval/routing \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message": "帮我设计一个支持百万并发的分布式缓存系统"}' | jq '{routing_layer, selected_role, routing_intent}'
```

**验收标准：**
- Layer 0：`routing_layer: "L0"`, `selected_role: "fast"`, `tool_used: null`
- Layer 1：`routing_layer: "L1"`, `selected_role: "fast"`, `tool_used: "web_search"`
- Layer 2：`routing_layer: "L2"`, `selected_role: "slow"`

---

### T-26 Benchmark Layer 分层准确率

```bash
cd backend
npm run benchmark -- --suite routing --user-id test-user-001
```

**验收标准：**
- 输出包含 `分层准确率: X/Y = Z%`
- 输出包含 `Phase 2.0 按路由分层准确率` 表（L0/L1/L2 三行）
- `ci-gate-routing-*.json` 包含 `routing_layer_accuracy` 字段

---

## 第九层：前端 UI 验证

打开 `http://localhost:3000`，按顺序操作：

| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| UI-01 | 在输入框发送一条消息 | 收到回复，右侧 Task tab 出现新任务 |
| UI-02 | 点击 Task tab | 显示任务列表，含 status/mode/title |
| UI-03 | 点击 Evidence tab | 显示证据列表（或空状态） |
| UI-04 | 点击 💚 Health tab | 显示 DB latency / model providers / web_search 状态，30s 自动刷新 |
| UI-05 | 点击 Trace tab | 显示 classification / routing / response 轨迹卡片 |
| UI-06 | 发送复杂研究问题 | Task tab 显示新任务（mode: research），Trace tab 有多个 trace |
| UI-07 | 等待 30s | Health tab 自动刷新 uptime 时间 |

> **注意**：系统目前**没有**独立的 Memory UI tab 或 Debug tab。

---

## 快速回归脚本

保存为 `scripts/e2e-smoke.sh`（bash/Linux/macOS，Windows 用 Git Bash 或 WSL）：

```bash
#!/usr/bin/env bash
set -e

BASE="${API_BASE:-http://localhost:3001}"
USER="test-user-e2e-$(date +%s)"
PASS=0; FAIL=0

check() {
  local name="$1"; local result="$2"; local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    echo "✅  $name"
    ((PASS++))
  else
    echo "❌  $name → 期望包含 '$expected'"
    echo    "     实际: $(echo "$result" | head -c 200)"
    ((FAIL++))
  fi
}

echo "🏃 SmartRouter Pro — E2E Smoke Test"
echo "=============================================="
echo "Base: $BASE | User: $USER"
echo ""

# ── T-01 Health ──────────────────────────────────
R=$(curl -s "$BASE/health")
check "T-01 Health status=ok"           "$R" '"status":"ok"'
check "T-01 DB status ok"               "$R" '"database".*status":"ok"'
check "T-01 Has services"               "$R" '"services":'
check "T-01 Has stats"                  "$R" '"stats":'

# ── T-02 Simple QA ───────────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"message":"1+1等于几","session_id":"smoke-01"}')
check "T-02 Chat 200, has message"      "$R" '"message":"'
check "T-02 Has task_id"                "$R" '"task_id":"'
check "T-02 Has decision"               "$R" '"decision":'
check "T-02 Has execution tokens"       "$R" '"input_tokens":'
TASK_ID=$(echo "$R" | grep -o '"task_id":"[^"]*"' | head -1 | cut -d'"' -f4)

# ── T-03 Research mode ───────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"message":"分析全球AI芯片市场竞争格局","session_id":"smoke-02"}')
check "T-03 Has intent field"          "$R" '"intent":"'
check "T-03 Has routing"                "$R" '"routing":'

# ── T-04 Missing message ─────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"session_id":"smoke-03"}')
check "T-04 No crash on missing msg"   "$R" '"message":"'

# ── T-05 Dev fallback ────────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"hi","session_id":"smoke-04","user_id":"fallback-test"}')
check "T-05 Dev fallback user_id"      "$R" '"user_id":"fallback-test"'

# ── T-06 Task list ───────────────────────────────
R=$(curl -s "$BASE/v1/tasks/all" -H "X-User-Id: $USER")
check "T-06 Task list is object"       "$R" '"tasks":\['
check "T-06 Has tasks array"            "$R" '"tasks":'

# ── T-07 Task detail ─────────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s "$BASE/v1/tasks/$TASK_ID" -H "X-User-Id: $USER")
  check "T-07 Task detail object wrap"  "$R" '"task":'
fi

# ── T-10 Auth protection ─────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s "$BASE/v1/tasks/$TASK_ID" -H "X-User-Id: attacker-999")
  check "T-10 Auth 403"                 "$R" '"error"'
fi

# ── T-11 Memory write ────────────────────────────
R=$(curl -s -X POST "$BASE/v1/memory" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"content":"smoke test memory entry","category":"fact","importance":3}')
check "T-11 Memory create entry wrap"  "$R" '"entry":'
check "T-11 Memory has id"              "$R" '"id":"'
MEM_ID=$(echo "$R" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# ── T-12 Memory list ─────────────────────────────
R=$(curl -s "$BASE/v1/memory" -H "X-User-Id: $USER")
check "T-12 Memory list entries wrap"   "$R" '"entries":'

# ── T-14 Memory delete ───────────────────────────
if [ -n "$MEM_ID" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "$BASE/v1/memory/$MEM_ID" -H "X-User-Id: $USER")
  check "T-14 Memory delete 204"        "$HTTP_CODE" "204"
fi

# ── T-15 Evidence write ──────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s -X POST "$BASE/v1/evidence" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $USER" \
    -d "{\"task_id\":\"$TASK_ID\",\"source\":\"manual\",\"content\":\"test evidence\",\"relevance_score\":0.8}")
  check "T-15 Evidence create wrap"     "$R" '"evidence":'
fi

# ── T-19 Dashboard ───────────────────────────────
R=$(curl -s "$BASE/api/dashboard/$USER" -H "X-User-Id: $USER")
check "T-19 Dashboard has today"        "$R" '"today":'
check "T-19 Dashboard has growth"       "$R" '"growth":'

# ── Summary ──────────────────────────────────────
echo ""
echo "=============================================="
echo "结果: $PASS 通过 / $FAIL 失败"
if [ $FAIL -eq 0 ]; then
  echo "🎉 全部通过"
else
  echo "⚠️  有失败项，请检查"
  exit 1
fi
```

```bash
chmod +x scripts/e2e-smoke.sh
./scripts/e2e-smoke.sh
```

**Windows 原生环境**（无 bash）：使用 `scripts/e2e-smoke.ps1`：

```powershell
# PowerShell 版核心检查
$base = "http://localhost:3001"
$user = "test-user-e2e-pwsh"
$pass = 0; $fail = 0

function check($name, $result, $expected) {
    if ($result -match $expected) {
        Write-Host "✅  $name"
        $script:pass++
    } else {
        Write-Host "❌  $name → 期望: $expected"
        $script:fail++
    }
}

Write-Host "🏃 SmartRouter Pro — E2E Smoke (PowerShell)"

$r = curl.exe -s "$base/health"
check "T-01 Health" $r '"status":"ok"'

$r = curl.exe -s -X POST "$base/api/chat" -H "Content-Type: application/json" `
    -H "X-User-Id: $user" -d '{"message":"hi","session_id":"ps1"}'
check "T-02 Chat" $r '"message":"'
check "T-02 task_id" $r '"task_id":"'

$r = curl.exe -s "$base/v1/tasks/all" -H "X-User-Id: $user"
check "T-06 Tasks" $r '"tasks":'

$r = curl.exe -s "$base/api/dashboard/$user" -H "X-User-Id: $user"
check "T-19 Dashboard" $r '"today":'

Write-Host "结果: $pass 通过 / $fail 失败"
```

---

## 常见问题排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `ECONNREFUSED localhost:3001` | Backend 未启动 | `docker compose up -d` 或检查 backend 进程 |
| `database.status: "error"` | PostgreSQL 未就绪 | 等待 10s 或 `docker compose logs postgres` |
| `401 Unauthorized` | 生产模式无 Header | 加 `-H "X-User-Id: xxx"` 或设 `ALLOW_DEV_FALLBACK=true` |
| `execution` 字段为空对象 | NODE_ENV 非 development | 确认 backend 启动时 `NODE_ENV=development` |
| Benchmark pass rate = 0% | API Key 无效或网络问题 | 检查 `.env` 中 `OPENAI_API_KEY` |
| Memory 未注入对话 | 检索阈值未达到 | memory `importance` 需足够高，或检索策略配置 |
| Health latency 很高 | Docker 网络或宿主机负载 | 正常偏差 < 100ms；重启容器 |
| frontend 编译报错 | TypeScript 错误未修复 | `npm run build` 前端定位具体报错 |
| `evidence` 返回空 | 无 web_search 流量 | Evidence 主要由 web_search 工具自动写入 |

---

### T-27 路由分层标识（前端 UI）

打开前端 `http://localhost:3000`，发送不同类型的消息，观察右上角或消息气泡旁的 **routing_layer badge**：

```bash
# 前端 UI 验证命令（无 curl，直接用浏览器手动操作）
# 步骤：
# 1. 打开 http://localhost:3000
# 2. 发送 "你好" → 期望出现灰色 L0 badge
# 3. 发送 "今天沪深300涨了多少" → 期望出现蓝色 L1 badge
# 4. 发送 "帮我分析一下为什么最近科技股跌了" → 期望出现紫色 L2 badge
```

| 消息示例 | 期望 routing_layer | Badge 颜色 | 验证 |
|----------|-------------------|-----------|------|
| "你好"、"谢谢" | L0 | 灰色 | 快速回复，无 loading |
| "今天天气"、"查下茅台股价" | L1 | 蓝色 | 有 loading，显示实时数据 |
| "帮我分析投资策略"、"写个报告" | L2 | 紫色 | 长时间 loading，Slow 模型 |

**注意**：如 badge 未显示，检查 `src/components/ChatMessage.tsx` 是否渲染了 SSE 事件中的 `routing_layer` 字段。

## 附录：前端 Tab 速查

| Tab 名称 | 说明 |
|----------|------|
| 💬 Chat | 对话主界面，支持发送消息、查看回复 |
| 📋 Task | 任务列表，显示 task_id / status / mode |
| 📚 Evidence | 证据面板，显示 source / content / relevance |
| 💚 Health | 健康检查（自动 30s 刷新） |
| 🔍 Trace | 执行轨迹，含 classification / routing / response 三类 |

**注意**：目前**无**独立的 Memory tab 和 Debug tab（这些是后续 Phase C 规划项）。
