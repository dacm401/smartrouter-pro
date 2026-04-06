"use client";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { formatCost, formatTokens, timeAgo } from "@/lib/utils";

interface DecisionTimelineProps { decisions: any[]; }

const INTENT_LABELS: Record<string, string> = { simple_qa: "简单问答", reasoning: "分析推理", creative: "创意写作", code: "代码", math: "数学", translation: "翻译", summarization: "摘要", chat: "闲聊", unknown: "未知" };

export function DecisionTimeline({ decisions }: DecisionTimelineProps) {
  if (!decisions || decisions.length === 0) return <Card><h3 className="font-semibold text-gray-700 mb-3">🕐 决策时间线</h3><div className="text-center text-gray-400 py-8 text-sm">暂无决策记录</div></Card>;

  return (
    <Card>
      <h3 className="font-semibold text-gray-700 mb-4">🕐 决策时间线</h3>
      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {decisions.map((d: any, i: number) => {
          const isFast = d.routing?.selected_role === "fast";
          const complexity = d.input_features?.complexity_score || 0;
          return (
            <div key={d.id || i} className="border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-sm text-gray-700 font-medium truncate flex-1">"{d.input_features?.raw_query?.substring(0, 60)}..."</div>
                <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo(d.timestamp || Date.now())}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <Badge variant={isFast ? "fast" : "slow"}>{isFast ? "⚡ 快模型" : "🧠 慢模型"}</Badge>
                {d.execution?.did_fallback && <Badge variant="warn">🔄 已升级</Badge>}
                <Badge variant="default">{INTENT_LABELS[d.input_features?.intent] || "未知"}</Badge>
                <span className="text-xs text-gray-400">复杂度 <span className={complexity > 60 ? "text-red-500" : complexity > 30 ? "text-amber-500" : "text-green-500"}>{complexity}</span></span>
              </div>
              <div className="text-xs text-gray-500 mb-2 italic">{d.routing?.selection_reason}</div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>置信度 <span className="font-mono font-bold">{Math.round((d.routing?.confidence || 0) * 100)}%</span></span>
                <span>Token <span className="font-mono">{formatTokens((d.execution?.input_tokens || 0) + (d.execution?.output_tokens || 0))}</span></span>
                <span>费用 <span className="font-mono text-green-600">{formatCost(d.execution?.total_cost_usd || 0)}</span></span>
                <span>{d.execution?.latency_ms || 0}ms</span>
                {d.context?.compression_ratio > 0 && <span className="text-green-500">压缩省 {Math.round((d.context.compression_ratio || 0) * 100)}%</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
