import type { ChatMessage } from "../../types/index.js";

export interface ModelResponse {
  content: string; input_tokens: number; output_tokens: number; model: string;
}

export interface ModelProvider {
  name: string;
  supports(model: string): boolean;
  chat(model: string, messages: ChatMessage[]): Promise<ModelResponse>;
}
