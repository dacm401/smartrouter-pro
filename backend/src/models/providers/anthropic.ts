import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "../../types/index.js";
import type { ModelProvider, ModelResponse } from "./base-provider.js";
import { config } from "../../config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export const anthropicProvider: ModelProvider = {
  name: "anthropic",
  supports(model: string): boolean { return model.startsWith("claude-"); },
  async chat(model: string, messages: ChatMessage[]): Promise<ModelResponse> {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");
    const response = await client.messages.create({
      model, max_tokens: 4096, system: systemMsg?.content || "",
      messages: nonSystemMsgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    const content = response.content[0]?.type === "text" ? response.content[0].text : "";
    return { content, input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, model };
  },
};
