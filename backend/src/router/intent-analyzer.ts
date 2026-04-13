import type { IntentType } from "../types/index.js";
import { config } from "../config.js";

// ── 原有正则规则保留，作为降级方案 ─────────────────────────────────────────────

const INTENT_PATTERNS: { intent: IntentType; patterns: RegExp[] }[] = [
  // 1. MATH — 数学符号/公式，高置信度
  { intent: "math", patterns: [
    /计算|求解|方程|积分|微分|概率|统计|矩阵|向量|几何|证明/i,
    /\d+\s*[\+\-\*\/\^]\s*\d+|=\s*\?|求\s*x/i,
    /[∫∑∏√∂∇]|equation|integral|matrix|derivative/i,
  ]},

  // 2. CODE — 必须有代码操作动词，不能只有语言名
  { intent: "code", patterns: [
    /写[一个]*代码|编写代码|实现[一个]*(函数|算法|类|接口)|写[一个]*(函数|脚本|程序|组件)/i,
    /debug|调试|报错|bug|fix.*代码|代码.*错误|编译错误|运行错误/i,
    /```[\s\S]|def \w+\(|function \w+\(|class \w+[:{]/,
    /import \w+|from \w+ import|require\(|npm install|pip install/i,
    /(python|javascript|typescript|java|rust|golang|c\+\+|swift).{0,15}(写|实现|编写|代码|函数|脚本|程序)/i,
    /(write|implement|build|create).{0,15}(function|class|script|program|api|component|module)/i,
    /数据结构|时间复杂度|空间复杂度|递归|迭代|排序算法|搜索算法|动态规划/i,
  ]},

  // 3. TRANSLATION — 明确翻译动词
  { intent: "translation", patterns: [
    /翻译|translate|英译中|中译英|用[中英日韩法德]文(说|写|表达)/i,
    /^(translate|翻译).{0,100}$/i,
  ]},

  // 4. SUMMARIZATION — 明确总结动词
  { intent: "summarization", patterns: [
    /总结|概括|摘要|归纳|提炼|要点|summarize|summary|tl;?dr/i,
  ]},

  // 5. RESEARCH — 市场/行业研究，放在 reasoning 之前
  { intent: "research", patterns: [
    /调研|综述|市场分析|竞争分析|行业分析|竞争格局|发展趋势|市场格局/i,
    /research report|market analysis|competitive landscape|industry overview/i,
    /(2024|2025|近年|最近几年|当前|目前).{0,20}(市场|行业|竞争|格局|趋势)/i,
    /全球.{0,15}(市场|行业|竞争)|市场.{0,15}(份额|规模|竞争)/i,
    /分析.{0,20}(市场|行业|竞争|格局|趋势|现状)/i,
  ]},

  // 6. REASONING — 分析推理（宽泛，放 research 之后）
  { intent: "reasoning", patterns: [
    /为什么|原因是|如何理解|深入分析|本质上|从.*角度|利弊|优缺点/i,
    /比较.{0,20}(区别|差异|优劣)|有什么(区别|不同|优势|劣势)/i,
    /why |how does|what causes|explain|analyze|evaluate|compare/i,
    /pros and cons|trade.?off|versus|vs\.|better than/i,
  ]},

  // 7. CREATIVE — 创作类（注意：排除「写代码」）
  { intent: "creative", patterns: [
    /写[一首|一篇|一段|一个]*(诗|歌词|故事|小说|散文|文章|剧本|对联)/i,
    /创作[一首|一篇|一段]|编写[一首|一篇]/i,
    /文案|广告语|slogan|标语|标题|起名|命名/i,
    /write a (poem|story|essay|song|script|novel)/i,
    /compose|creative writing|brainstorm/i,
  ]},

  // 8. SIMPLE_QA — 定义/事实查询（放 creative 之后）
  { intent: "simple_qa", patterns: [
    // 定义类："X是什么" — 排除含代码操作词的情况
    /^(?!.*(写|实现|编写|debug|代码)).{0,50}(是什么|是谁|指的是|的定义|什么叫).{0,20}[？?]?\s*$/i,
    // 简单事实
    /^.{0,40}(在哪里?|多少钱?|几个|几点|多久|哪个更|哪里有)[？?]?\s*$/i,
    // 是非题
    /^.{0,50}(是吗|对吗|是不是|有没有|能不能|可以吗|是否)[？?]?\s*$/i,
    // 英文定义类
    /^(what is|who is|what's|who's|define|is it|can i|does it).{0,50}[?]?\s*$/i,
  ]},

  // 9. CHAT — 闲聊（最后兜底，不要太贪婪）
  { intent: "chat", patterns: [
    /^(你好|hi|hello|hey|嗨|早上好|晚上好|谢谢|感谢|再见|拜拜|哈哈|哦|啊|嗯|好的|明白|ok)/i,
    /今天天气|最近怎么样|你最近|有什么好玩|随便聊|陪我聊|无聊了|聊聊天/i,
    /how are you|what's up|good morning|good night|thank you|thanks|bye/i,
  ]},
];

export function analyzeIntent(query: string): IntentType {
  const trimmed = query.trim();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) return intent;
    }
  }
  return "unknown";
}

export function hasCode(query: string): boolean {
  return /```|function |def |class |import |const |let |var |print\(|console\./.test(query);
}

export function hasMath(query: string): boolean {
  return /[∫∑∏√∂∇]|\d+\s*[\+\-\*\/\^]\s*\d+|方程|积分|矩阵|equation|integral|matrix/.test(query);
}

// ── 新增：LLM-based Intent Classifier ─────────────────────────────────────────

const INTENT_CLASSIFIER_PROMPT = `你是一个意图分类器。根据用户消息，输出最匹配的意图类型。

只能输出以下9个词之一，不要输出任何其他内容：
chat
simple_qa
translation
summarization
code
math
reasoning
creative
research

判断规则：
- chat：打招呼、闲聊、情绪表达、简短回应（"嗯""好的""继续"）
- simple_qa：问一个具体事实或定义，答案简短（"Python是什么""北京在哪"）
- translation：要求翻译内容
- summarization：要求总结/概括某段内容
- code：要求写代码、调试、实现算法
- math：数学计算、公式推导
- reasoning：需要分析、比较、推理、解释原因
- creative：写作、创作、文案、起名
- research：市场调研、行业分析、综述类问题`;

export async function analyzeIntentWithLLM(
  query: string,
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<IntentType> {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: INTENT_CLASSIFIER_PROMPT },
          { role: "user", content: query },
        ],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      // API 调用失败，降级到正则
      return analyzeIntent(query);
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const result = data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";
    
    const validIntents: IntentType[] = [
      "chat", "simple_qa", "translation", "summarization",
      "code", "math", "reasoning", "creative", "research",
    ];

    if (validIntents.includes(result as IntentType)) {
      return result as IntentType;
    }
    // LLM 输出不在合法范围内，降级到正则
    return analyzeIntent(query);
  } catch {
    // 任何错误都降级到正则
    return analyzeIntent(query);
  }
}
