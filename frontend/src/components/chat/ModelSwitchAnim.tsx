"use client";
import { useEffect, useState } from "react";

interface ModelSwitchAnimProps { fromModel: string; toModel: string; reason: string; onDone: () => void; }

export function ModelSwitchAnim({ fromModel, toModel, reason, onDone }: ModelSwitchAnimProps) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [setTimeout(() => setStep(1), 500), setTimeout(() => setStep(2), 1200), setTimeout(() => setStep(3), 2000), setTimeout(() => { setStep(4); onDone(); }, 2800)];
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  return (
    <div className="flex justify-start mb-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm max-w-sm">
        <div className={`flex items-center gap-2 transition-opacity ${step >= 0 ? "opacity-100" : "opacity-0"}`}>
          <span className="text-amber-500">⚠️</span>
          <span className="text-amber-700">质量检测未通过：{reason}</span>
        </div>
        {step >= 1 && <div className="flex items-center gap-2 mt-2 text-gray-500"><span className="line-through opacity-50">⚡ {fromModel}</span><span className="animate-pulse">→</span><span className="text-indigo-600 font-medium">🧠 {toModel}</span></div>}
        {step >= 2 && <div className="mt-2 flex items-center gap-2 text-gray-500"><div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /><span>高级模型重新生成中...</span></div>}
        {step >= 3 && <div className="mt-2 text-green-600 flex items-center gap-1"><span>✓</span><span>已升级，质量保障</span></div>}
        {step >= 4 && <div className="mt-1 text-xs text-gray-400">💡 系统已学习：此类问题将优先使用高级模型</div>}
      </div>
    </div>
  );
}
