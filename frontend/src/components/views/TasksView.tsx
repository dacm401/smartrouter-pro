"use client";
import { useState, useEffect } from "react";
import { fetchTasks, fetchTraces, fetchEvidence, patchTask } from "@/lib/api";
import { API_BASE } from "@/lib/api";
import { TracePanel } from "@/components/workbench/TracePanel";
import { EvidencePanel } from "@/components/workbench/EvidencePanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskItem {
  task_id: string;
  title: string;
  mode: string;
  status: string;
  updated_at: string;
  goal?: string;
}

interface TraceItem {
  trace_id: string;
  type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface EvidenceItem {
  evidence_id: string;
  source: string;
  content: string;
  source_metadata: Record<string, unknown> | null;
  relevance_score: number | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "刚刚";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  if (hrs < 48) return "昨天";
  return `${Math.floor(hrs / 24)}天前`;
}

const STATUS_DOT: Record<string, { color: string; label: string; pulse?: boolean }> = {
  active:     { color: "var(--accent-green)", label: "活跃",   pulse: true },
  executing:  { color: "var(--accent-green)", label: "执行中", pulse: true },
  responding: { color: "var(--accent-green)", label: "响应中", pulse: true },
  completed:  { color: "var(--accent-blue)",  label: "已完成" },
  paused:    { color: "var(--accent-amber)", label: "已暂停" },
  failed:    { color: "var(--accent-red)",   label: "失败" },
  cancelled: { color: "var(--text-muted)",   label: "已取消" },
  created:   { color: "var(--accent-blue)",  label: "已创建" },
  classified:{ color: "var(--accent-blue)",  label: "已分类" },
  planning:  { color: "var(--accent-blue)",  label: "规划中" },
};

const INTENT_COLORS: Record<string, string> = {
  code:     "rgba(59,130,246,0.2)",
  math:     "rgba(139,92,246,0.2)",
  creative: "rgba(236,72,153,0.2)",
  chat:     "rgba(107,114,128,0.2)",
};
const INTENT_TEXT: Record<string, string> = {
  code:     "var(--text-accent)",
  math:     "var(--accent-purple)",
  creative: "#ec4899",
  chat:     "var(--text-muted)",
};

function intentBadge(mode: string): { bg: string; color: string } {
  const key = mode.toLowerCase();
  return {
    bg: INTENT_COLORS[key] ?? "var(--bg-elevated)",
    color: INTENT_TEXT[key] ?? "var(--text-secondary)",
  };
}

function taskTitle(task: TaskItem): string {
  const src = task.goal || task.title || "";
  if (!src) return `#${task.task_id.slice(0, 8)}`;
  return src.length > 40 ? src.slice(0, 40) + "…" : src;
}

// ─── Trace rendering (inlined from TracePanel logic) ─────────────────────────

const TRACE_TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  planning:     { icon: "🧠", color: "var(--accent-purple)" },
  classification:{ icon: "🏷️", color: "var(--text-accent)" },
  routing:      { icon: "🔀", color: "var(--accent-blue)" },
  response:     { icon: "💬", color: "var(--accent-green)" },
  step:         { icon: "⚙️", color: "var(--accent-amber)" },
  error:        { icon: "❌", color: "var(--accent-red)" },
};

function formatTraceDetail(type: string, detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  switch (type) {
    case "classification":
      return `intent: ${detail.intent ?? "?"} · complexity: ${detail.complexity_score ?? "?"}`;
    case "routing":
      return `${detail.selected_model ?? "?"} (${detail.selected_role ?? "?"}) · 置信 ${detail.confidence ?? "?"}`;
    case "response":
      return `tokens: ${detail.input_tokens ?? "?"}+${detail.output_tokens ?? "?"} · ${detail.latency_ms ?? "?"}ms`;
    case "planning":
      return `${detail.goal ?? ""} · ${detail.completed_steps ?? 0} steps done`;
    default:
      return JSON.stringify(detail).slice(0, 120);
  }
}

function TraceList({ traces, showAll, onToggle }: { traces: TraceItem[]; showAll: boolean; onToggle: () => void }) {
  if (traces.length === 0) {
    return <p className="text-xs" style={{ color: "var(--text-muted)" }}>暂无轨迹记录</p>;
  }
  const shown = showAll ? traces : traces.slice(0, 10);
  return (
    <div className="space-y-1">
      {shown.map((t) => {
        const cfg = TRACE_TYPE_CONFIG[t.type] ?? { icon: "📋", color: "var(--text-muted)" };
        return (
          <div key={t.trace_id} className="flex items-start gap-2 text-xs">
            <span style={{ color: cfg.color }}>{cfg.icon}</span>
            <span className="font-medium" style={{ color: cfg.color }}>{t.type}</span>
            <span className="flex-1" style={{ color: "var(--text-secondary)" }}>
              {formatTraceDetail(t.type, t.detail) || <em style={{ color: "var(--text-muted)" }}>无详情</em>}
            </span>
            <span className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>
              {new Date(t.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        );
      })}
      {traces.length > 10 && (
        <button onClick={onToggle} className="text-xs pt-1" style={{ color: "var(--text-accent)" }}>
          {showAll ? `↑ 收起` : `查看全部 ${traces.length} 条`}
        </button>
      )}
    </div>
  );
}

// ─── Evidence rendering (inlined from EvidencePanel logic) ─────────────────

const SOURCE_CONFIG: Record<string, { icon: string; label: string; bg: string; color: string }> = {
  web_search:  { icon: "🔍", label: "搜索", bg: "rgba(59,130,246,0.1)", color: "var(--text-accent)" },
  http_request: { icon: "🌐", label: "HTTP", bg: "rgba(139,92,246,0.1)", color: "var(--accent-purple)" },
  manual:       { icon: "✍️", label: "手动", bg: "rgba(16,185,129,0.1)", color: "var(--accent-green)" },
};

function EvidenceList({ evidences }: { evidences: EvidenceItem[] }) {
  if (evidences.length === 0) {
    return <p className="text-xs" style={{ color: "var(--text-muted)" }}>暂无关联证据</p>;
  }
  return (
    <div className="space-y-3">
      {evidences.map((ev) => {
        const cfg = SOURCE_CONFIG[ev.source] ?? SOURCE_CONFIG.manual;
        return (
          <div key={ev.evidence_id} className="text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: cfg.bg, color: cfg.color }}
              >
                {cfg.icon} {cfg.label}
              </span>
              {ev.relevance_score !== null && (
                <span style={{ color: "var(--text-muted)" }}>相关度: {(ev.relevance_score * 100).toFixed(0)}%</span>
              )}
            </div>
            <p className="leading-relaxed line-clamp-4" style={{ color: "var(--text-secondary)" }}>
              {ev.content}
            </p>
            {ev.source_metadata && Boolean(ev.source_metadata.url) && (
              <a
                href={String(ev.source_metadata.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-1 truncate"
                style={{ color: "var(--text-accent)" }}
              >
                {String(ev.source_metadata.url)}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface TasksViewProps {
  userId: string;
}

export default function TasksView({ userId }: TasksViewProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [traces, setTraces] = useState<TraceItem[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [showAllTraces, setShowAllTraces] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const loadTasks = () => {
    setListLoading(true);
    setListError(null);
    fetchTasks(userId)
      .then((data) => setTasks(data.tasks ?? []))
      .catch((e: Error) => setListError(e.message))
      .finally(() => setListLoading(false));
  };

  useEffect(() => { loadTasks(); }, [userId]);

  // When a task is selected, load summary + traces + evidence in parallel
  useEffect(() => {
    if (!selectedTaskId) return;
    setDetailLoading(true);
    setSummary(null);
    setSummaryError(false);
    setTraces([]);
    setEvidence([]);
    setShowAllTraces(false);

    const loadAll = async () => {
      const [summaryRes, tracesRes, evidenceRes] = await Promise.allSettled([
        fetch(`${API_BASE}/v1/tasks/${encodeURIComponent(selectedTaskId)}/summary`, {
          headers: { "X-User-Id": userId },
        }).then(r => r.ok ? r.json() : Promise.reject(r)),
        fetchTraces(selectedTaskId, userId),
        fetchEvidence(selectedTaskId, userId),
      ]);

      if (summaryRes.status === "fulfilled") {
        const d = (summaryRes as PromiseFulfilledResult<{ summary?: string }>).value;
        setSummary(d.summary ?? null);
      } else {
        setSummaryError(true);
      }

      if (tracesRes.status === "fulfilled") {
        setTraces(tracesRes.value.traces ?? []);
      }
      if (evidenceRes.status === "fulfilled") {
        setEvidence(evidenceRes.value.evidences ?? []);
      }
      setDetailLoading(false);
    };

    loadAll();
  }, [selectedTaskId, userId]);

  const handleAction = async (action: "pause" | "resume" | "cancel") => {
    if (!selectedTaskId) return;
    if (action === "cancel" && !confirm("确定要取消此任务吗？")) return;
    setActionLoading(true);
    const ok = await patchTask(selectedTaskId, userId, action);
    setActionLoading(false);
    if (ok) {
      // Update local task status
      setTasks(prev => prev.map(t =>
        t.task_id === selectedTaskId
          ? { ...t, status: action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled" }
          : t
      ));
      // Reload full list to be safe
      loadTasks();
    }
  };

  const selectedTask = tasks.find(t => t.task_id === selectedTaskId) ?? null;
  const statusInfo = selectedTask ? (STATUS_DOT[selectedTask.status] ?? { color: "var(--text-muted)", label: selectedTask.status }) : null;

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* ── Left: task list ─────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex flex-col overflow-hidden"
        style={{
          width: 280,
          borderRight: "1px solid var(--border-subtle)",
          backgroundColor: "var(--bg-surface)",
        }}
      >
        {/* List header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>任务中心</span>
            {!listLoading && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                共 {tasks.length} 个
              </span>
            )}
          </div>
          <button
            onClick={loadTasks}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            title="刷新"
          >
            🔄
          </button>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {listLoading && (
            <div className="p-4 space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-14 rounded-lg animate-pulse" style={{ backgroundColor: "var(--bg-elevated)" }} />
              ))}
            </div>
          )}
          {listError && (
            <div className="mx-3 my-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
              ⚠️ {listError}
            </div>
          )}
          {!listLoading && !listError && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-1">
              <span className="text-2xl">📋</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>暂无任务记录</span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>发送消息后会出现在这里</span>
            </div>
          )}
          {!listLoading && tasks.map(task => {
            const s = STATUS_DOT[task.status] ?? { color: "var(--text-muted)", label: task.status };
            const ib = intentBadge(task.mode);
            const isSelected = selectedTaskId === task.task_id;
            return (
              <button
                key={task.task_id}
                onClick={() => setSelectedTaskId(task.task_id)}
                className="w-full text-left px-4 py-3 transition-all group"
                style={{
                  backgroundColor: isSelected ? "var(--bg-elevated)" : "transparent",
                  borderBottom: "1px solid var(--border-subtle)",
                  borderLeft: isSelected ? "2px solid var(--accent-blue)" : "2px solid transparent",
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.pulse ? "animate-pulse" : ""}`}
                    style={{ backgroundColor: s.color }}
                  />
                  <span
                    className="text-xs font-medium truncate flex-1"
                    style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}
                  >
                    {taskTitle(task)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ backgroundColor: ib.bg, color: ib.color }}
                  >
                    {task.mode}
                  </span>
                  <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
                    {relativeTime(task.updated_at)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: task detail ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedTaskId && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="text-5xl" style={{ color: "var(--text-muted)", opacity: 0.4 }}>📋</span>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>从左侧选择一个任务查看详情</p>
          </div>
        )}

        {selectedTaskId && selectedTask && (
          <div>
            {/* Block 1: Header */}
            <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                {statusInfo && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${statusInfo.pulse ? "animate-pulse" : ""}`}
                    style={{ backgroundColor: statusInfo.color + "20", color: statusInfo.color }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusInfo.color }} />
                    {statusInfo.label}
                  </span>
                )}
                <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                  #{selectedTask.task_id.slice(0, 8)}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {new Date(selectedTask.updated_at).toLocaleString("zh-CN")}
                </span>
              </div>
              <p className="text-sm mb-3" style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                {selectedTask.goal || selectedTask.title || "无描述"}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {["active","executing","responding"].includes(selectedTask.status) && (
                  <button
                    onClick={() => handleAction("pause")}
                    disabled={actionLoading}
                    className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ backgroundColor: "rgba(251,191,36,0.15)", color: "var(--accent-amber)" }}
                  >
                    ⏸ 暂停
                  </button>
                )}
                {selectedTask.status === "paused" && (
                  <button
                    onClick={() => handleAction("resume")}
                    disabled={actionLoading}
                    className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "var(--accent-green)" }}
                  >
                    ▶ 恢复
                  </button>
                )}
                {!["completed","cancelled","failed"].includes(selectedTask.status) && (
                  <button
                    onClick={() => handleAction("cancel")}
                    disabled={actionLoading}
                    className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "var(--accent-red)" }}
                  >
                    ✕ 取消
                  </button>
                )}
              </div>
            </div>

            {/* Block 2: Summary */}
            <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">📝</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>摘要</span>
              </div>
              {detailLoading ? (
                <div className="h-4 w-48 rounded animate-pulse" style={{ backgroundColor: "var(--bg-elevated)" }} />
              ) : summaryError || summary === null ? (
                <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>暂无摘要</p>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                  {summary}
                </p>
              )}
            </div>

            {/* Block 3: Traces */}
            <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">⚡</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>执行轨迹</span>
                {!detailLoading && traces.length > 0 && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{traces.length} 条</span>
                )}
              </div>
              {detailLoading ? (
                <div className="space-y-2">
                  {[0,1,2].map(i => <div key={i} className="h-4 rounded animate-pulse" style={{ width: `${60+i*15}%`, backgroundColor: "var(--bg-elevated)" }} />)}
                </div>
              ) : (
                <TraceList traces={traces} showAll={showAllTraces} onToggle={() => setShowAllTraces(v => !v)} />
              )}
            </div>

            {/* Block 4: Evidence */}
            <div className="px-6 py-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">🔍</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>关联证据</span>
                {!detailLoading && evidence.length > 0 && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{evidence.length} 条</span>
                )}
              </div>
              {detailLoading ? (
                <div className="space-y-2">
                  {[0,1].map(i => <div key={i} className="h-12 rounded animate-pulse" style={{ backgroundColor: "var(--bg-elevated)" }} />)}
                </div>
              ) : (
                <EvidenceList evidences={evidence} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
