import type { ChatRequest, ChatMessage, ContextResult, CompressionLevel } from "../types/index.js";
import { calculateBudget, needsCompression } from "./token-budget.js";
import { compressHistory, autoSelectCompressionLevel } from "./compressor.js";
import { countTokens } from "../models/token-counter.js";

const SYSTEM_PROMPT = `你是SmartRouter Pro智能助手。你会根据问题的复杂度自动选择最合适的AI模型来回答。
你的回答应该准确、有帮助、格式清晰。当前对话可能包含压缩的历史摘要，请自然地利用这些上下文信息。`;

export async function manageContext(request: ChatRequest, selectedModel: string): Promise<ContextResult> {
  const budget = calculateBudget(selectedModel);
  const history = request.history || [];
  const originalTokens = history.reduce((sum, m) => sum + countTokens(m.content), 0);

  let compressionLevel: CompressionLevel = request.preferences?.compression_level || "L0";
  if (compressionLevel === "L0" && needsCompression(history, budget)) {
    compressionLevel = autoSelectCompressionLevel(originalTokens, budget.available_for_history);
  }

  const compressionResult = await compressHistory(history, compressionLevel, budget.available_for_history);

  const finalMessages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...compressionResult.messages,
    { role: "user", content: request.message },
  ];

  const compressedTokens = finalMessages.reduce((sum, m) => sum + countTokens(m.content), 0);

  return {
    original_tokens: originalTokens + countTokens(request.message),
    compressed_tokens: compressedTokens,
    compression_level: compressionLevel,
    compression_ratio: originalTokens > 0 ? Math.round((1 - compressionResult.compressed_tokens / originalTokens) * 100) / 100 : 0,
    memory_items_retrieved: 0,
    final_messages: finalMessages,
    compression_details: compressionResult.details,
  };
}
