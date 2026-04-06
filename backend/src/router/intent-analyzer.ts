import type { IntentType } from "../types/index.js";

const INTENT_PATTERNS: { intent: IntentType; patterns: RegExp[] }[] = [
  { intent: "code", patterns: [/写代码|编程|function|def |import |console\.|print\(|代码|bug|debug|编译|算法|```|python|javascript|typescript|java/i] },
  { intent: "math", patterns: [/计算|求解|方程|积分|微分|概率|统计|矩阵|几何|证明|数学|\d+\s*[\+\-\*\/\^]\s*\d+/i] },
  { intent: "reasoning", patterns: [/分析|比较|为什么|原因|解释|评估|优缺点|利弊|区别|差异|如何理解|深入|本质|analyze|compare|explain|why/i] },
  { intent: "creative", patterns: [/写文章|写故事|诗歌|小说|创作|编写|起草|文案|标题|slogan|营销|广告/i] },
  { intent: "translation", patterns: [/翻译|translate|英译中|中译英/i] },
  { intent: "summarization", patterns: [/总结|概括|摘要|归纳|提炼|summarize|summary|tl;dr/i] },
  { intent: "simple_qa", patterns: [/是什么|是谁|在哪|多少|什么时候|怎么样|哪个|what is|who is|where is/i] },
  { intent: "chat", patterns: [/^(你好|hi|hello|hey|嗨|早上好|晚上好|谢谢|再见|ok|好的|明白)/i] },
];

export function analyzeIntent(query: string): IntentType {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(query)) return intent;
    }
  }
  return "unknown";
}

export function hasCode(query: string): boolean {
  return /```|function |def |class |import |const |let |var |print\(|console\./.test(query);
}

export function hasMath(query: string): boolean {
  return /[∫∑∏√∂∇]|\d+\s*[\+\-\*\/\^]\s*\d+|方程|积分|矩阵/.test(query);
}
