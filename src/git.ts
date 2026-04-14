import { spawnSync } from "node:child_process";

export type GitResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export function runGit(args: string[]): GitResult {
  const proc = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  return {
    ok: proc.status === 0,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}
