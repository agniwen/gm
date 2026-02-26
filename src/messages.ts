export type Lang = "en" | "zh";

export const DEFAULT_LANG: Lang = "en";

export const MESSAGES = {
  en: {
    usageTitle: "Usage:",
    optionsTitle: "Options:",
    usageLine: "gm [--lang <en|zh>] [--help]",
    optionLang: "CLI output language and commit subject language.",
    optionHelp: "Show this help message.",
    unknownOption: "Unknown option:",
    missingLang: "Missing value for --lang. Use en or zh.",
    invalidLang: "Invalid value for --lang. Use en or zh.",
    unexpectedOptionValue: "Option does not accept a value:",
    useHelpHint: "Run gm --help to see available options.",
    notGitRepo: "Not inside a git repository.",
    statusReadFail: "Failed to read git status.",
    noChanges: "No git changes found.",
    diffReadFail: "Failed to read git diff.",
    generating: "Generating commit message...",
    generateFail: "Failed to generate commit message:",
    copied: "Copied command to clipboard.",
    copyWarn: "Warning: failed to copy command to clipboard:",
    command: "Suggested command",
  },
  zh: {
    usageTitle: "用法:",
    optionsTitle: "参数:",
    usageLine: "gm [--lang <en|zh>] [--help]",
    optionLang: "CLI 输出语言和 commit subject 语言。",
    optionHelp: "显示帮助信息。",
    unknownOption: "未知参数:",
    missingLang: "--lang 缺少值，可选 en 或 zh。",
    invalidLang: "--lang 的值无效，可选 en 或 zh。",
    unexpectedOptionValue: "该参数不接受值:",
    useHelpHint: "运行 gm --help 查看可用参数。",
    notGitRepo: "当前目录不在 git 仓库中。",
    statusReadFail: "读取 git status 失败。",
    noChanges: "未发现 git 变更。",
    diffReadFail: "读取 git diff 失败。",
    generating: "正在生成 commit message...",
    generateFail: "生成 commit message 失败:",
    copied: "已复制命令到剪贴板。",
    copyWarn: "警告: 复制到剪贴板失败:",
    command: "建议命令",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["en"];

export function isLang(value: string): value is Lang {
  return value === "en" || value === "zh";
}
