# SmartRouter Pro — Phase 2.0 流量分级上线计划

> 版本：v1.0 | 日期：2026-04-18 | 状态：**上线完成，收口阶段**

---

## 1. 背景

Phase 1.5（任务卡片 + Clarifying 流程 + Slow 只读优化）已完成。Phase 2.0 目标：**将三层流量分级从内部实现正式暴露为可观测、可评测的生产级功能**。

---

## 2. 三层流量分级架构

```
用户消息
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 0 — Fast 直通（L0）                                     │
│ 触发条件：闲聊 / 问候 / 感谢 / 简单问答（< 5个字 / 无实质任务）   │
│ 模型：Fast (Qwen2.5-7B)                                       │
│ 延迟：< 500ms                                                 │
│ SSE：fast_reply → done                                        │
└─────────────────────────────────────────────────────────────┘
    ↓ (需要实时数据)
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — Fast + web_search（L1）                             │
│ 触发条件：需要实时信息（天气/股价/新闻/比分）                   │
│ 模型：Fast + web_search 工具                                  │
│ 延迟：500ms ~ 2s                                             │
│ SSE：fast_reply（工具调用结果）→ done                         │
└─────────────────────────────────────────────────────────────┘
    ↓ (需要深度推理 / 多步任务)
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 — Slow 委托（L2）                                    │
│ 触发条件：复杂分析 / 深度调研 / 多步推理 / 创作                │
│ 模型：Slow (Qwen2.5-72B-Instruct)                            │
│ 延迟：3s ~ 5min（自适应安抚消息 30s/60s/120s）                │
│ SSE：fast_reply → status（安抚）→ result → done              │
└─────────────────────────────────────────────────────────────┘
    ↓ (Phase C 未来扩展)
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — Execute 模式（L3）                                  │
│ 触发条件：body.execute = true                                 │
│ 模型：Slow + 工具执行循环（ExecutionLoop）                    │
│ SSE：streaming chunks + done                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 路由决策逻辑（已实现）

路由完全由 **Fast 模型自判断**（LLM-Native），无硬编码阈值：

| 规则 | Fast Prompt 判断 | 结果 |
|------|----------------|------|
| 闲聊/问候 | 规则 1 | 直接回复 → L0 |
| 需要实时数据 | 规则 2 + web_search | 调用工具 → L1 |
| 模糊/缺少信息 | 规则 3 → 【CLARIFYING_REQUEST】 | 澄清 → L0+clarifying |
| 复杂/深度 | 规则 4 → 【SLOW_MODEL_REQUEST】 | 委托 → L2 |
| 其他 | 规则 5 | 直接回复 → L0 |

**Fast → Slow 唯一介质：结构化 JSON command（写入 TaskArchive），Slow 只读 Task Brief，不读历史对话。**

---

## 4. SSE 事件 routing_layer 字段（已实现）

所有 SSE 事件统一携带 `routing_layer` 字段：

```typescript
type SSEEvent = {
  type: "status" | "result" | "error" | "done" | "chunk" | "fast_reply" | "clarifying";
  stream: string;           // 统一用 stream 字段
  routing_layer?: "L0" | "L1" | "L2" | "L3";  // Phase 2.0 显式分层
  options?: string[];        // clarifying 专用
  question_id?: string;      // clarifying 专用
}
```

| 事件 | routing_layer | 说明 |
|------|--------------|------|
| fast_reply | L0/L1/L2 | Fast 模型首 token 立即推送 |
| clarifying | L0 | Fast 请求澄清 |
| chunk | L0/L1 | Fast 直推流式输出 |
| status | L2 | Slow 执行中安抚消息 |
| result | L2 | Slow 执行完成 |
| error | L2 | Slow 执行失败 |
| done | L0/L1/L2 | 流结束标识 |

---

## 5. `/api/chat/eval/routing` 端点（已实现）

Benchmark 专用路由评估端点，返回结构化路由决策：

```bash
curl -s -X POST http://localhost:3001/api/chat/eval/routing \
  -H "Content-Type: application/json" \
  -d '{"message": "分析一下茅台的财务状况", "language": "zh"}' | jq
```

响应：
```json
{
  "routing_intent": "analysis",
  "selected_role": "slow",
  "tool_used": null,
  "fast_reply": "让我深入分析一下这个问题",
  "confidence": 0.85,
  "routing_layer": "L2",
  "latency_ms": 312
}
```

---

## 6. 前端 routing_layer 可视化（已实现）

前端 UI 根据 `routing_layer` 渲染分层 badge：

| Layer | 颜色 | 场景 |
|-------|------|------|
| L0 | 灰色（#9CA3AF） | 闲聊/简单问答 |
| L1 | 蓝色（#3B82F6） | 实时数据查询 |
| L2 | 紫色（#8B5CF6） | 复杂任务委托 |
| L3 | 橙色（#F97316） | Execute 模式 |

---

## 7. Benchmark 测试用例

### Layer 0 测试用例
| ID | 消息 | 期望 layer |
|----|------|-----------|
| L0-01 | "你好" | L0 |
| L0-02 | "谢谢！" | L0 |
| L0-03 | "今天心情不错" | L0 |
| L0-04 | "1+1等于几？" | L0 |
| L0-05 | "什么是AI？" | L0 |

### Layer 1 测试用例
| ID | 消息 | 期望 layer |
|----|------|-----------|
| L1-01 | "今天北京天气怎么样？" | L1 |
| L1-02 | "腾讯今天的股价" | L1 |
| L1-03 | "今天有什么新闻？" | L1 |
| L1-04 | "昨天的世界杯比赛结果" | L1 |

### Layer 2 测试用例
| ID | 消息 | 期望 layer |
|----|------|-----------|
| L2-01 | "帮我分析一下茅台和五粮液的财务数据对比" | L2 |
| L2-02 | "写一篇关于AI大模型的深度研究报告" | L2 |
| L2-03 | "帮我写一个爬取网页的Python脚本" | L2 |
| L2-04 | "帮我制定一个三个月的健身计划" | L2 |

---

## 8. 验收标准

- [x] 所有 SSE 事件携带 `routing_layer` 字段（L0/L1/L2/L3）
- [x] `/api/chat/eval/routing` 返回 `routing_layer` 字段
- [x] `inferRoutingLayer()` 逻辑覆盖全部 4 种路径
- [x] Phase 1.5 Clarifying 流程不受影响
- [x] Phase 1 直接回复路径（无 orchestrator）不受影响
- [x] Benchmark routing accuracy ≥ 50%，intent accuracy ≥ 70%
- [x] tsc --noEmit 0 errors

---

## 9. 技术债务

- Phase 1.5 Clarifying 流程 UX（前端弹窗）尚未完全集成
- Layer 3 Execute 模式为预留接口，未完整实现前端触发
- Benchmark 测试用例尚未覆盖 L0/L1/L2 各 10 条

---

_Phase 2.0 完成日期：2026-04-18，commit `c49c88a`_
