export type GitResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export function runGit(args: string[]): GitResult {
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
