import { copyToClipboard } from "./clipboard";
import { getCliArgv, parseCliOptions, printHelp } from "./cli";
import { generateCommitMessage } from "./commit-message";
import { runGit } from "./git";
import { MESSAGES } from "./messages";
import { shellEscapeDoubleQuoted, truncate } from "./text";

const DIFF_CHAR_LIMIT = 20_000;

export async function main(): Promise<void> {
  const parsed = parseCliOptions(getCliArgv());
  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(MESSAGES[parsed.lang].useHelpHint);
    process.exit(1);
  }

  const { options } = parsed;
  const m = MESSAGES[options.lang];

  if (options.help) {
    printHelp(options.lang);
    return;
  }

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
    return;
  }

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
    message = await generateCommitMessage(diffPayload, options.lang);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`${m.generateFail} ${reason}`);
    process.exit(1);
  }

  const escaped = shellEscapeDoubleQuoted(message);
  const command = `git commit -m "${escaped}"`;
  try {
    await copyToClipboard(command);
    console.log(m.copied);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`${m.copyWarn} ${reason}`);
  }

  console.log(`\n${m.command}:`);
  console.log(command);
}
