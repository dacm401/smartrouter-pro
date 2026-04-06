"use client";
import { useState } from "react";
import { Badge } from "../ui/Badge";
import { Progress } from "../ui/Progress";
import { formatCost, formatTokens } from "@/lib/utils";

interface DecisionCardProps { decision: any; }

export function DecisionCard({ decision }: DecisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  if (!decision) return null;
  const { routing, context, execution } = decision;
  const isFast = routing?.selected_role === "fast";

  return (
    <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden text-xs">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">🔍</span>
          <Badge variant={isFast ? "fast" : "slow"}>{isFast ? "⚡ 快模型" : "🧠 慢模型"}</Badge>
          <span className="text-gray-500">{formatTokens((execution?.input_tokens || 0) + (execution?.output_tokens || 0))} tokens</span>
          <span className="text-gray-500">{formatCost(execution?.total_cost_usd || 0)}</span>
          {execution?.did_fallback && <Badge variant="warn">🔄 已升级</Badge>}
        </div>
        <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="px-3 py-3 space-y-3 bg-white">
          <div>
            <div className="text-gray-500 mb-1 font-medium">📊 路由决策</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex justify-between text-gray-600"><span>快模型</span><span>{Math.round((routing?.scores?.fast || 0) * 100)}%</span></div>
                <Progress value={(routing?.scores?.fast || 0) * 100} color="bg-fast" />
              </div>
              <div>
                <div className="flex justify-between text-gray-600"><span>慢模型</span><span>{Math.round((routing?.scores?.slow || 0) * 100)}%</span></div>
                <Progress value={(routing?.scores?.slow || 0) * 100} color="bg-slow" />
              </div>
            </div>
            <div className="mt-1 text-gray-500">置信度: <span className="font-mono">{Math.round((routing?.confidence || 0) * 100)}%</span> · {routing?.selection_reason}</div>
          </div>
          <div>
            <div className="text-gray-500 mb-1 font-medium">📦 Token 使用</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-50 rounded p-2"><div className="text-gray-400">输入</div><div className="font-mono font-bold">{formatTokens(execution?.input_tokens || 0)}</div></div>
              <div className="bg-gray-50 rounded p-2"><div className="text-gray-400">输出</div><div className="font-mono font-bold">{formatTokens(execution?.output_tokens || 0)}</div></div>
              <div className="bg-gray-50 rounded p-2"><div className="text-gray-400">费用</div><div className="font-mono font-bold text-fast">{formatCost(execution?.total_cost_usd || 0)}</div></div>
            </div>
          </div>
          {context?.compression_ratio > 0 && (
            <div>
              <div className="text-gray-500 mb-1 font-medium">🗜️ 上下文压缩</div>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">{formatTokens(context.original_tokens)}</span>
                <span className="text-gray-400">→</span>
                <span className="text-fast font-bold">{formatTokens(context.compressed_tokens)}</span>
                <Badge variant="fast">省 {Math.round(context.compression_ratio * 100)}%</Badge>
              </div>
            </div>
          )}
          <div className="flex items-center gap-4 text-gray-500">
            <span>⏱️ {execution?.latency_ms}ms</span>
            <span>🤖 {execution?.model_used}</span>
          </div>
        </div>
      )}
    </div>
  );
}
