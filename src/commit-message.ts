import lintCommitMessage from "@commitlint/lint";
import OpenAI from "openai";

import {
  loadCommitlintConfig,
  pickListRule,
  pickNumberRule,
} from "./commitlint-config";
import type { Lang } from "./messages";
import { cleanupModelMessage } from "./text";

const MODEL = process.env.GM_AI_MODEL ?? "gpt-4.1-mini";
const DEFAULT_TYPES =
  "build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test";
const DEFAULT_HEADER_MAX = 100;

type ResolvedRules = {
  rules: Record<string, unknown>;
  headerMax: number;
  typeList: string;
  scopeList: string | null;
  source: string | null;
};

let cachedRules: ResolvedRules | null = null;

async function getRules(): Promise<ResolvedRules> {
  if (cachedRules) return cachedRules;
  const { rules, source } = await loadCommitlintConfig();
  const headerMax = pickNumberRule(rules, "header-max-length") ?? DEFAULT_HEADER_MAX;
  const types = pickListRule(rules, "type-enum");
  const scopes = pickListRule(rules, "scope-enum");
  cachedRules = {
    rules,
    headerMax,
    typeList: types && types.length > 0 ? types.join(", ") : DEFAULT_TYPES,
    scopeList: scopes && scopes.length > 0 ? scopes.join(", ") : null,
    source,
  };
  return cachedRules;
}

async function validateConventionalCommit(
  message: string,
  rules: Record<string, unknown>,
): Promise<string[]> {
  if (!message) {
    return ["message is empty"];
  }

  const result = await lintCommitMessage(message, rules as never);
  return result.errors.map((error) => error.message);
}

function buildSystemPrompt(lang: Lang, resolved: ResolvedRules): string {
  const languageInstruction =
    lang === "zh"
      ? "Write the subject in Simplified Chinese."
      : "Write the subject in English.";

  const lines = [
    "You write git commit messages that MUST pass the project's commitlint rules.",
    "Return exactly one single-line message.",
    "Format: <type>(<scope>): <subject> or <type>: <subject>.",
    `Allowed types: ${resolved.typeList}.`,
    `Header length must be <= ${resolved.headerMax} characters.`,
    "Use lower-case type/scope and imperative subject.",
    languageInstruction,
    "Do not end subject with a period.",
    "No markdown, no quotes, no explanation.",
  ];
  if (resolved.scopeList) {
    lines.splice(4, 0, `Allowed scopes: ${resolved.scopeList}.`);
  }
  return lines.join(" ");
}

export async function generateCommitMessage(diffText: string, lang: Lang): Promise<string> {
  const apiKey = process.env.GM_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key. Set GM_OPEN_AI_API_KEY in environment.");
  }

  const resolved = await getRules();

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.GM_AI_API_URL,
  });

  const systemPrompt = buildSystemPrompt(lang, resolved);
  const userPrompt = `Generate one commit message for this git change set:\n\n${diffText}`;

  const requestInput: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const requestMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let candidate = "";

    try {
      const response = await client.responses.create({
        model: MODEL,
        input: requestInput,
      });
      candidate = cleanupModelMessage(response.output_text ?? "");
    } catch {
      // Fallback to chat completions for compatibility providers.
    }

    if (!candidate) {
      const chatResponse = await client.chat.completions.create({
        model: MODEL,
        messages: requestMessages,
        temperature: 0.2,
      });
      candidate = cleanupModelMessage(chatResponse.choices[0]?.message?.content ?? "");
    }

    const issues = await validateConventionalCommit(candidate, resolved.rules);
    if (issues.length === 0) {
      return candidate;
    }

    const issueText = issues.map((issue) => `- ${issue}`).join("\n");
    const retryPrompt = `Your previous output was invalid:\n${candidate || "(empty)"}\n\nValidation errors:\n${issueText}\n\nReturn exactly one corrected commit header.`;

    requestInput.push({ role: "assistant", content: candidate || "(empty)" });
    requestInput.push({ role: "user", content: retryPrompt });
    requestMessages.push({ role: "assistant", content: candidate || "(empty)" });
    requestMessages.push({ role: "user", content: retryPrompt });
  }

  throw new Error(
    `Model could not produce a valid commit message after ${maxAttempts} attempts.`,
  );
}
