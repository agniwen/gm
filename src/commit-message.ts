import commitlintConventional from "@commitlint/config-conventional";
import lintCommitMessage from "@commitlint/lint";
import OpenAI from "openai";

import type { Lang } from "./messages";
import { cleanupModelMessage } from "./text";

const MODEL = process.env.OPEN_AI_MODEL ?? "gpt-4.1-mini";
const COMMITLINT_RULES = commitlintConventional.rules;
const HEADER_MAX_LENGTH =
  COMMITLINT_RULES["header-max-length"]?.[2] &&
  typeof COMMITLINT_RULES["header-max-length"][2] === "number"
    ? COMMITLINT_RULES["header-max-length"][2]
    : 100;
const CONVENTIONAL_TYPES =
  COMMITLINT_RULES["type-enum"]?.[2] &&
  Array.isArray(COMMITLINT_RULES["type-enum"][2])
    ? COMMITLINT_RULES["type-enum"][2].join(", ")
    : "build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test";

async function validateConventionalCommit(message: string): Promise<string[]> {
  if (!message) {
    return ["message is empty"];
  }

  const result = await lintCommitMessage(message, COMMITLINT_RULES);
  return result.errors.map((error) => error.message);
}

function buildSystemPrompt(lang: Lang): string {
  const languageInstruction =
    lang === "zh"
      ? "Write the subject in Simplified Chinese."
      : "Write the subject in English.";

  return [
    "You write git commit messages that MUST pass @commitlint/config-conventional.",
    "Return exactly one single-line message.",
    "Format: <type>(<scope>): <subject> or <type>: <subject>.",
    `Allowed types: ${CONVENTIONAL_TYPES}.`,
    `Header length must be <= ${HEADER_MAX_LENGTH} characters.`,
    "Use lower-case type/scope and imperative subject.",
    languageInstruction,
    "Do not end subject with a period.",
    "No markdown, no quotes, no explanation.",
  ].join(" ");
}

export async function generateCommitMessage(diffText: string, lang: Lang): Promise<string> {
  const apiKey =
    process.env.OPEN_AI_KEY ??
    process.env.OPEN_AI_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key. Set OPEN_AI_KEY or OPEN_AI_API_KEY in environment.");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPEN_AI_API_URL,
  });

  const systemPrompt = buildSystemPrompt(lang);
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

    const issues = await validateConventionalCommit(candidate);
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
    `Model could not produce a valid @commitlint/config-conventional message after ${maxAttempts} attempts.`,
  );
}
