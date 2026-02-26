import { DEFAULT_LANG, MESSAGES, type Lang, type MessageKey, isLang } from "./messages";

export type CliOptions = {
  lang: Lang;
  help: boolean;
};

export type ParseResult = { options: CliOptions } | { error: string; lang: Lang };

type CliOptionDefinition = {
  long: string;
  short?: string;
  valueName?: string;
  expectsValue: boolean;
  descriptionKey: MessageKey;
  onSet: (options: CliOptions, value?: string) => { errorKey?: MessageKey };
};

const CLI_OPTION_DEFINITIONS: CliOptionDefinition[] = [
  {
    long: "lang",
    short: "l",
    valueName: "en|zh",
    expectsValue: true,
    descriptionKey: "optionLang",
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
    expectsValue: false,
    descriptionKey: "optionHelp",
    onSet: (options) => {
      options.help = true;
      return {};
    },
  },
];

export function getCliArgv(): string[] {
  const argv = Bun.argv;
  if (argv.length === 0) {
    return [];
  }

  const first = argv[0] ?? "";
  const looksLikeBunRuntime = first.endsWith("/bun") || first === "bun";
  if (looksLikeBunRuntime) {
    return argv.slice(2);
  }

  return argv.slice(1);
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

export function parseCliOptions(argv: string[]): ParseResult {
  const options: CliOptions = {
    lang: DEFAULT_LANG,
    help: false,
  };

  const optionLookup = createOptionLookup(CLI_OPTION_DEFINITIONS);

  for (let i = 0; i < argv.length; i += 1) {
    const rawArg = argv[i];
    if (!rawArg) continue;

    let optionToken = rawArg;
    let inlineValue: string | undefined;

    if (rawArg.startsWith("--")) {
      const equalsIndex = rawArg.indexOf("=");
      if (equalsIndex !== -1) {
        optionToken = rawArg.slice(0, equalsIndex);
        inlineValue = rawArg.slice(equalsIndex + 1);
      }
    }

    const definition = optionLookup.get(optionToken);
    if (!definition) {
      return { error: `${MESSAGES[options.lang].unknownOption} ${rawArg}`, lang: options.lang };
    }

    if (!definition.expectsValue && inlineValue !== undefined) {
      return {
        error: `${MESSAGES[options.lang].unexpectedOptionValue} ${rawArg}`,
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

export function printHelp(lang: Lang): void {
  const m = MESSAGES[lang];
  const optionLines = CLI_OPTION_DEFINITIONS.map((definition) => ({
    usage: formatOptionUsage(definition),
    description: m[definition.descriptionKey],
  }));
  const usageWidth = optionLines.reduce((max, line) => Math.max(max, line.usage.length), 0);

  console.log(m.usageTitle);
  console.log(`  ${m.usageLine}`);
  console.log("");
  console.log(m.optionsTitle);
  for (const line of optionLines) {
    console.log(`  ${line.usage.padEnd(usageWidth, " ")}  ${line.description}`);
  }
}
