---
name: harness-radar
description: Deterministic audit of any agent harness with a built-in fix plan. Deep audits for Claude Code and Codex (instructions, skills, hooks, security, memory, model routing, cost, evals); generic audits for OpenCode, Gemini CLI, Aider, Cursor, Goose, or any directory via --home. Every failing check ships a copy-paste remediation recipe, so any model tier can run the audit and apply fixes. Use when asked to "audit the harness", "harness health", "score my setup", "improve my agent setup", or after changing hooks/skills/config.
---

# Harness Radar

The script is the source of truth. It scores, prioritizes, and prescribes fixes. You relay and apply. This protocol requires no judgment; follow it literally regardless of which model you are.

## Audit protocol

1. Run exactly:

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/audit.js" --target all
```

(If invoked as a skill, the script is at `<this-skill-dir>/scripts/audit.js`. If that path fails, locate it: `find ~/.claude/skills ~/.codex/skills -name audit.js -path "*harness-radar*" 2>/dev/null | head -1`.)

2. Paste the entire output in one code fence, unmodified. Do not rescore, reorder, summarize, or omit the fix plan.
3. After the fence, write at most 3 sentences naming the single highest-leverage fix per audited target. Nothing else.

Targets: `claude`, `codex`, `opencode`, `gemini`, `aider`, `cursor`, `goose`, `all` (default, audits whatever it detects). Any other harness: `--home <dir> [--name <label>]`. Formats: `text` (default), `md`, `json`. CI gate: `--ci 80` exits 1 if any target scores under 80%.

## Fix protocol (only when the user asks to fix or improve the score)

1. Run with `--format json`. Each failed check has a `how` field.
2. Apply each `how` verbatim, in the order the fix plan lists them:
   - Starts with `$ ` → run it as a shell command, exactly as written.
   - Starts with `paste into <file>:` → merge the snippet into that file. If the file has an existing section/key with the same name, merge into it; never duplicate keys.
   - Plain prose → follow it literally; if it names no file and no command, report it as "needs a human decision" and move on.
3. Do not invent fixes that are not in a `how` field. Do not edit files the `how` does not name.
4. If a `how` cannot be applied verbatim (missing file, conflicting config), skip it and report one line: `skipped <check>: <reason>`.
5. Re-run the audit (step 1 of the audit protocol) and paste the new scorecard as proof. The score delta is the deliverable.

## Token discipline

The audit is deterministic Node with zero dependencies; it costs zero LLM tokens to compute. Your cost is one Bash call plus the relay. Never read the audited config files to "double-check" the script, and never re-derive scores yourself.
