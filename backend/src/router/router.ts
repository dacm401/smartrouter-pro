import type { ChatRequest, InputFeatures, RoutingDecision } from "../types/index.js";
import { analyzeIntent, analyzeIntentWithLLM, hasCode, hasMath } from "./intent-analyzer.js";
import { scoreComplexity } from "./complexity-scorer.js";
import { ruleRoute } from "./rule-router.js";
import { MemoryRepo } from "../db/repositories.js";
import { countTokens } from "../models/token-counter.js";
import { config } from "../config.js";

export async function analyzeAndRoute(request: ChatRequest): Promise<{ features: InputFeatures; routing: RoutingDecision }> {
  const { message, history = [], user_id } = request;

  // SP28-A: 优先使用 LLM-based intent classifier，失败时降级到正则
  let intent: ReturnType<typeof analyzeIntent> = "unknown";
  try {
    intent = await analyzeIntentWithLLM(
      message,
      config.openaiApiKey,
      config.openaiBaseUrl || "https://api.openai.com/v1",
      config.fastModel
    );
  } catch {
    // LLM 失败，降级到正则
    intent = analyzeIntent(message);
  }

  const tokenCount = countTokens(message);
  const contextTokens = history.reduce((sum, m) => sum + countTokens(m.content), 0);
  const { score: complexityScore } = scoreComplexity(message, intent, history ?? []);

  const features: InputFeatures = {
    raw_query: message, token_count: tokenCount, intent, complexity_score: complexityScore,
    has_code: hasCode(message), has_math: hasMath(message), requires_reasoning: complexityScore > 60,
    conversation_depth: history.filter((m) => m.role === "user").length, context_token_count: contextTokens,
    language: detectLanguage(message),
  };

  const [identity, behaviors] = await Promise.all([
    MemoryRepo.getIdentity(user_id),
    MemoryRepo.getBehavioralMemories(user_id),
  ]);

  const routing = ruleRoute(features, identity, behaviors);
  return { features, routing };
}

function detectLanguage(text: string): string {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g);
  if (chineseChars && chineseChars.length > text.length * 0.1) return "zh";
  return "en";
}
