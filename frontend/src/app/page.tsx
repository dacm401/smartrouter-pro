"use client";
import { useState } from "react";
import Link from "next/link";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { SettingsModal } from "@/components/chat/SettingsModal";

export default function HomePage() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0 relative">
        <div className="flex items-center gap-2">
          <span className="text-xl">🚀</span>
          <span className="font-bold text-gray-800">SmartRouter Pro</span>
          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">v1.0</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">透明 · 可观测 · 会成长</span>
          <Link href="/dashboard" className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
            📊 仪表盘
          </Link>
          <button 
            onClick={() => setShowSettings(true)} 
            className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            ⚙️ 设置
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden max-w-3xl w-full mx-auto">
        <ChatInterface />
      </main>
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
