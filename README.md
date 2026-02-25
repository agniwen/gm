# gm

CLI tool that reads current `git diff` and generates a commit message with OpenAI.

Generated messages are constrained to the Conventional Commits header format and validated against `@commitlint/config-conventional`-compatible rules (type enum, header shape, lower-case style, and max header length).

## Setup

Set env vars in `.env` (Bun auto-loads it):

```bash
OPEN_AI_KEY=your_key
OPEN_AI_API_URL=https://your-api-base-url
OPEN_AI_MODEL=gpt-4.1-mini
```

Install dependencies:

```bash
bun install
```

Run locally:

```bash
bun run index.ts
```

After publishing/installing globally, run in any git repo:

```bash
gm
```

## CLI options

- `--lang, -l <en|zh>`: set CLI output language and generated commit subject language (`en` by default)
- `--help, -h`: show usage and available options

Examples:

```bash
gm --lang zh
gm --help
```

It prints a suggested command like:

```bash
git commit -m "<generated message>"
```

By default, it also copies the generated commit message to your clipboard.

- macOS uses `pbcopy`
- Windows uses `clip`
- Linux tries `wl-copy` first, then `xclip`

Before generating the message, it prints a colorized file-change summary from `git status --short` (for example: added, modified, deleted, renamed, untracked).

Example output:

```bash
feat(parser): support commitlint-compatible fallback retries
```

The `git commit` command is not executed automatically. It exits right after printing the suggestion.

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
