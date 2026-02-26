export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

export function shellEscapeDoubleQuoted(text: string): string {
  return text.replace(/[\\"`$]/g, "\\$&");
}

export function normalizeMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function cleanupModelMessage(raw: string): string {
  const trimmed = normalizeMessage(raw);
  return trimmed.replace(/^`+|`+$/g, "").replace(/^"|"$/g, "");
}
