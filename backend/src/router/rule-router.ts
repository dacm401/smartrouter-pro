import type { InputFeatures, RoutingDecision, BehavioralMemory, IdentityMemory, ModelRole } from "../types/index.js";
import { config } from "../config.js";

const FAST_FRIENDLY_INTENTS = new Set(["simple_qa", "chat", "translation"]);
const SLOW_PREFERRED_INTENTS = new Set(["reasoning", "math", "code"]);

export function ruleRoute(features: InputFeatures, identity: IdentityMemory | null, behaviors: BehavioralMemory[]): RoutingDecision {
  let fastScore = 0.5, slowScore = 0.5;
  const reasons: string[] = [];

  if (FAST_FRIENDLY_INTENTS.has(features.intent)) {
    fastScore += 0.25;
    reasons.push(`意图"${features.intent}"适合快模型`);
  } else if (SLOW_PREFERRED_INTENTS.has(features.intent)) {
    slowScore += 0.25;
    reasons.push(`意图"${features.intent}"需要慢模型`);
  }

  if (features.complexity_score < 30) {
    fastScore += 0.2;
    reasons.push(`复杂度低(${features.complexity_score})`);
  } else if (features.complexity_score > 60) {
    slowScore += 0.2;
    reasons.push(`复杂度高(${features.complexity_score})`);
  }

  if (features.token_count < 50) {
    fastScore += 0.1;
    reasons.push("输入短小");
  } else if (features.token_count > 300) {
    slowScore += 0.1;
    reasons.push("输入较长");
  }

  if (features.has_code) { slowScore += 0.15; reasons.push("包含代码"); }
  if (features.has_math) { slowScore += 0.15; reasons.push("包含数学"); }

  if (identity) {
    if (identity.quality_sensitivity > 0.7) { slowScore += 0.1; reasons.push("用户偏好高质量"); }
    if (identity.cost_sensitivity > 0.7) { fastScore += 0.1; reasons.push("用户偏好低成本"); }
  }

  for (const mem of behaviors) {
    if (features.intent && mem.trigger_pattern.includes(features.intent) && mem.strength > 0.3) {
      if (mem.learned_action.includes("慢模型") || mem.learned_action.includes("slow")) {
        slowScore += 0.15 * mem.strength;
        reasons.push(`行为记忆: "${mem.observation}"`);
      } else if (mem.learned_action.includes("快模型") || mem.learned_action.includes("fast")) {
        fastScore += 0.15 * mem.strength;
        reasons.push(`行为记忆: "${mem.observation}"`);
      }
    }
  }

  // chat 和 simple_qa 强制走 fast，防止 LLM classifier 失败降级到 unknown 后分数不够
  if (features.intent === "chat" || features.intent === "simple_qa") {
    fastScore = Math.max(fastScore, slowScore + 0.3);
  }

  const total = fastScore + slowScore;
  fastScore = fastScore / total;
  slowScore = slowScore / total;
  const selectedRole: ModelRole = fastScore > slowScore ? "fast" : "slow";
  const confidence = Math.abs(fastScore - slowScore) + 0.5;

  return {
    router_version: "rule_v1",
    scores: { fast: Math.round(fastScore * 100) / 100, slow: Math.round(slowScore * 100) / 100 },
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
    selected_model: selectedRole === "fast" ? config.fastModel : config.slowModel,
    selected_role: selectedRole,
    selection_reason: reasons.join("; "),
    fallback_model: selectedRole === "fast" ? config.slowModel : config.fastModel,
  };
}
