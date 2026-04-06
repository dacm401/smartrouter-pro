"use client";
import { Card } from "../ui/Card";
import { formatTokens } from "@/lib/utils";

interface TokenSankeyProps { tokenFlow: { fast_tokens: number; slow_tokens: number; compressed_tokens: number; fallback_tokens: number }; }

export function TokenSankey({ tokenFlow }: TokenSankeyProps) {
  const total = (tokenFlow?.fast_tokens || 0) + (tokenFlow?.slow_tokens || 0) + (tokenFlow?.fallback_tokens || 0);
  if (total === 0) return <Card><h3 className="font-semibold text-gray-700 mb-3">📊 Token 流向图</h3><div className="text-center text-gray-400 py-8 text-sm">暂无数据</div></Card>;

  const fastPct = Math.round(((tokenFlow?.fast_tokens || 0) / total) * 100);
  const slowPct = Math.round(((tokenFlow?.slow_tokens || 0) / total) * 100);
  const fallbackPct = Math.round(((tokenFlow?.fallback_tokens || 0) / total) * 100);

  return (
    <Card>
      <h3 className="font-semibold text-gray-700 mb-4">📊 Token 流向图</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-20 text-right text-gray-500 text-xs">总计<br /><span className="font-mono font-bold text-gray-700">{formatTokens(total)}</span></div>
          <div className="flex-1">
            <div className="flex h-8 rounded-lg overflow-hidden gap-0.5">
              {fastPct > 0 && <div className="bg-green-400 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${fastPct}%` }}>{fastPct > 10 ? `${fastPct}%` : ""}</div>}
              {slowPct > 0 && <div className="bg-indigo-400 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${slowPct}%` }}>{slowPct > 10 ? `${slowPct}%` : ""}</div>}
              {fallbackPct > 0 && <div className="bg-amber-400 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${fallbackPct}%` }}>{fallbackPct > 5 ? `${fallbackPct}%` : ""}</div>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-green-400" /><span className="text-gray-600">⚡ 快模型 {formatTokens(tokenFlow.fast_tokens || 0)}</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-indigo-400" /><span className="text-gray-600">🧠 慢模型 {formatTokens(tokenFlow.slow_tokens || 0)}</span></div>
          {(tokenFlow.fallback_tokens || 0) > 0 && <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-400" /><span className="text-gray-600">🔄 Fallback {formatTokens(tokenFlow.fallback_tokens || 0)}</span></div>}
        </div>
      </div>
    </Card>
  );
}
