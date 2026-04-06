// 获取API配置
export function getApiConfig() {
  if (typeof window !== "undefined") {
    return {
      apiBase: localStorage.getItem("api_url") || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
      apiKey: localStorage.getItem("api_key") || "",
      fastModel: localStorage.getItem("fast_model") || "gpt-4o-mini",
      slowModel: localStorage.getItem("slow_model") || "gpt-4o",
    };
  }
  return {
    apiBase: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
    apiKey: "",
    fastModel: "gpt-4o-mini",
    slowModel: "gpt-4o",
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function sendMessage(message: string, history: any[], userId: string, sessionId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, session_id: sessionId, message, history }),
  });
  return res.json();
}

export async function getDashboard(userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/dashboard/${userId}`);
  return res.json();
}

export async function getGrowth(userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/growth/${userId}`);
  return res.json();
}

export async function sendFeedback(decisionId: string, type: string) {
  const { apiBase } = getApiConfig();
  await fetch(`${apiBase}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision_id: decisionId, feedback_type: type }),
  });
}
