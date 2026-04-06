"use client";
import { Card } from "../ui/Card";

interface LearningPanelProps { growth: any; }

export function LearningPanel({ growth }: LearningPanelProps) {
  const milestones = growth?.milestones || [];
  const learnings = growth?.recent_learnings || [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <h3 className="font-semibold text-gray-700 mb-3">💡 最近学到的</h3>
        {learnings.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">继续对话，系统会逐渐了解你的偏好</div>
        ) : (
          <div className="space-y-2">
            {learnings.map((l: any, i: number) => (
              <div key={i} className="flex gap-2 text-sm p-2 bg-blue-50 rounded-lg">
                <span className="text-blue-400 flex-shrink-0">🔵</span>
                <div><div className="text-gray-700">{l.learning}</div><div className="text-xs text-gray-400 mt-0.5">{l.date}</div></div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <h3 className="font-semibold text-gray-700 mb-3">🏆 成长里程碑</h3>
        {milestones.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">完成更多对话解锁里程碑</div>
        ) : (
          <div className="space-y-2">
            {milestones.map((m: any, i: number) => (
              <div key={i} className="flex gap-2 text-sm p-2 bg-yellow-50 rounded-lg">
                <span className="flex-shrink-0">🎖️</span>
                <div><div className="text-gray-700 font-medium">{m.event}</div><div className="text-xs text-gray-400 mt-0.5">{m.date}</div></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
