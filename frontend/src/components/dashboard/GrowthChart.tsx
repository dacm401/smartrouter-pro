"use client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card } from "../ui/Card";
import { Progress } from "../ui/Progress";

interface GrowthChartProps { growth: any; }

export function GrowthChart({ growth }: GrowthChartProps) {
  if (!growth) return null;
  const history = growth.routing_accuracy_history || [];

  return (
    <Card>
      <h3 className="font-semibold text-gray-700 mb-4">📈 成长轨迹</h3>
      <div className="flex items-center gap-4 mb-4 p-3 bg-purple-50 rounded-xl">
        <div className="text-3xl font-black text-purple-600">Lv.{growth.level || 1}</div>
        <div className="flex-1">
          <div className="font-semibold text-purple-700 text-sm">{growth.level_name || "初次见面"}</div>
          <Progress value={growth.level_progress || 0} color="bg-purple-500" className="mt-1" />
          <div className="text-xs text-purple-400 mt-0.5">{growth.level_progress || 0}% → 下一等级</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4 text-center text-xs">
        <div className="bg-gray-50 rounded-lg p-2"><div className="text-gray-400">满意率</div><div className="font-bold text-indigo-600 text-lg">{Math.round(growth.routing_accuracy || 0)}%</div></div>
        <div className="bg-gray-50 rounded-lg p-2"><div className="text-gray-400">累计节省</div><div className="font-bold text-green-600 text-lg">${(growth.total_saved_usd || 0).toFixed(2)}</div></div>
        <div className="bg-gray-50 rounded-lg p-2"><div className="text-gray-400">行为记忆</div><div className="font-bold text-amber-600 text-lg">{growth.behavioral_memories_count || 0}条</div></div>
      </div>
      {history.length > 1 && (
        <div>
          <div className="text-xs text-gray-500 mb-2">近30天满意率趋势</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: any) => [`${v}%`, "满意率"]} labelFormatter={(l) => `日期: ${l}`} />
              <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
