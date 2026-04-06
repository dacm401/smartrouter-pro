# SmartRouter Pro - 透明AI路由专家

> **透明的、会成长的 AI 智能运行时**
> 你能看到它在思考，你能看到它在成长。

## 核心特性

| 特性 | 说明 |
|------|------|
| 智能路由 | 自动判断任务复杂度，选择最优模型 |
| 完全透明 | 每次决策的模型选择、理由、Token消耗全部可见 |
| 上下文压缩 | 四级压缩策略，节省20-70% Token |
| 质量门控 | 快模型回答不达标时自动升级到慢模型 |
| 学习进化 | 从每次反馈中学习，越用越懂你 |
| 实时仪表盘 | Token流向图、决策时间线、成长曲线 |

## 快速启动

```bash
# 使用Docker一键启动
docker-compose up -d

# 或前端独立运行
cd frontend && npm install && npm run dev
```

## 技术栈

- **后端**: TypeScript + Hono + PostgreSQL + Redis
- **前端**: Next.js 14 + Tailwind CSS + Recharts
- **部署**: Docker Compose

## 项目结构

```
smartrouter-pro/
├── backend/          # 核心运行时
│   └── src/
│       ├── router/   # 智能路由层
│       ├── context/  # 上下文管理层
│       ├── models/   # 模型接入层
│       ├── evolution/# 学习进化层
│       └── observatory/ # 透明观测层
├── frontend/         # 仪表盘 + 对话界面
└── docker-compose.yml
```

## 许可

MIT License
