"use client";
import { useState, useEffect } from "react";
import { fetchTraces } from "@/lib/api";

interface TraceItem {
  trace_id: string;
  type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface TracePanelProps {
  taskId: string | null;
  userId: string;
}

const TYPE_ICONS: Record<string, string> = {
  planning: "🧠",
  classification: "🏷️",
  routing: "🔀",
  response: "💬",
  step: "⚙️",
  error: "❌",
};

function formatDetail(type: string, detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  try {
    switch (type) {
      case "classification":
        return `intent: ${detail.intent ?? "?"} | complexity: ${detail.complexity_score ?? "?"}`;
      case "routing":
        return `${detail.selected_model ?? "?"} (${detail.selected_role ?? "?"}) | confidence: ${detail.confidence ?? "?"}`;
      case "response":
        return `tokens: ${detail.input_tokens ?? "?"}+${detail.output_tokens ?? "?"} | ${detail.latency_ms ?? "?"}ms`;
      case "planning":
        return `${detail.goal ?? ""} | ${detail.completed_steps ?? 0} steps done`;
      default:
        return JSON.stringify(detail).slice(0, 100);
    }
  } catch {
    return "";
  }
}

export function TracePanel({ taskId, userId }: TracePanelProps) {
  const [traces, setTraces] = useState<TraceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) { setTraces([]); return; }
    setLoading(true);
    setError(null);
    fetchTraces(taskId, userId)
      .then((data) => setTraces(data.traces ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, userId]);

  if (!taskId) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b bg-gray-50 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">📡 轨迹</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-gray-400">先选择一个任务</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b bg-gray-50 flex-shrink-0 flex justify-between items-center">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">📡 轨迹</span>
        <span className="text-xs text-gray-400">{traces.length} 条</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-gray-400 text-center">加载中...</div>}
        {error && <div className="p-3 text-xs text-red-500">⚠️ {error}</div>}
        {!loading && !error && traces.length === 0 && (
          <div className="p-4 text-xs text-gray-400 text-center">此任务暂无执行轨迹</div>
        )}
        {traces.map((trace) => (
          <div key={trace.trace_id} className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-sm">{TYPE_ICONS[trace.type] ?? "📋"}</span>
              <span className="text-xs font-medium text-gray-700">{trace.type}</span>
              <span className="ml-auto text-[10px] text-gray-400">
                {new Date(trace.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              {formatDetail(trace.type, trace.detail) || <span className="italic text-gray-300">无详情</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
