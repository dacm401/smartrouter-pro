"use client";
import { useState, useEffect } from "react";
import { fetchEvidence } from "@/lib/api";

interface EvidenceItem {
  evidence_id: string;
  source: string;
  content: string;
  source_metadata: Record<string, unknown> | null;
  relevance_score: number | null;
  created_at: string;
}

interface EvidencePanelProps {
  taskId: string | null;
  userId: string;
}

const SOURCE_LABELS: Record<string, string> = {
  web_search: "🔍 搜索",
  http_request: "🌐 HTTP",
  manual: "✍️ 手动",
};

export function EvidencePanel({ taskId, userId }: EvidencePanelProps) {
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) { setEvidences([]); return; }
    setLoading(true);
    setError(null);
    fetchEvidence(taskId, userId)
      .then((data) => setEvidences(data.evidences ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, userId]);

  if (!taskId) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b bg-gray-50 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">🗂️ 证据</span>
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
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">🗂️ 证据</span>
        <span className="text-xs text-gray-400">{evidences.length} 条</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-gray-400 text-center">加载中...</div>}
        {error && <div className="p-3 text-xs text-red-500">⚠️ {error}</div>}
        {!loading && !error && evidences.length === 0 && (
          <div className="p-4 text-xs text-gray-400 text-center">此任务暂无证据记录</div>
        )}
        {evidences.map((ev) => (
          <div key={ev.evidence_id} className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                {SOURCE_LABELS[ev.source] ?? ev.source}
              </span>
              {ev.relevance_score !== null && (
                <span className="text-[10px] text-gray-400">
                  相关度: {(ev.relevance_score * 100).toFixed(0)}%
                </span>
              )}
              <span className="text-[10px] text-gray-400 ml-auto">
                {new Date(ev.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <p className="text-xs text-gray-700 line-clamp-4 leading-relaxed">
              {ev.content.length > 200 ? ev.content.slice(0, 200) + "…" : ev.content}
            </p>
            {ev.source_metadata && (
              <div className="mt-1 flex gap-2">
                {Boolean(ev.source_metadata.url) && (
                  <a
                    href={ev.source_metadata.url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-500 hover:underline truncate max-w-[160px]"
                  >
                    {String(ev.source_metadata.url)}
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
