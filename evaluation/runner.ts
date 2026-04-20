/**
 * Sprint 31: Benchmark Runner v4 — LLM-Native Routing 评测
 *
 * 评测维度：
 *   1. 路由准确率 (Routing Accuracy) — 路由选对了吗？
 *   2. 意图准确率 (Intent Accuracy) — intent 分类对吗？
 *   3. 质量评分 (Quality Score) — 回答质量够吗？
 *
 * Usage:
 *   npx tsx evaluation/runner.ts --suite routing
 *   npx tsx evaluation/runner.ts --suite quality
 *   npx tsx evaluation/runner.ts --suite all --report
 *   npx tsx evaluation/runner.ts --suite quality --judge  (启用 LLM Judge)
 *   npx tsx evaluation/runner.ts --suite routing --json-out  (输出 JSON 供 CI 使用)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoutingTestCase {
  input: string;
  expected_mode: "fast" | "slow";
  expected_layer: "L0" | "L1" | "L2";  // Phase 2.0: 路由分层期望
  expected_intent: string;
  reason: string;
}

interface RoutingResult {
  input: string;
  expected_mode: string;
  actual_mode: string;
  expected_intent: string;
  actual_intent: string;
  expected_layer: string;
  actual_layer: string;
  mode_correct: boolean;
  intent_correct: boolean;
  layer_correct: boolean;  // Phase 2.0: 分层准确率
  latency_ms: number;
}

interface QualityTestCase {
  input: string;
  expected_keywords: string[];
  min_length: number;
  judge_criteria: string;
  category: "code" | "explanation" | "creative" | "analysis";
}

interface QualityResult {
  input: string;
  answer: string;
  category: string;
  keyword_hits: number;
  keyword_total: number;
  length_ok: boolean;
  judge_score?: number;
  rule_score: number; // 0-100
}

interface BenchmarkSummary {
  routing?: {
    total: number;
    mode_accuracy: string;
    intent_accuracy: string;
    layer_accuracy: string;  // Phase 2.0: 路由分层准确率
    by_intent: Record<string, { total: number; correct: number; rate: string }>;
    by_layer: Record<string, { total: number; correct: number; rate: string }>;  // Phase 2.0
    failures: RoutingResult[];
    ci_passed?: boolean;
    ci_threshold_mode?: string;
    ci_threshold_intent?: string;
  };
  quality?: {
    total: number;
    rule_pass_rate: string;
    judge_avg?: string;
    by_category: Record<string, { total: number; avg_score: number }>;
  };
  timestamp: string;
  commit_hash?: string;
}

// CI 回归门阈值（可被环境变量覆盖）
const CI_THRESHOLDS = {
  routing_mode_accuracy: parseFloat(process.env.CI_THRESHOLD_MODE ?? "50"),
  routing_intent_accuracy: parseFloat(process.env.CI_THRESHOLD_INTENT ?? "70"),
};

// ── CLI argument parsing ────────────────────────────────────────────────────────

interface CliArgs {
  baseUrl: string;
  userId: string;
  suite: "routing" | "quality" | "all";
  judge: boolean;
  report: boolean;
  jsonOut: boolean;  // CI 模式：输出 JSON 结果文件
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let baseUrl = process.env.API_BASE || "http://localhost:3001";
  let userId = process.env.BENCHMARK_USER_ID || "benchmark-user";
  let suite: CliArgs["suite"] = "all";
  let judge = false;
  let report = false;
  let jsonOut = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base-url" && i + 1 < args.length) {
      baseUrl = args[++i];
    } else if (arg === "--user-id" && i + 1 < args.length) {
      userId = args[++i];
    } else if (arg === "--suite" && i + 1 < args.length) {
      const s = args[++i];
      if (s === "routing" || s === "quality" || s === "all") {
        suite = s;
      }
    } else if (arg === "--judge") {
      judge = true;
    } else if (arg === "--report") {
      report = true;
    } else if (arg === "--json-out") {
      jsonOut = true;
    }
  }

  return { baseUrl, userId, suite, judge, report, jsonOut };
}

// ── Utils ──────────────────────────────────────────────────────────────────────

async function getCommitHash(): Promise<string | undefined> {
  try {
    // Try to read from git
    const { execSync } = await import("child_process");
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeJson(path: string, data: unknown): void {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// ── Routing Benchmark ───────────────────────────────────────────────────────────

async function runRoutingBenchmark(
  baseUrl: string,
  userId: string
): Promise<{ results: RoutingResult[]; summary: BenchmarkSummary["routing"] }> {
  const tasksPath = path.join(__dirname, "tasks", "routing-benchmark.json");
  const cases: RoutingTestCase[] = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
  const results: RoutingResult[] = [];

  console.log(`\n=== Routing Benchmark (LLM-Native v4 + Phase 2.0 Layer 0/1/2) ===`);
  console.log(`Running ${cases.length} test cases via /api/chat/eval/routing...\n`);

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const start = Date.now();

    try {
      // 使用 LLM-Native 路由评估端点
      const res = await fetch(`${baseUrl}/api/eval/routing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          message: tc.input,
          language: "zh",
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json() as any;
      const actualMode = data?.selected_role ?? "unknown";
      const actualIntent = data?.routing_intent ?? "unknown";
      const actualLayer = data?.routing_layer ?? "L0";

      const modeCorrect = actualMode === tc.expected_mode;
      const intentCorrect = actualIntent === tc.expected_intent;
      const layerCorrect = actualLayer === tc.expected_layer;

      results.push({
        input: tc.input,
        expected_mode: tc.expected_mode,
        actual_mode: actualMode,
        expected_intent: tc.expected_intent,
        actual_intent: actualIntent,
        expected_layer: tc.expected_layer,
        actual_layer: actualLayer,
        mode_correct: modeCorrect,
        intent_correct: intentCorrect,
        layer_correct: layerCorrect,
        latency_ms: Date.now() - start,
      });

      const icon = modeCorrect && intentCorrect && layerCorrect ? "✓" : modeCorrect && intentCorrect ? "⚠" : "✗";
      process.stdout.write(icon);
    } catch (err) {
      results.push({
        input: tc.input,
        expected_mode: tc.expected_mode,
        actual_mode: "error",
        expected_intent: tc.expected_intent,
        actual_intent: "error",
        expected_layer: tc.expected_layer,
        actual_layer: "error",
        mode_correct: false,
        intent_correct: false,
        layer_correct: false,
        latency_ms: Date.now() - start,
      });
      process.stdout.write("✗");
    }
  }

  console.log("\n");

  // Calculate summary
  const total = results.length;
  const modeCorrect = results.filter((r) => r.mode_correct).length;
  const intentCorrect = results.filter((r) => r.intent_correct).length;
  const layerCorrect = results.filter((r) => r.layer_correct).length;

  // By intent breakdown
  const byIntent: Record<string, { total: number; correct: number; rate: string }> = {};
  for (const r of results) {
    const intent = r.expected_intent;
    if (!byIntent[intent]) {
      byIntent[intent] = { total: 0, correct: 0, rate: "0.0%" };
    }
    byIntent[intent].total++;
    if (r.intent_correct) {
      byIntent[intent].correct++;
    }
  }
  for (const key of Object.keys(byIntent)) {
    const item = byIntent[key];
    item.rate = ((item.correct / item.total) * 100).toFixed(1) + "%";
  }

  // By layer breakdown (Phase 2.0)
  const byLayer: Record<string, { total: number; correct: number; rate: string }> = {};
  for (const r of results) {
    const layer = r.expected_layer;
    if (!byLayer[layer]) {
      byLayer[layer] = { total: 0, correct: 0, rate: "0.0%" };
    }
    byLayer[layer].total++;
    if (r.layer_correct) {
      byLayer[layer].correct++;
    }
  }
  for (const key of Object.keys(byLayer)) {
    const item = byLayer[key];
    item.rate = ((item.correct / item.total) * 100).toFixed(1) + "%";
  }

  const failures = results.filter((r) => !r.mode_correct || !r.intent_correct || !r.layer_correct);

  console.log(`总用例: ${total}`);
  console.log(`模型准确率: ${modeCorrect}/${total} = ${((modeCorrect / total) * 100).toFixed(1)}%`);
  console.log(`意图准确率: ${intentCorrect}/${total} = ${((intentCorrect / total) * 100).toFixed(1)}%`);
  console.log(`分层准确率: ${layerCorrect}/${total} = ${((layerCorrect / total) * 100).toFixed(1)}%\n`);

  console.log("按意图分类准确率:");
  for (const [intent, stats] of Object.entries(byIntent)) {
    console.log(`  ${intent.padEnd(15)}: ${stats.correct}/${stats.total} = ${stats.rate}`);
  }

  console.log("\nPhase 2.0 按路由分层准确率:");
  for (const [layer, stats] of Object.entries(byLayer)) {
    console.log(`  ${layer.padEnd(4)}: ${stats.correct}/${stats.total} = ${stats.rate}`);
  }

  if (failures.length > 0) {
    console.log(`\n失败用例 (${failures.length}条):`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  [FAIL] "${f.input.slice(0, 40)}..."`);
      console.log(`         期望 ${f.expected_mode}/${f.expected_layer}/${f.expected_intent}, 实际 ${f.actual_mode}/${f.actual_layer}/${f.actual_intent}`);
    }
    if (failures.length > 10) {
      console.log(`  ... 还有 ${failures.length - 10} 条`);
    }
  }

  return {
    results,
    summary: {
      total,
      mode_accuracy: ((modeCorrect / total) * 100).toFixed(1) + "%",
      intent_accuracy: ((intentCorrect / total) * 100).toFixed(1) + "%",
      layer_accuracy: ((layerCorrect / total) * 100).toFixed(1) + "%",
      by_intent: byIntent,
      by_layer: byLayer,
      failures: failures.slice(0, 20),
    },
  };
}

// ── Quality Benchmark ───────────────────────────────────────────────────────────

async function runQualityBenchmark(
  baseUrl: string,
  userId: string,
  enableJudge: boolean
): Promise<{ results: QualityResult[]; summary: BenchmarkSummary["quality"] }> {
  const tasksPath = path.join(__dirname, "tasks", "quality-benchmark.json");
  const cases: QualityTestCase[] = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
  const results: QualityResult[] = [];

  console.log(`\n=== Quality Benchmark ===`);
  console.log(`Running ${cases.length} test cases...`);
  if (enableJudge) {
    console.log("(LLM Judge enabled - this will cost API tokens)\n");
  } else {
    console.log("(LLM Judge disabled - use --judge to enable)\n");
  }

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          user_id: userId,
          session_id: `bench-quality-${i}`,
          message: tc.input,
          history: [],
          stream: false,
        }),
      });

      const data = await res.json() as any;
      const answer = data?.response?.content ?? "";

      // Rule-based scoring
      const keywordHits = tc.expected_keywords.filter((kw) =>
        answer.toLowerCase().includes(kw.toLowerCase())
      ).length;
      const lengthOk = answer.length >= tc.min_length;
      const ruleScore = Math.round(
        ((keywordHits / tc.expected_keywords.length) * 50) + (lengthOk ? 50 : 0)
      );

      let judgeScore: number | undefined;

      // LLM Judge (optional)
      if (enableJudge && answer.length > 0) {
        judgeScore = await runLLMJudge(tc.input, answer, tc.judge_criteria);
      }

      results.push({
        input: tc.input,
        answer: answer.slice(0, 500),
        category: tc.category,
        keyword_hits: keywordHits,
        keyword_total: tc.expected_keywords.length,
        length_ok: lengthOk,
        judge_score: judgeScore,
        rule_score: ruleScore,
      });

      process.stdout.write(ruleScore >= 70 ? "✓" : "✗");
    } catch (err) {
      results.push({
        input: tc.input,
        answer: "",
        category: tc.category,
        keyword_hits: 0,
        keyword_total: tc.expected_keywords.length,
        length_ok: false,
        rule_score: 0,
      });
      process.stdout.write("✗");
    }
  }

  console.log("\n");

  // Calculate summary
  const total = results.length;
  const rulePass = results.filter((r) => r.rule_score >= 70).length;
  const judgeScores = results.filter((r) => r.judge_score !== undefined).map((r) => r.judge_score!);
  const judgeAvg = judgeScores.length > 0
    ? (judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length).toFixed(1)
    : undefined;

  // By category
  const byCategory: Record<string, { total: number; totalScore: number; avg_score: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, totalScore: 0, avg_score: 0 };
    }
    byCategory[r.category].total++;
    byCategory[r.category].totalScore += r.judge_score ?? r.rule_score / 20;
  }
  for (const key of Object.keys(byCategory)) {
    const item = byCategory[key];
    item.avg_score = parseFloat((item.totalScore / item.total).toFixed(1));
  }

  console.log(`总用例: ${total}`);
  console.log(`规则评分通过率: ${rulePass}/${total} = ${((rulePass / total) * 100).toFixed(1)}%`);
  if (judgeAvg) {
    console.log(`LLM Judge 平均分: ${judgeAvg}/5.0`);
  }

  console.log("\n按类型分布:");
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`  ${cat.padEnd(12)}: 平均 ${stats.avg_score}/5`);
  }

  return {
    results,
    summary: {
      total,
      rule_pass_rate: ((rulePass / total) * 100).toFixed(1) + "%",
      judge_avg: judgeAvg ? `${judgeAvg}/5.0` : undefined,
      by_category: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, { total: v.total, avg_score: v.avg_score }])
      ),
    },
  };
}

async function runLLMJudge(
  question: string,
  answer: string,
  criteria: string
): Promise<number | undefined> {
  const JUDGE_PROMPT = `你是一个严格的 AI 回答质量评审员。
请对以下回答打分（1-5分）：
1分=完全错误或无意义
2分=部分正确但有重大缺失
3分=基本正确但不够完整
4分=正确且较完整
5分=优秀，准确完整有洞察

问题：${question}
评分标准：${criteria}
回答：${answer}

只输出一个数字（1-5），不要解释。`;

  try {
    // Try to use backend's judge endpoint or local model
    // For now, return undefined as placeholder
    // TODO: Implement actual judge call when API is available
    return undefined;
  } catch {
    return undefined;
  }
}

// ── Report Generation ───────────────────────────────────────────────────────────

async function generateReport(
  summary: BenchmarkSummary,
  outputDir: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(outputDir, `report-${timestamp}.md`);

  const rating = (rate: string): string => {
    const num = parseFloat(rate);
    if (num >= 90) return "🟢 优秀";
    if (num >= 80) return "🟡 良好";
    if (num >= 70) return "🟠 及格";
    return "🔴 需改进";
  };

  let md = `# SmartRouter Pro — Benchmark Report
日期: ${new Date().toLocaleString("zh-CN")}
版本: ${summary.commit_hash ?? "unknown"}

## 总览

| 指标 | 数值 | 评级 |
|---|---|---|
`;

  if (summary.routing) {
    md += `| 路由准确率 | ${summary.routing.mode_accuracy} | ${rating(summary.routing.mode_accuracy)} |\n`;
    md += `| 意图准确率 | ${summary.routing.intent_accuracy} | ${rating(summary.routing.intent_accuracy)} |\n`;
    md += `| 分层准确率 | ${summary.routing.layer_accuracy} | ${rating(summary.routing.layer_accuracy)} |\n`;
  }
  if (summary.quality) {
    md += `| 质量规则通过率 | ${summary.quality.rule_pass_rate} | ${rating(summary.quality.rule_pass_rate)} |\n`;
    if (summary.quality.judge_avg) {
      const judgeNum = parseFloat(summary.quality.judge_avg);
      const judgeRating = judgeNum >= 4.0 ? "🟢 优秀" : judgeNum >= 3.5 ? "🟡 良好" : judgeNum >= 3.0 ? "🟠 及格" : "🔴 需改进";
      md += `| LLM Judge 均分 | ${summary.quality.judge_avg} | ${judgeRating} |\n`;
    }
  }

  if (summary.routing) {
    md += `
## 路由准确率详情

### 按意图分类

| Intent | 正确/总数 | 准确率 |
|---|---|---|
`;
    for (const [intent, stats] of Object.entries(summary.routing.by_intent)) {
      md += `| ${intent} | ${stats.correct}/${stats.total} | ${stats.rate} |\n`;
    }

    // Phase 2.0: 按路由分层
    if (summary.routing.by_layer) {
      md += `
### 按路由分层（Phase 2.0）

| Layer | 说明 | 正确/总数 | 准确率 |
|---|---|---|---|
| L0 | Fast 直接回复（闲聊/简单问答） | — | — |
| L1 | Fast + web_search（实时数据查询） | — | — |
| L2 | Slow 模型委托（复杂推理/代码/多步） | — | — |
`;
      for (const [layer, stats] of Object.entries(summary.routing.by_layer)) {
        md += `| ${layer} | — | ${stats.correct}/${stats.total} | ${stats.rate} |\n`;
      }
    }

    if (summary.routing.failures.length > 0) {
      md += `
### 失败用例示例

| 输入 | 期望 | 实际 |
|---|---|---|
`;
      for (const f of summary.routing.failures.slice(0, 10)) {
        const input = f.input.slice(0, 30) + (f.input.length > 30 ? "..." : "");
        md += `| ${input} | ${f.expected_mode}/${f.expected_layer}/${f.expected_intent} | ${f.actual_mode}/${f.actual_layer}/${f.actual_intent} |\n`;
      }
    }
  }

  if (summary.quality) {
    md += `
## 质量评分详情

### 按类型分布

| 类型 | 数量 | 平均得分 |
|---|---|---|
`;
    for (const [cat, stats] of Object.entries(summary.quality.by_category)) {
      md += `| ${cat} | ${stats.total} | ${stats.avg_score}/5 |\n`;
    }
  }

  md += `
## 建议优化方向

`;
  if (summary.routing) {
    const weakIntents = Object.entries(summary.routing.by_intent)
      .filter(([, s]) => parseFloat(s.rate) < 80)
      .map(([i]) => i);
    if (weakIntents.length > 0) {
      md += `- 以下 intent 分类准确率偏低，建议优化训练数据: ${weakIntents.join(", ")}\n`;
    }
    // Phase 2.0: weak layer warning
    if (summary.routing.by_layer) {
      const weakLayers = Object.entries(summary.routing.by_layer)
        .filter(([, s]) => parseFloat(s.rate) < 60)
        .map(([k]) => k);
      if (weakLayers.length > 0) {
        md += `- Phase 2.0 分层准确率偏低: ${weakLayers.join(", ")}，建议检查 Fast 模型 prompt 路由规则\n`;
      }
    }
  }
  if (summary.routing && parseFloat(summary.routing.layer_accuracy) < 70) {
    md += `- Phase 2.0 分层准确率偏低，建议优先检查 Fast 模型 prompt 中的 L0/L1/L2 路由规则\n`;
  }
  if (summary.quality && parseFloat(summary.quality.rule_pass_rate) < 85) {
    md += `- 质量评分通过率偏低，建议检查模型输出质量\n`;
  }
  md += `- 定期运行 benchmark 跟踪指标变化\n`;

  fs.writeFileSync(reportPath, md);
  return reportPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const resultsDir = path.join(__dirname, "results");
  ensureDir(resultsDir);

  console.log("🏃 SmartRouter Pro — Benchmark Runner v4");
  console.log(`   API Base: ${args.baseUrl}`);
  console.log(`   User ID:  ${args.userId}`);
  console.log(`   Suite:    ${args.suite}`);
  console.log(`   CI Mode:  ${args.jsonOut ? "ON" : "OFF"}`);

  const summary: BenchmarkSummary = {
    timestamp: new Date().toISOString(),
    commit_hash: await getCommitHash(),
  };

  // Run routing benchmark
  if (args.suite === "routing" || args.suite === "all") {
    const { results, summary: routingSummary } = await runRoutingBenchmark(
      args.baseUrl,
      args.userId
    );
    summary.routing = routingSummary;

    // Save results
    const timestamp = new Date().toISOString().slice(0, 10);
    writeJson(path.join(resultsDir, `routing-${timestamp}.json`), results);

    // CI Gate: routing mode + intent + layer accuracy
    const modeAcc = parseFloat(routingSummary.mode_accuracy);
    const intentAcc = parseFloat(routingSummary.intent_accuracy);
    const layerAcc = parseFloat(routingSummary.layer_accuracy);
    const ciPassed = modeAcc >= CI_THRESHOLDS.routing_mode_accuracy
      && intentAcc >= CI_THRESHOLDS.routing_intent_accuracy;
    // Phase 2.0 CI: layer accuracy >= 50%
    const ciLayerThreshold = 50;
    const ciPassedLayer = layerAcc >= ciLayerThreshold;
    summary.routing.ci_passed = ciPassed && ciPassedLayer;
    summary.routing.ci_threshold_mode = `${CI_THRESHOLDS.routing_mode_accuracy}%`;
    summary.routing.ci_threshold_intent = `${CI_THRESHOLDS.routing_intent_accuracy}%`;

    if (args.jsonOut) {
      const ciResult = {
        ci_passed: ciPassed && ciPassedLayer,
        routing_mode_accuracy: modeAcc,
        routing_intent_accuracy: intentAcc,
        routing_layer_accuracy: layerAcc,  // Phase 2.0
        threshold_mode: CI_THRESHOLDS.routing_mode_accuracy,
        threshold_intent: CI_THRESHOLDS.routing_intent_accuracy,
        threshold_layer: ciLayerThreshold,
        commit_hash: summary.commit_hash,
        timestamp: summary.timestamp,
      };
      writeJson(path.join(resultsDir, `ci-gate-routing-${timestamp}.json`), ciResult);
      console.log(`\n${(ciPassed && ciPassedLayer) ? "✅ CI GATE PASSED" : "❌ CI GATE FAILED"}`);
      console.log(`   mode_accuracy:    ${modeAcc.toFixed(1)}% (threshold: ${CI_THRESHOLDS.routing_mode_accuracy}%)`);
      console.log(`   intent_accuracy:  ${intentAcc.toFixed(1)}% (threshold: ${CI_THRESHOLDS.routing_intent_accuracy}%)`);
      console.log(`   layer_accuracy:   ${layerAcc.toFixed(1)}% (threshold: ${ciLayerThreshold}%)`);

      if (!(ciPassed && ciPassedLayer)) {
        process.exit(1);
      }
    }
  }

  // Run quality benchmark
  if (args.suite === "quality" || args.suite === "all") {
    const { results, summary: qualitySummary } = await runQualityBenchmark(
      args.baseUrl,
      args.userId,
      args.judge
    );
    summary.quality = qualitySummary;

    const timestamp = new Date().toISOString().slice(0, 10);
    writeJson(path.join(resultsDir, `quality-${timestamp}.json`), results);
  }

  // Generate report
  if (args.report || args.suite === "all") {
    const reportPath = await generateReport(summary, resultsDir);
    console.log(`\n📄 Report: ${reportPath}`);
  }

  console.log("\n✅ Benchmark complete!");
}

main().catch((err) => {
  console.error("\nBenchmark runner crashed:", err);
  process.exit(1);
});
