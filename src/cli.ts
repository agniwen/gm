import cac from "cac";

import { DEFAULT_LANG, MESSAGES, type Lang, isLang } from "./messages";

export type CliOptions = {
  lang: Lang;
  help: boolean;
  version: boolean;
};

export type ParseResult = { options: CliOptions } | { error: string; lang: Lang };

function createCli(lang: Lang) {
  const m = MESSAGES[lang];
  const cli = cac("gm");

  cli.usage("[--lang <en|zh>] [--help] [--version]");
  cli.option("-l, --lang <lang>", m.optionLang, { default: DEFAULT_LANG });
  cli.option("-h, --help", m.optionHelp);
  cli.option("-v, --version", m.optionVersion);
  cli.globalCommand.helpCallback = (sections) => {
    return sections
      .filter((section) => section.title !== "Commands" && section.title !== "For more info, run any command with the `--help` flag")
      .map((section) => {
        if (!section.title) {
          return section;
        }

        if (section.title === "Usage") {
          return { ...section, title: m.usageTitle.replace(/:$/, "") };
        }

        if (section.title === "Options") {
          return { ...section, title: m.optionsTitle.replace(/:$/, "") };
        }

        return section;
      });
  };
  cli.command("").action(() => {});

  return cli;
}

function resolveErrorLang(argv: string[]): Lang {
  let lang = DEFAULT_LANG;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith("--lang=")) {
      const value = arg.slice("--lang=".length);
      if (isLang(value)) {
        lang = value;
      }
      continue;
    }

    if (arg === "--lang" || arg === "-l") {
      const value = argv[i + 1];
      if (value && !value.startsWith("-") && isLang(value)) {
        lang = value;
        i += 1;
      }
    }
  }

  return lang;
}

function formatCliError(message: string, lang: Lang): string {
  const m = MESSAGES[lang];
  const unknownOptionMatch = /^Unknown option `(.+)`$/.exec(message);
  if (unknownOptionMatch) {
    return `${m.unknownOption} ${unknownOptionMatch[1]}`;
  }

  if (message.includes("`-l, --lang <lang>` value is missing")) {
    return m.missingLang;
  }

  const unusedArgsMatch = /^Unused args: `(.+)`$/.exec(message);
  if (unusedArgsMatch) {
    return `${m.unknownOption} ${unusedArgsMatch[1]}`;
  }

  return message;
}

export function getCliArgv(): string[] {
  return process.argv.slice(2);
}

export function parseCliOptions(argv: string[]): ParseResult {
  const lang = resolveErrorLang(argv);
  const cli = createCli(lang);

  if (argv.some((arg) => arg.startsWith("--help="))) {
    return {
      error: `${MESSAGES[lang].unexpectedOptionValue} ${argv.find((arg) => arg.startsWith("--help="))}`,
      lang,
    };
  }

  if (argv.some((arg) => arg.startsWith("--version="))) {
    return {
      error: `${MESSAGES[lang].unexpectedOptionValue} ${argv.find((arg) => arg.startsWith("--version="))}`,
      lang,
    };
  }

  try {
    const parsed = cli.parse(["bun", "gm", ...argv], { run: false });
    cli.runMatchedCommand();

    if (!isLang(parsed.options.lang)) {
      return { error: MESSAGES[lang].invalidLang, lang };
    }

    return {
      options: {
        lang: parsed.options.lang,
        help: Boolean(parsed.options.help),
        version: Boolean(parsed.options.version),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: formatCliError(message, lang), lang };
  }
}

export function printHelp(lang: Lang): void {
  createCli(lang).outputHelp();
}
