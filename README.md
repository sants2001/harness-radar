# harness-radar

Deterministic audit for any AI agent harness. One zero-dependency Node script scores your setup from explicit file checks and prints an ASCII scorecard with exact fixes. Same config, same score, every time. No LLM judgment, no token burn.

```
╔═══════════════════════════════════════════════════════════╗
║  H A R N E S S   R A D A R   v1.0.0                       ║
╚═══════════════════════════════════════════════════════════╝

┌─ CLAUDE ──────────────────────────────── 78/80  grade S ─┐
│ ✓ Instructions     ██████████  10/10                      │
│ ✓ Skills           ██████████  10/10                      │
│ ~ Hooks            ████████░░   8/10                      │
│ ✓ Security         ██████████  10/10                      │
│ ✓ Memory           ██████████  10/10                      │
│ ✓ Model Routing    ██████████  10/10                      │
│ ✓ Cost & Context   ██████████  10/10                      │
│ ✓ Evals            ██████████  10/10                      │
└───────────────────────────────────────────────────────────┘
  fixes:
  1. [Hooks] Slow hooks are async
     → Mark hooks with timeout >=15s as "async": true   ~/.claude/settings.json
```

## Why

Agent harnesses rot quietly: a hook script gets moved and dies silently, a skill symlink breaks, someone sets `approval_policy = "never"` and forgets, the instructions file balloons past the context budget. harness-radar catches all of that in under a second, and because every check is a file assertion, the score is reproducible and diffable in CI.

## Supported harnesses

| Target | Depth | What's checked |
|---|---|---|
| `claude` (Claude Code) | Deep | Instructions budget, skills (incl. broken symlinks), hooks (dead scripts, timeouts, async), permission deny list, memory, model routing, thinking caps, evals |
| `codex` (OpenAI Codex) | Deep | AGENTS.md, skills, hooks.json + trust-hash coverage, sandbox/approval policy, memories, routing profiles, default reasoning effort |
| `opencode`, `gemini`, `aider`, `cursor`, `goose` | Generic | Instructions present and lean, config present, extensions inventory, broken symlinks |
| Anything else | Generic | `--home <dir> --name <label>` points the generic audit at any directory, open source or homegrown |

## Install

As a skill (Claude Code, Codex, or any agent that reads `skills/`):

```bash
npx skills add sants2001/harness-radar
```

Or standalone, no install:

```bash
node skills/harness-radar/scripts/audit.js --target all
```

## Usage

```bash
node audit.js                          # audit every harness it detects
node audit.js --target codex           # one harness
node audit.js --home ~/.myagent        # any directory, generic checks
node audit.js --format json            # machine-readable
node audit.js --format md              # paste into a PR or report
node audit.js --target claude --ci 80  # CI gate: exit 1 under 80%
```

## Scoring

Each category is 0-10, computed as the fraction of its checks that pass. Grades: S (95%+), A (85%+), B (70%+), C (55%+), D (40%+), F. Max score scales with how many categories apply to the target, so deep and generic audits are never compared on the same denominator.

Every failing check ships with the exact file path and a one-line fix. The design goal: the fix list is a todo list, not a diagnosis to interpret.

## Design principles

- **Deterministic or absent.** If a quality can't be checked by a file assertion, it isn't scored. No vibes.
- **Zero dependencies.** One file, stdlib only, runs anywhere Node 18+ runs.
- **Token-frugal by construction.** An agent invoking this skill makes one Bash call and relays the output. The audit itself costs zero LLM tokens.
- **Fixes over findings.** Every failure names the file and the change.

## License

MIT
