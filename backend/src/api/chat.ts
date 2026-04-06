import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import type { ChatRequest, ChatResponse, DecisionRecord } from "../types/index.js";
import { analyzeAndRoute } from "../router/router.js";
import { manageContext } from "../context/context-manager.js";
import { callModelFull } from "../models/model-gateway.js";
import { checkQuality } from "../router/quality-gate.js";
import { logDecision } from "../observatory/decision-logger.js";
import { learnFromInteraction } from "../evolution/learning-engine.js";
import { estimateCost } from "../models/token-counter.js";
import { config } from "../config.js";

const chatRouter = new Hono();

chatRouter.post("/chat", async (c) => {
  const body = await c.req.json<ChatRequest>();
  const startTime = Date.now();
  const userId = body.user_id || "default-user";
  const sessionId = body.session_id || uuid();

  try {
    const { features, routing } = await analyzeAndRoute({ ...body, user_id: userId, session_id: sessionId });
    const contextResult = await manageContext({ ...body, user_id: userId, session_id: sessionId }, routing.selected_model);

    let modelResponse = await callModelFull(routing.selected_model, contextResult.final_messages);
    let didFallback = false, fallbackReason: string | undefined;

    if (config.qualityGateEnabled && routing.selected_role === "fast") {
      const qualityCheck = checkQuality(modelResponse.content, features);
      if (!qualityCheck.passed && config.fallbackEnabled) {
        didFallback = true;
        fallbackReason = qualityCheck.issues.join("; ");
        modelResponse = await callModelFull(routing.fallback_model, contextResult.final_messages);
      }
    }

    const latencyMs = Date.now() - startTime;
    const totalCost = estimateCost(modelResponse.input_tokens, modelResponse.output_tokens, modelResponse.model);

    const decision: DecisionRecord = {
      id: uuid(), user_id: userId, session_id: sessionId, timestamp: startTime, input_features: features, routing,
      context: contextResult,
      execution: { model_used: modelResponse.model, input_tokens: modelResponse.input_tokens, output_tokens: modelResponse.output_tokens, total_cost_usd: totalCost, latency_ms: latencyMs, did_fallback: didFallback, fallback_reason: fallbackReason, response_text: modelResponse.content },
    };

    logDecision(decision).catch((e) => console.error("Failed to log decision:", e));
    learnFromInteraction(decision, body.message).catch((e) => console.error("Learning failed:", e));

    const response: ChatResponse = { message: modelResponse.content, decision: { ...decision, execution: { ...decision.execution, response_text: "" } } };
    return c.json(response);
  } catch (error: any) {
    console.error("Chat error:", error);
    return c.json({ error: error.message }, 500);
  }
});

chatRouter.post("/feedback", async (c) => {
  const { decision_id, feedback_type } = await c.req.json();
  const { recordFeedback } = await import("../evolution/feedback-collector.js");
  await recordFeedback(decision_id, feedback_type);
  return c.json({ success: true });
});

export { chatRouter };
