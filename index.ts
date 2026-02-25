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

type Lang = "en" | "zh";

type CliOptions = {
  lang: Lang;
  help: boolean;
};

type ParseResult = { options: CliOptions } | { error: string; lang: Lang };

type StatusKind = "A" | "M" | "D" | "R" | "C" | "U" | "?" | "!" | "T" | "other";

const DEFAULT_LANG: Lang = "en";

const MESSAGES = {
  en: {
    usageTitle: "Usage:",
    optionsTitle: "Options:",
    exampleTitle: "Examples:",
    usageLine: "gm [--lang <en|zh>] [--help]",
    optionLang: "Output language and commit subject language.",
    optionHelp: "Show this help message.",
    exampleDefault: "gm",
    exampleZh: "gm --lang zh",
    unknownOption: "Unknown option:",
    missingLang: "Missing value for --lang. Use en or zh.",
    invalidLang: "Invalid value for --lang. Use en or zh.",
    unexpectedOptionValue: "Option does not accept a value:",
    useHelpHint: "Run gm --help to see available options.",
    notGitRepo: "Not inside a git repository.",
    statusReadFail: "Failed to read git status.",
    noChanges: "No git changes found.",
    changedFiles: "Changed files:",
    diffReadFail: "Failed to read git diff.",
    generating: "Generating commit message...",
    generateFail: "Failed to generate commit message:",
    copied: "Copied commit message to clipboard.",
    copyWarn: "Warning: failed to copy message to clipboard:",
    suggested: "Suggested command:",
  },
  zh: {
    usageTitle: "用法:",
    optionsTitle: "参数:",
    exampleTitle: "示例:",
    usageLine: "gm [--lang <en|zh>] [--help]",
    optionLang: "CLI 输出语言和 commit subject 语言。",
    optionHelp: "显示帮助信息。",
    exampleDefault: "gm",
    exampleZh: "gm --lang zh",
    unknownOption: "未知参数:",
    missingLang: "--lang 缺少值，可选 en 或 zh。",
    invalidLang: "--lang 的值无效，可选 en 或 zh。",
    unexpectedOptionValue: "该参数不接受值:",
    useHelpHint: "运行 gm --help 查看可用参数。",
    notGitRepo: "当前目录不在 git 仓库中。",
    statusReadFail: "读取 git status 失败。",
    noChanges: "未发现 git 变更。",
    changedFiles: "变更文件:",
    diffReadFail: "读取 git diff 失败。",
    generating: "正在生成 commit message...",
    generateFail: "生成 commit message 失败:",
    copied: "已复制 commit message 到剪贴板。",
    copyWarn: "警告: 复制到剪贴板失败:",
    suggested: "建议命令:",
  },
} as const;

type MessageKey = keyof (typeof MESSAGES)["en"];

type CliOptionDefinition = {
  long: string;
  short?: string;
  valueName?: string;
  descriptionKey: MessageKey;
  expectsValue: boolean;
  onSet: (options: CliOptions, value: string | undefined) => { errorKey?: MessageKey };
};

const CLI_OPTION_DEFINITIONS: CliOptionDefinition[] = [
  {
    long: "lang",
    short: "l",
    valueName: "en|zh",
    descriptionKey: "optionLang",
    expectsValue: true,
    onSet: (options, value) => {
      if (!value) {
        return { errorKey: "missingLang" };
      }

      if (!isLang(value)) {
        return { errorKey: "invalidLang" };
      }

      options.lang = value;
      return {};
    },
  },
  {
    long: "help",
    short: "h",
    descriptionKey: "optionHelp",
    expectsValue: false,
    onSet: (options) => {
      options.help = true;
      return {};
    },
  },
];

type CliBehavior = {
  when: (options: CliOptions) => boolean;
  run: (options: CliOptions) => void;
};

const CLI_BEHAVIORS: CliBehavior[] = [
  {
    when: (options) => options.help,
    run: (options) => {
      printHelp(options.lang);
    },
  },
];

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
} as const;

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

function isLang(value: string): value is Lang {
  return value === "en" || value === "zh";
}

function formatOptionUsage(definition: CliOptionDefinition): string {
  const aliases = [`--${definition.long}`];
  if (definition.short) {
    aliases.push(`-${definition.short}`);
  }

  const suffix = definition.expectsValue && definition.valueName ? ` <${definition.valueName}>` : "";
  return `${aliases.join(", ")}${suffix}`;
}

function createOptionLookup(definitions: CliOptionDefinition[]): Map<string, CliOptionDefinition> {
  const lookup = new Map<string, CliOptionDefinition>();

  for (const definition of definitions) {
    lookup.set(`--${definition.long}`, definition);
    if (definition.short) {
      lookup.set(`-${definition.short}`, definition);
    }
  }

  return lookup;
}

function parseCliOptions(argv: string[]): ParseResult {
  const options: CliOptions = {
    lang: DEFAULT_LANG,
    help: false,
  };

  const optionLookup = createOptionLookup(CLI_OPTION_DEFINITIONS);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    let optionToken = arg;
    let inlineValue: string | undefined;

    if (arg.startsWith("--")) {
      const equalsIndex = arg.indexOf("=");
      if (equalsIndex !== -1) {
        optionToken = arg.slice(0, equalsIndex);
        inlineValue = arg.slice(equalsIndex + 1);
      }
    }

    const definition = optionLookup.get(optionToken);
    if (!definition) {
      return { error: `${MESSAGES[options.lang].unknownOption} ${arg}`, lang: options.lang };
    }

    if (!definition.expectsValue && inlineValue !== undefined) {
      return {
        error: `${MESSAGES[options.lang].unexpectedOptionValue} ${arg}`,
        lang: options.lang,
      };
    }

    let value = inlineValue;
    if (definition.expectsValue && value === undefined) {
      const nextArg = argv[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        value = nextArg;
        i += 1;
      }
    }

    const result = definition.onSet(options, value);
    if (result.errorKey) {
      return { error: MESSAGES[options.lang][result.errorKey], lang: options.lang };
    }
  }

  return { options };
}

function runCliBehaviors(options: CliOptions): boolean {
  for (const behavior of CLI_BEHAVIORS) {
    if (!behavior.when(options)) {
      continue;
    }

    behavior.run(options);
    return true;
  }

  return false;
}

function printHelp(lang: Lang): void {
  const m = MESSAGES[lang];
  const optionLines = CLI_OPTION_DEFINITIONS.map((definition) => ({
    usage: formatOptionUsage(definition),
    description: m[definition.descriptionKey],
  }));
  const usageWidth = optionLines.reduce((max, line) => Math.max(max, line.usage.length), 0);

  console.log(`${m.usageTitle}`);
  console.log(`  ${m.usageLine}`);
  console.log("");
  console.log(`${m.optionsTitle}`);
  for (const line of optionLines) {
    console.log(`  ${line.usage.padEnd(usageWidth, " ")}  ${line.description}`);
  }
  console.log("");
  console.log(`${m.exampleTitle}`);
  console.log(`  ${m.exampleDefault}`);
  console.log(`  ${m.exampleZh}`);
}

function statusKindsFromCode(code: string): StatusKind[] {
  if (code === "??") return ["?"];
  if (code === "!!") return ["!"];

  const chars = code.split("").filter((char) => char !== " ");
  const kinds: StatusKind[] = [];
  const preferredOrder: StatusKind[] = ["A", "M", "D", "R", "C", "U", "T"];

  for (const kind of preferredOrder) {
    if (chars.includes(kind)) {
      kinds.push(kind);
    }
  }

  if (kinds.length > 0) return kinds;
  return ["other"];
}

function detectStatusKind(code: string): StatusKind {
  const kinds = statusKindsFromCode(code);
  const priority: StatusKind[] = ["D", "U", "M", "A", "R", "C", "T", "?", "!", "other"];

  for (const kind of priority) {
    if (kinds.includes(kind)) return kind;
  }

  return "other";
}

function colorForStatus(kind: StatusKind): string {
  switch (kind) {
    case "A":
      return ANSI.green;
    case "M":
      return ANSI.yellow;
    case "D":
      return ANSI.red;
    case "R":
    case "C":
      return ANSI.cyan;
    case "U":
      return ANSI.magenta;
    case "?":
      return ANSI.blue;
    case "!":
      return ANSI.gray;
    case "T":
      return ANSI.yellow;
    default:
      return ANSI.reset;
  }
}

function formatStatusLabel(kinds: StatusKind[], lang: Lang): string {
  const labels = kinds.map((kind) => {
    if (lang === "zh") {
      switch (kind) {
        case "A":
          return "新增";
        case "M":
          return "修改";
        case "D":
          return "删除";
        case "R":
          return "重命名";
        case "C":
          return "复制";
        case "U":
          return "冲突";
        case "?":
          return "未跟踪";
        case "!":
          return "已忽略";
        case "T":
          return "类型变更";
        default:
          return "变更";
      }
    }

    switch (kind) {
      case "A":
        return "added";
      case "M":
        return "modified";
      case "D":
        return "deleted";
      case "R":
        return "renamed";
      case "C":
        return "copied";
      case "U":
        return "unmerged";
      case "?":
        return "untracked";
      case "!":
        return "ignored";
      case "T":
        return "typechange";
      default:
        return "changed";
    }
  });

  return labels.join("+");
}

function renderStatusLine(line: string, useColor: boolean, lang: Lang): string {
  const code = line.slice(0, 2);
  const filePath = line.length > 3 ? line.slice(3).trim() : "(unknown)";
  const kinds = statusKindsFromCode(code);
  const kind = detectStatusKind(code);
  const label = formatStatusLabel(kinds, lang).padEnd(10, " ");
  const codeLabel = `[${code}]`;

  if (!useColor) {
    return `${label} ${codeLabel} ${filePath}`;
  }

  const color = colorForStatus(kind);
  return `${color}${label}${ANSI.reset} ${ANSI.dim}${codeLabel}${ANSI.reset} ${filePath}`;
}

function printStatusSummary(statusText: string, lang: Lang): void {
  const lines = statusText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return;
  }

  const useColor = Boolean(process.stdout.isTTY);
  const m = MESSAGES[lang];

  console.log(`\n${m.changedFiles}`);
  for (const line of lines) {
    console.log(`- ${renderStatusLine(line, useColor, lang)}`);
  }
  console.log("");
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

async function generateCommitMessage(diffText: string, lang: Lang): Promise<string> {
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
  const parsed = parseCliOptions(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(MESSAGES[parsed.lang].useHelpHint);
    process.exit(1);
  }

  const { lang } = parsed.options;
  if (runCliBehaviors(parsed.options)) {
    process.exit(0);
  }

  const m = MESSAGES[lang];

  const checkRepo = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (!checkRepo.ok || checkRepo.stdout.trim() !== "true") {
    console.error(m.notGitRepo);
    process.exit(1);
  }

  const status = runGit(["status", "--short"]);
  if (!status.ok) {
    console.error(status.stderr || m.statusReadFail);
    process.exit(1);
  }

  if (!status.stdout.trim()) {
    console.log(m.noChanges);
    process.exit(0);
  }

  printStatusSummary(status.stdout, lang);

  const stagedDiff = runGit(["diff", "--cached", "--no-color", "--no-ext-diff"]);
  const unstagedDiff = runGit(["diff", "--no-color", "--no-ext-diff"]);

  if (!stagedDiff.ok || !unstagedDiff.ok) {
    console.error(m.diffReadFail);
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

  console.log(m.generating);

  let message = "";
  try {
    message = await generateCommitMessage(diffPayload, lang);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`${m.generateFail} ${reason}`);
    process.exit(1);
  }
  const escaped = shellEscapeDoubleQuoted(message);
  try {
    await copyToClipboard(`git commit -m "${escaped}"`);
    console.log(m.copied);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`${m.copyWarn} ${reason}`);
  }

  console.log(`\n${m.suggested}`);
  console.log("");
  console.log(`git commit -m "${escaped}"`);
  console.log("");
}

void main();
