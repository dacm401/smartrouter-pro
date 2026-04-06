"use client";
import { Card } from "../ui/Card";
import { formatCost, formatTokens } from "@/lib/utils";

interface StatsCardsProps { data: any; }

export function StatsCards({ data }: StatsCardsProps) {
  const today = data?.today || {};
  const growth = data?.growth || {};
  const stats = [
    { icon: "💰", label: "今日节省", value: formatCost(today.saved_cost || 0), sub: `节省率 ${today.saving_rate || 0}%`, color: "text-green-600", bg: "bg-green-50" },
    { icon: "🎯", label: "满意率", value: `${Math.round(today.routing_accuracy || 0)}%`, sub: `${today.total_requests || 0} 次对话`, color: "text-indigo-600", bg: "bg-indigo-50" },
    { icon: "⚡", label: "快模型使用", value: `${today.fast_count || 0}次`, sub: `慢模型 ${today.slow_count || 0}次`, color: "text-amber-600", bg: "bg-amber-50" },
    { icon: "📈", label: "成长等级", value: `Lv.${growth.level || 1}`, sub: growth.level_name || "初次见面", color: "text-purple-600", bg: "bg-purple-50" },
    { icon: "🔄", label: "Fallback", value: `${today.fallback_count || 0}次`, sub: "质量升级触发", color: "text-orange-600", bg: "bg-orange-50" },
    { icon: "⏱️", label: "平均延迟", value: `${today.avg_latency_ms || 0}ms`, sub: `总 Token ${formatTokens(today.total_tokens || 0)}`, color: "text-blue-600", bg: "bg-blue-50" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map((s) => (
        <Card key={s.label} className={`${s.bg} border-0`}>
          <div className="text-2xl mb-1">{s.icon}</div>
          <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-xs text-gray-500 font-medium">{s.label}</div>
          <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>
        </Card>
      ))}
    </div>
  );
}
