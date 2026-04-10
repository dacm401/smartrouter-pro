import { v4 as uuid } from "uuid";
import type { BehavioralMemory, DecisionRecord } from "../types/index.js";
import { MemoryRepo, DecisionRepo } from "../db/repositories.js";

export async function analyzeAndLearn(userId: string, latestDecision: DecisionRecord): Promise<BehavioralMemory | null> {
  const recentDecisions = await DecisionRepo.getRecent(userId, 50);
  const sameIntentDecisions = recentDecisions.filter((d: any) => d.intent === latestDecision.input_features.intent);

  if (sameIntentDecisions.length < 3) return null;

  const fastDecisions = sameIntentDecisions.filter((d: any) => d.selected_role === "fast");
  const fastWithFeedback = fastDecisions.filter((d: any) => d.feedback_score !== null);

  if (fastWithFeedback.length < 3) return null;

  const fastNegativeRate = fastWithFeedback.filter((d: any) => d.feedback_score < 0).length / fastWithFeedback.length;
  const fastPositiveRate = fastWithFeedback.filter((d: any) => d.feedback_score > 0).length / fastWithFeedback.length;
  const positiveCount = fastWithFeedback.filter((d: any) => d.feedback_score > 0).length;
  const intent = latestDecision.input_features.intent;

  const existingMemories = await MemoryRepo.getBehavioralMemories(userId);
  const existingForIntent = existingMemories.find((m) => m.trigger_pattern.includes(intent));

  if (fastNegativeRate > 0.4 && !existingForIntent) {
    const memory: BehavioralMemory = {
      id: uuid(), user_id: userId, trigger_pattern: `意图为"${intent}"的问题`,
      observation: `"${intent}"类问题使用快模型时，${Math.round(fastNegativeRate * 100)}%的回答不满意`,
      learned_action: `"${intent}"类问题优先路由到慢模型`, strength: 0.6, reinforcement_count: 1,
      last_activated: Date.now(), source_decision_ids: fastWithFeedback.map((d: any) => d.id).slice(0, 5), created_at: Date.now(),
    };
    await MemoryRepo.saveBehavioralMemory(memory);
    return memory;
  }

  // P4.1: relaxed positive gate — was fastPositiveRate > 0.8 (required 4+/5+, i.e. 80%+).
  //   New: require ≥ 3 positive AND positive_rate > 0.5, so 2/3 (66.7%) and 3/4 (75%)
  //   now trigger positive memory creation instead of silently failing.
  if (positiveCount >= 3 && fastPositiveRate > 0.5 && !existingForIntent) {
    const memory: BehavioralMemory = {
      id: uuid(), user_id: userId, trigger_pattern: `意图为"${intent}"的问题`,
      observation: `"${intent}"类问题使用快模型时，${Math.round(fastPositiveRate * 100)}%的回答令人满意`,
      learned_action: `"${intent}"类问题可以放心使用快模型`, strength: 0.7, reinforcement_count: 1,
      last_activated: Date.now(), source_decision_ids: fastWithFeedback.map((d: any) => d.id).slice(0, 5), created_at: Date.now(),
    };
    await MemoryRepo.saveBehavioralMemory(memory);
    return memory;
  }

  if (existingForIntent) {
    const latestFeedback = latestDecision.feedback?.score || 0;
    const delta = latestFeedback > 0 ? 0.05 : latestFeedback < 0 ? -0.05 : 0;
    if (delta !== 0) await MemoryRepo.reinforceMemory(existingForIntent.id, delta);
  }

  return null;
}
