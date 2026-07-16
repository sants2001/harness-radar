---
name: harness-radar
description: Deterministic audit of any agent harness. Deep audits for Claude Code and Codex (instructions, skills, hooks, security, memory, model routing, cost, evals); generic audits for OpenCode, Gemini CLI, Aider, Cursor, Goose, or any directory via --home. Renders an ASCII scorecard with exact fixes. Use when asked to "audit the harness", "harness health", "score my setup", or after changing hooks/skills/config.
---

# Harness Radar

One command. The script is the source of truth; you never score, judge, or add dimensions yourself.

## Run

```bash
node "$(dirname "$0")/scripts/audit.js" --target all
```

If invoked as an installed skill, the script lives at `<skill-dir>/scripts/audit.js`. Targets: `claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor`, `goose`, `all` (default, audits whatever it detects). Any other harness: `--home <dir> [--name <label>]`. Formats: `text` (default), `md`, `json`. CI gate: `--ci 80` exits 1 if any target scores under 80%.

## Report

1. Paste the script output verbatim inside a code fence. Do not rescore, reorder, or reinterpret.
2. Below it, add at most 3 sentences: the single highest-leverage fix per target, nothing else.
3. If the user asks to fix findings, fix them, then re-run the script and paste the new scorecard as proof.

## Token discipline

The entire audit is deterministic Node with zero dependencies. Your job is one Bash call and a short relay. Do not read the audited config files yourself unless the user asks you to fix a specific finding.
