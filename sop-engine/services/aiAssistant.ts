import { explainDecision, type ExplainResult } from "./explainEngine";
import { computeSOPAdaptive, type SOPAdaptiveResult } from "./sopEngineAdaptive";

/**
 * On-demand AI explanation for a single SKU.
 *
 * In production this function would forward the context to an LLM (e.g. GPT-4o,
 * Claude 3, or a fine-tuned supply-chain model) and return a conversational
 * explanation. The placeholder below uses the deterministic explainEngine so
 * the application is fully functional without an AI key.
 *
 * To plug in a real model, replace the body of `callAIExplain` with your API
 * call and keep the same return interface.
 */
export interface AIExplainInput {
  skuCode: string;
  name?: string;
  sopResult: SOPAdaptiveResult;
}

export interface AIExplainOutput {
  narrative: string;
  structuredAnalysis: ExplainResult;
  source: "ai" | "local";
}

/**
 * Placeholder — calls the local explainEngine.
 * Replace with a real AI API call when credentials are available.
 */
async function callAIExplain(_input: AIExplainInput): Promise<string> {
  // TODO: Replace with actual AI API call, e.g.:
  // const response = await fetch("https://api.openai.com/v1/chat/completions", { ... });
  // return (await response.json()).choices[0].message.content;
  return "";
}

export async function explainSKUWithAI(input: AIExplainInput): Promise<AIExplainOutput> {
  const structured = explainDecision({
    name: input.name || input.skuCode,
    skuCode: input.skuCode,
    ...input.sopResult,
  });

  // Attempt AI narrative; fall back to local if empty or unavailable.
  let narrative = "";
  let source: AIExplainOutput["source"] = "local";
  try {
    narrative = await callAIExplain(input);
    if (narrative) source = "ai";
  } catch {
    // AI unavailable — use local narrative
  }

  if (!narrative) {
    narrative = buildLocalNarrative(input.skuCode, input.name, input.sopResult, structured);
  }

  return { narrative, structuredAnalysis: structured, source };
}

function buildLocalNarrative(
  skuCode: string,
  name: string | undefined,
  sop: SOPAdaptiveResult,
  explain: ExplainResult,
): string {
  const label = name ? `${name} (${skuCode})` : skuCode;
  const lines: string[] = [
    `**${label}** — Lifecycle: ${sop.lifecycle} | Risk: ${explain.risk}`,
    "",
    explain.summary,
    "",
    "**Analysis:**",
    ...explain.reasons.map((r) => `• ${r}`),
    "",
    `**Recommended action:** ${sop.recommendation.reason}`,
    "",
    `**Advice:** ${explain.advice}`,
  ];
  if (explain.warning) {
    lines.push("", explain.warning);
  }
  return lines.join("\n");
}
