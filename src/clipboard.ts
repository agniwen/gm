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

export async function copyToClipboard(text: string): Promise<void> {
  if (process.platform === "darwin") {
    const result = runCommandWithInput(["pbcopy"], text);
    if (!result.ok) throw new Error(result.stderr || "pbcopy failed");
    return;
  }

  if (process.platform === "win32") {
    const result = runCommandWithInput(["clip"], text);
    if (!result.ok) throw new Error(result.stderr || "clip failed");
    return;
  }

  if (process.platform === "linux") {
    const wayland = runCommandWithInput(["wl-copy"], text);
    if (wayland.ok) return;
    const xclip = runCommandWithInput(["xclip", "-selection", "clipboard"], text);
    if (xclip.ok) return;
    throw new Error(wayland.stderr || xclip.stderr || "No clipboard command available");
  }

  throw new Error(`Clipboard copy is not supported on platform: ${process.platform}`);
}
