import OpenAI from "openai";
import type { ChatMessage } from "../../types/index.js";
import type { ModelProvider, ModelResponse } from "./base-provider.js";
import { config } from "../../config.js";

const client = new OpenAI({ apiKey: config.openaiApiKey });

export const openaiProvider: ModelProvider = {
  name: "openai",
  supports(model: string): boolean { return model.startsWith("gpt-"); },
  async chat(model: string, messages: ChatMessage[]): Promise<ModelResponse> {
    const response = await client.chat.completions.create({
      model, messages: messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
      temperature: 0.7, max_tokens: 4096,
    });
    return {
      content: response.choices[0]?.message?.content || "",
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
      model: response.model,
    };
  },
};
