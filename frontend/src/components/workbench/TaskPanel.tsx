"use client";
import { useState, useEffect } from "react";
import { fetchTasks } from "@/lib/api";

interface TaskItem {
  task_id: string;
  title: string;
  mode: string;
  status: string;
  updated_at: string;
}

interface TaskPanelProps {
  userId: string;
  sessionId?: string;
  onTaskSelect?: (taskId: string) => void;
  selectedTaskId?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  responding: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  paused: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export function TaskPanel({ userId, sessionId, onTaskSelect, selectedTaskId }: TaskPanelProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTasks(userId, sessionId)
      .then((data) => setTasks(data.tasks ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, sessionId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">📋 任务</span>
        <span className="ml-2 text-xs text-gray-400">{tasks.length} 个任务</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-gray-400 text-center">加载中...</div>}
        {error && <div className="p-3 text-xs text-red-500">⚠️ {error}</div>}
        {!loading && !error && tasks.length === 0 && (
          <div className="p-4 text-xs text-gray-400 text-center">暂无任务记录</div>
        )}
        {tasks.map((task) => (
          <button
            key={task.task_id}
            onClick={() => onTaskSelect?.(task.task_id)}
            className={`w-full text-left px-3 py-2 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
              selectedTaskId === task.task_id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
            }`}
          >
            <div className="text-xs font-medium text-gray-800 truncate">{task.title || "(无标题)"}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[task.status] ?? "bg-gray-100 text-gray-600"}`}>
                {task.status}
              </span>
              <span className="text-[10px] text-gray-400">{task.mode}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
