#!/usr/bin/env bun

import OpenAI from "openai";
import commitlintConventional from "@commitlint/config-conventional";
import lintCommitMessage from "@commitlint/lint";

const DIFF_CHAR_LIMIT = 20_000;
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

type GitResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

function runGit(args: string[]): GitResult {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

function shellEscapeDoubleQuoted(text: string): string {
  return text.replace(/[\\"`$]/g, "\\$&");
}

function runCommandWithInput(
  command: string[],
  input: string,
): { ok: boolean; stderr: string } {
  const proc = Bun.spawnSync(command, {
    cwd: process.cwd(),
    stdin: new TextEncoder().encode(input),
    stdout: "ignore",
    stderr: "pipe",
  });

  return {
    ok: proc.exitCode === 0,
    stderr: proc.stderr.toString().trim(),
  };
}

async function copyToClipboard(text: string): Promise<void> {
  const platform = process.platform;

  if (platform === "darwin") {
    const result = runCommandWithInput(["pbcopy"], text);
    if (!result.ok) {
      throw new Error(result.stderr || "pbcopy failed");
    }
    return;
  }

  if (platform === "win32") {
    const result = runCommandWithInput(["clip"], text);
    if (!result.ok) {
      throw new Error(result.stderr || "clip failed");
    }
    return;
  }

  if (platform === "linux") {
    const wayland = runCommandWithInput(["wl-copy"], text);
    if (wayland.ok) return;

    const xclip = runCommandWithInput(["xclip", "-selection", "clipboard"], text);
    if (xclip.ok) return;

    throw new Error(wayland.stderr || xclip.stderr || "No clipboard command available");
  }

  throw new Error(`Clipboard copy is not supported on platform: ${platform}`);
}

function normalizeMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function cleanupModelMessage(raw: string): string {
  const trimmed = normalizeMessage(raw);
  return trimmed.replace(/^`+|`+$/g, "").replace(/^"|"$/g, "");
}

async function validateConventionalCommit(message: string): Promise<string[]> {
  if (!message) {
    return ["message is empty"];
  }

  const result = await lintCommitMessage(message, COMMITLINT_RULES);
  return result.errors.map((error) => error.message);
}

function buildSystemPrompt(): string {
  return [
    "You write git commit messages that MUST pass @commitlint/config-conventional.",
    "Return exactly one single-line message.",
    "Format: <type>(<scope>): <subject> or <type>: <subject>.",
    `Allowed types: ${CONVENTIONAL_TYPES}.`,
    `Header length must be <= ${HEADER_MAX_LENGTH} characters.`,
    "Use lower-case type/scope and imperative subject.",
    "Do not end subject with a period.",
    "No markdown, no quotes, no explanation.",
  ].join(" ");
}

async function generateCommitMessage(diffText: string): Promise<string> {
  const apiKey =
    process.env.OPEN_AI_KEY ??
    process.env.OPEN_AI_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing API key. Set OPEN_AI_KEY or OPEN_AI_API_KEY in environment.",
    );
  }
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPEN_AI_API_URL,
  });

  const systemPrompt = buildSystemPrompt();
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
      // Some OpenAI-compatible providers only support chat.completions.
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

async function main(): Promise<void> {
  const checkRepo = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (!checkRepo.ok || checkRepo.stdout.trim() !== "true") {
    console.error("Not inside a git repository.");
    process.exit(1);
  }

  const status = runGit(["status", "--short"]);
  if (!status.ok) {
    console.error(status.stderr || "Failed to read git status.");
    process.exit(1);
  }

  if (!status.stdout.trim()) {
    console.log("No git changes found.");
    process.exit(0);
  }

  const stagedDiff = runGit(["diff", "--cached", "--no-color", "--no-ext-diff"]);
  const unstagedDiff = runGit(["diff", "--no-color", "--no-ext-diff"]);

  if (!stagedDiff.ok || !unstagedDiff.ok) {
    console.error("Failed to read git diff.");
    process.exit(1);
  }
  
  const diffPayload = truncate(
    [
      "## git status --short",
      status.stdout.trim(),
      "",
      "## git diff --cached",
      stagedDiff.stdout.trim() || "(empty)",
      "",
      "## git diff",
      unstagedDiff.stdout.trim() || "(empty)",
    ].join("\n"),
    DIFF_CHAR_LIMIT,
  );

  console.log("Generating commit message...");

  let message = "";
  try {
    message = await generateCommitMessage(diffPayload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Failed to generate commit message: ${reason}`);
    process.exit(1);
  }

  try {
    await copyToClipboard(message);
    console.log("Copied commit message to clipboard.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: failed to copy message to clipboard: ${reason}`);
  }

  const escaped = shellEscapeDoubleQuoted(message);
  console.log("\nSuggested command:");
  console.log("");
  console.log(`git commit -m "${escaped}"`);
  console.log("");
}

void main();
