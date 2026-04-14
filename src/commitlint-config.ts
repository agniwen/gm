import { up as walkUp } from "empathic/walk";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import commitlintConventional from "@commitlint/config-conventional";

type Rules = Record<string, unknown>;

const CONFIG_FILES = [
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  ".commitlintrc.ts",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  "commitlint.config.ts",
  "package.json",
];

function unwrap<T = unknown>(mod: unknown): T {
  if (mod && typeof mod === "object" && "default" in (mod as Record<string, unknown>)) {
    return (mod as { default: T }).default;
  }
  return mod as T;
}

async function loadFile(path: string): Promise<unknown> {
  if (path.endsWith(".json") && !path.endsWith("package.json")) {
    return JSON.parse(await readFile(path, "utf8"));
  }
  if (path.endsWith("package.json")) {
    const pkg = JSON.parse(await readFile(path, "utf8"));
    return pkg.commitlint;
  }
  if (path.endsWith(".commitlintrc")) {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  }
  const mod = await import(pathToFileURL(path).href);
  return unwrap(mod);
}

async function resolveExtends(
  name: string,
  fromPath: string,
  seen: Set<string>,
): Promise<Rules> {
  if (seen.has(name)) return {};
  seen.add(name);

  const req = createRequire(fromPath);
  let resolved: string;
  try {
    resolved = req.resolve(name);
  } catch {
    return {};
  }

  const mod = unwrap<{ rules?: Rules; extends?: string | string[] }>(
    await import(pathToFileURL(resolved).href),
  );
  return mergeConfig(mod, resolved, seen);
}

async function mergeConfig(
  config: { rules?: Rules; extends?: string | string[] } | undefined,
  fromPath: string,
  seen: Set<string>,
): Promise<Rules> {
  if (!config) return {};
  const rules: Rules = {};
  const extendsList = config.extends
    ? Array.isArray(config.extends)
      ? config.extends
      : [config.extends]
    : [];
  for (const name of extendsList) {
    Object.assign(rules, await resolveExtends(name, fromPath, seen));
  }
  if (config.rules) Object.assign(rules, config.rules);
  return rules;
}

export type CommitlintConfig = {
  rules: Rules;
  source: string | null;
};

export async function loadCommitlintConfig(cwd: string = process.cwd()): Promise<CommitlintConfig> {
  for (const dir of walkUp(cwd)) {
    for (const name of CONFIG_FILES) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      try {
        const raw = (await loadFile(path)) as
          | { rules?: Rules; extends?: string | string[] }
          | undefined;
        if (!raw) continue;
        const rules = await mergeConfig(raw, path, new Set());
        if (Object.keys(rules).length > 0) {
          return { rules, source: path };
        }
      } catch {
        // try next candidate
      }
    }
  }
  return { rules: commitlintConventional.rules as Rules, source: null };
}

export function pickNumberRule(rules: Rules, name: string): number | undefined {
  const rule = rules[name];
  if (Array.isArray(rule) && typeof rule[2] === "number") return rule[2];
  return undefined;
}

export function pickListRule(rules: Rules, name: string): string[] | undefined {
  const rule = rules[name];
  if (Array.isArray(rule) && Array.isArray(rule[2])) return rule[2] as string[];
  return undefined;
}

export function pickEnumRule(rules: Rules, name: string): string | undefined {
  const rule = rules[name];
  if (Array.isArray(rule) && typeof rule[2] === "string") return rule[2];
  return undefined;
}
