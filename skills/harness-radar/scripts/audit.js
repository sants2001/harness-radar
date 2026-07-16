#!/usr/bin/env node
// harness-radar: deterministic agent-harness audit. Deep audits for Claude
// Code and Codex; generic audits for any other harness (OpenCode, Gemini CLI,
// Aider, Cursor, Goose, or any directory via --home).
// Zero dependencies. Same commit + same config = same score.
// Usage: node audit.js [--target claude|codex|opencode|gemini|aider|cursor|goose|all]
//                      [--home <dir> [--name <label>]] [--format text|json|md] [--ci <minScore>]

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const CODEX = process.env.CODEX_HOME || path.join(HOME, '.codex');
const VERSION = '1.0.0';

const args = process.argv.slice(2);
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const TARGET = flag('target', 'all');
const FORMAT = flag('format', 'text');
const CI_MIN = flag('ci', null);

// ── fs helpers ────────────────────────────────────────────────────
const exists = p => { try { fs.statSync(p); return true; } catch { return false; } };
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const readJson = p => { try { return JSON.parse(readText(p)); } catch { return null; } };
const listDir = p => { try { return fs.readdirSync(p); } catch { return []; } };
const sizeOf = p => { try { return fs.statSync(p).size; } catch { return 0; } };
const isBrokenLink = p => {
  try { fs.lstatSync(p); } catch { return false; }
  try { return fs.lstatSync(p).isSymbolicLink() && !exists(p); } catch { return false; }
};

function check(name, pass, fix, file, detail) {
  return { name, pass: !!pass, fix, file, detail };
}

// Extract every hook command string from a Claude-style hooks object
function hookCommands(hooksObj) {
  const out = [];
  for (const [event, groups] of Object.entries(hooksObj || {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g.hooks || []) {
        if (h.type === 'command' && h.command) out.push({ event, ...h });
      }
    }
  }
  return out;
}

// First existing script path inside a hook command string, if any
function scriptPathOf(command) {
  const tokens = command.split(/\s+/).filter(t => t.startsWith('/') || t.startsWith('~'));
  return tokens.map(t => t.replace(/^~/, HOME)).find(t => /\.(js|sh|py|rb)$/.test(t)) || null;
}

function auditSkillsDir(dir) {
  const entries = listDir(dir).filter(e => !e.startsWith('.'));
  const broken = entries.filter(e => isBrokenLink(path.join(dir, e)));
  const sample = entries.slice(0, 25);
  const missingManifest = sample.filter(e => {
    const p = path.join(dir, e);
    try { return fs.statSync(p).isDirectory() && !exists(path.join(p, 'SKILL.md')); } catch { return false; }
  });
  return { count: entries.length, broken, missingManifest };
}

// ── Claude Code target ────────────────────────────────────────────
function auditClaude() {
  const cats = {};
  const settings = readJson(path.join(CLAUDE, 'settings.json')) || {};
  const hooks = hookCommands(settings.hooks);
  const userMd = readText(path.join(HOME, 'CLAUDE.md')) + readText(path.join(CLAUDE, 'CLAUDE.md'));

  const mdBytes = sizeOf(path.join(HOME, 'CLAUDE.md')) + sizeOf(path.join(CLAUDE, 'CLAUDE.md'));
  cats['Instructions'] = [
    check('CLAUDE.md present', userMd.length > 0, 'Create ~/CLAUDE.md with your working rules', '~/CLAUDE.md'),
    check('Instruction budget sane (<64KB total)', mdBytes > 0 && mdBytes < 65536, 'Split detail into read-on-demand refs; keep the always-loaded file lean', '~/CLAUDE.md', `${(mdBytes / 1024).toFixed(1)}KB`),
    check('Read-on-demand split referenced', /refs\/|read on demand|read when/i.test(userMd), 'Point CLAUDE.md at split reference files instead of inlining everything', '~/CLAUDE.md'),
  ];

  const sk = auditSkillsDir(path.join(CLAUDE, 'skills'));
  cats['Skills'] = [
    check('Skills installed', sk.count > 0, 'Install skills into ~/.claude/skills', '~/.claude/skills', `${sk.count} skills`),
    check('No broken skill symlinks', sk.broken.length === 0, `Remove or repoint: ${sk.broken.slice(0, 3).join(', ')}`, '~/.claude/skills', `${sk.broken.length} broken`),
    check('Skills have SKILL.md (sampled)', sk.missingManifest.length === 0, `Add SKILL.md to: ${sk.missingManifest.slice(0, 3).join(', ')}`, '~/.claude/skills'),
  ];

  const deadHooks = hooks.map(h => scriptPathOf(h.command)).filter(p => p && !exists(p));
  cats['Hooks'] = [
    check('Hooks configured', hooks.length > 0, 'Wire hooks in ~/.claude/settings.json', '~/.claude/settings.json', `${hooks.length} hooks`),
    check('All hook scripts exist', deadHooks.length === 0, `Fix dead hook paths: ${deadHooks.slice(0, 2).join(', ')}`, '~/.claude/settings.json', `${deadHooks.length} dead`),
    check('Every hook has a timeout', hooks.every(h => typeof h.timeout === 'number'), 'Add "timeout" to each hook so one hang cannot stall turns', '~/.claude/settings.json'),
    check('Slow hooks are async', hooks.filter(h => (h.timeout || 0) >= 15).every(h => h.async === true), 'Mark hooks with timeout >=15s as "async": true', '~/.claude/settings.json'),
  ];

  const deny = ((settings.permissions || {}).deny) || [];
  cats['Security'] = [
    check('Permission deny list non-empty', deny.length > 0, 'Add a permissions.deny list', '~/.claude/settings.json', `${deny.length} rules`),
    check('.env files denied', deny.some(d => /\.env/.test(d)), 'Deny Read(.env*) so secrets never enter context', '~/.claude/settings.json'),
    check('curl|bash pipes denied', deny.some(d => /curl.*(\||bash|sh)/.test(d)), 'Deny curl-pipe-to-shell patterns', '~/.claude/settings.json'),
    check('Security rules doc present', exists(path.join(CLAUDE, 'rules', 'common', 'security.md')) || exists(path.join(CLAUDE, 'refs', 'common', 'security.md')), 'Add a security rules file under rules/ or refs/', '~/.claude/rules/common/security.md'),
  ];

  const memDirs = listDir(path.join(CLAUDE, 'projects')).filter(d => exists(path.join(CLAUDE, 'projects', d, 'memory', 'MEMORY.md')));
  cats['Memory'] = [
    check('Persistent memory in use', memDirs.length > 0 || /memory/i.test(userMd), 'Adopt a memory convention (MEMORY.md index + one fact per file)', '~/.claude/projects/*/memory/', `${memDirs.length} projects`),
    check('Memory conventions documented', /memory/i.test(userMd), 'Document when to save/recall memory in CLAUDE.md', '~/CLAUDE.md'),
  ];

  const routingDoc = ['rules/model-routing.md', 'refs/model-routing.md'].map(p => readText(path.join(CLAUDE, p))).join('');
  const tierCount = ['opus', 'sonnet', 'haiku', 'fable'].filter(t => routingDoc.toLowerCase().includes(t)).length;
  cats['Model Routing'] = [
    check('Routing doc present', routingDoc.length > 0, 'Write model-routing.md: match model tier to judgment depth', '~/.claude/refs/model-routing.md'),
    check('Covers >=3 tiers', tierCount >= 3, 'Route across at least 3 tiers (frontier / default / cheap)', '~/.claude/refs/model-routing.md', `${tierCount} tiers`),
    check('Routing wired into CLAUDE.md', /model routing|judgment-depth/i.test(userMd), 'Reference the routing rule from CLAUDE.md so it actually fires', '~/CLAUDE.md'),
  ];

  const env = settings.env || {};
  cats['Cost & Context'] = [
    check('Thinking tokens capped', Number(env.MAX_THINKING_TOKENS) > 0, 'Set env.MAX_THINKING_TOKENS in settings.json', '~/.claude/settings.json', env.MAX_THINKING_TOKENS),
    check('Output-discipline prompt hook', hooks.some(h => h.event === 'UserPromptSubmit' && /discipline|output/i.test(h.command)), 'Inject response-shape rules on UserPromptSubmit (lead with answer, no recaps)', '~/.claude/settings.json'),
    check('Context guidance documented', /context|token/i.test(userMd), 'Document context budget habits in CLAUDE.md', '~/CLAUDE.md'),
  ];

  const evals = path.join(CLAUDE, 'evals');
  cats['Evals'] = [
    check('Evals directory', exists(evals), 'Create ~/.claude/evals with grade scripts', '~/.claude/evals'),
    check('Baseline recorded', exists(path.join(evals, 'baseline.json')), 'Record a baseline.json to detect regressions', '~/.claude/evals/baseline.json'),
    check('Grade scripts (>=2)', listDir(evals).filter(f => /^grade-.*\.(sh|js)$/.test(f)).length >= 2, 'Add grade-*.sh scripts for repeatable harness grading', '~/.claude/evals'),
  ];

  return cats;
}

// ── Codex target ──────────────────────────────────────────────────
function auditCodex() {
  const cats = {};
  const config = readText(path.join(CODEX, 'config.toml'));
  const agentsMd = readText(path.join(CODEX, 'AGENTS.md'));
  const hooksJson = readJson(path.join(CODEX, 'hooks.json'));
  const hooks = hookCommands((hooksJson || {}).hooks);

  cats['Instructions'] = [
    check('AGENTS.md present', agentsMd.length > 0, 'Create ~/.codex/AGENTS.md with voice + working style', '~/.codex/AGENTS.md'),
    check('Instruction budget sane (<64KB)', agentsMd.length > 0 && agentsMd.length < 65536, 'Split detail into read-on-demand files', '~/.codex/AGENTS.md', `${(agentsMd.length / 1024).toFixed(1)}KB`),
    check('Read-on-demand split referenced', /read on demand|read when|refs\//i.test(agentsMd), 'Point AGENTS.md at split reference files', '~/.codex/AGENTS.md'),
  ];

  const sk = auditSkillsDir(path.join(CODEX, 'skills'));
  cats['Skills'] = [
    check('Skills installed', sk.count > 0, 'Install skills into ~/.codex/skills', '~/.codex/skills', `${sk.count} skills`),
    check('No broken skill symlinks', sk.broken.length === 0, `Remove or repoint: ${sk.broken.slice(0, 3).join(', ')}`, '~/.codex/skills', `${sk.broken.length} broken`),
    check('Skills have SKILL.md (sampled)', sk.missingManifest.length === 0, `Add SKILL.md to: ${sk.missingManifest.slice(0, 3).join(', ')}`, '~/.codex/skills'),
  ];

  const deadHooks = hooks.map(h => scriptPathOf(h.command)).filter(p => p && !exists(p));
  const trusted = (config.match(/^\[hooks\.state\."/gm) || []).length;
  cats['Hooks'] = [
    check('Hooks feature enabled', /^\s*hooks\s*=\s*true/m.test(config), 'Set [features] hooks = true in config.toml', '~/.codex/config.toml'),
    check('hooks.json valid', hooksJson !== null && hooks.length > 0, 'Create ~/.codex/hooks.json (Claude hook schema)', '~/.codex/hooks.json', `${hooks.length} hooks`),
    check('All hook scripts exist', deadHooks.length === 0, `Fix dead hook paths: ${deadHooks.slice(0, 2).join(', ')}`, '~/.codex/hooks.json', `${deadHooks.length} dead`),
    check('All hooks trusted', hooks.length > 0 && trusted >= hooks.length, 'Approve pending hook trust prompts (config.toml [hooks.state])', '~/.codex/config.toml', `${trusted}/${hooks.length} trusted`),
  ];

  cats['Security'] = [
    check('Sandbox mode set', /^\s*sandbox_mode\s*=/m.test(config), 'Set sandbox_mode (workspace-write recommended)', '~/.codex/config.toml'),
    check('Approvals not disabled', !/^\s*approval_policy\s*=\s*"never"/m.test(config), 'approval_policy = "never" removes the human gate; prefer "on-request"', '~/.codex/config.toml'),
    check('Reviewer configured', /approvals_reviewer/.test(config), 'Configure an approvals reviewer subagent', '~/.codex/config.toml'),
  ];

  cats['Memory'] = [
    check('Memories enabled', /^\s*memories\s*=\s*true/m.test(config) || /use_memories\s*=\s*true/.test(config), 'Enable [features] memories in config.toml', '~/.codex/config.toml'),
  ];

  const profiles = (config.match(/^\[profiles\./gm) || []).length;
  cats['Model Routing'] = [
    check('Routing profiles defined (>=2)', profiles >= 2, 'Add [profiles.*] per model tier for one-flag switching', '~/.codex/config.toml', `${profiles} profiles`),
    check('Routing documented in AGENTS.md', /routing|judgment/i.test(agentsMd), 'Document the judgment-depth rule in AGENTS.md', '~/.codex/AGENTS.md'),
  ];

  const effort = (config.match(/^\s*model_reasoning_effort\s*=\s*"(\w+)"/m) || [])[1];
  cats['Cost & Context'] = [
    check('Default effort not max/ultra', effort !== 'max' && effort !== 'ultra', 'Reserve max/ultra for escalation, not the session default', '~/.codex/config.toml', effort),
    check('Output-discipline prompt hook', hooks.some(h => h.event === 'UserPromptSubmit' && /discipline|output/i.test(h.command)), 'Inject response-shape rules on UserPromptSubmit', '~/.codex/hooks.json'),
  ];

  cats['Evals'] = [
    check('Audit tooling installed', exists(path.join(CODEX, 'skills', 'harness-radar')) || exists(path.join(CLAUDE, 'skills', 'harness-radar')), 'Install harness-radar as a skill so audits are one command', '~/.codex/skills/harness-radar'),
  ];

  return cats;
}

// ── generic target (any LLM harness, open source or homegrown) ───
// Only checks that hold for any harness: always-loaded instructions,
// parseable config, extension inventory, context budget hygiene.
const GENERIC_HARNESSES = {
  opencode: {
    home: path.join(HOME, '.config', 'opencode'),
    instructions: ['AGENTS.md', path.join(HOME, 'AGENTS.md')],
    extDirs: ['skills', 'commands', 'agents', 'plugin'],
  },
  gemini: {
    home: path.join(HOME, '.gemini'),
    instructions: ['GEMINI.md', path.join(HOME, 'GEMINI.md')],
    extDirs: ['extensions', 'commands', 'skills'],
  },
  aider: {
    home: HOME,
    instructions: ['CONVENTIONS.md', '.aider.conf.yml'],
    configs: ['.aider.conf.yml'],
    extDirs: [],
  },
  cursor: {
    home: path.join(HOME, '.cursor'),
    instructions: ['rules', path.join(HOME, '.cursorrules')],
    extDirs: ['rules', 'extensions'],
  },
  goose: {
    home: path.join(HOME, '.config', 'goose'),
    instructions: ['.goosehints', path.join(HOME, '.goosehints')],
    configs: ['config.yaml'],
    extDirs: ['extensions'],
  },
};

function resolveIn(home, p) {
  return path.isAbsolute(p) ? p : path.join(home, p);
}

function auditGeneric(def) {
  const cats = {};
  const instrPath = (def.instructions || []).map(p => resolveIn(def.home, p)).find(exists);
  const instrText = instrPath ? readText(instrPath) : '';
  const instrBytes = instrPath ? sizeOf(instrPath) : 0;
  const short = p => p ? p.replace(HOME, '~') : (def.instructions || ['<instructions>'])[0];

  cats['Instructions'] = [
    check('Always-loaded instructions present', !!instrPath, 'Create an instructions file (AGENTS.md is the cross-tool standard)', short(instrPath)),
    check('Instruction budget sane (<64KB)', instrBytes > 0 && instrBytes < 65536, 'Split detail into read-on-demand files; keep the always-loaded file lean', short(instrPath), `${(instrBytes / 1024).toFixed(1)}KB`),
    check('Read-on-demand split referenced', /read on demand|read when|refs\/|docs\//i.test(instrText), 'Point instructions at split reference files instead of inlining everything', short(instrPath)),
  ];

  const configPath = (def.configs || ['config.toml', 'config.yaml', 'config.json', 'settings.json'])
    .map(p => resolveIn(def.home, p)).find(exists);
  cats['Config'] = [
    check('Config present', !!configPath, 'No config file found; harness is running on defaults', short(configPath) || short(path.join(def.home, 'config.*'))),
  ];

  const extDir = (def.extDirs || []).map(d => resolveIn(def.home, d)).find(exists);
  const ext = extDir ? auditSkillsDir(extDir) : { count: 0, broken: [] };
  cats['Extensions'] = [
    check('Skills/commands/extensions installed', ext.count > 0, `Add reusable skills or commands under ${short(extDir) || def.extDirs.join('/')}`, short(extDir), `${ext.count} entries`),
    check('No broken symlinks', ext.broken.length === 0, `Remove or repoint: ${ext.broken.slice(0, 3).join(', ')}`, short(extDir), `${ext.broken.length} broken`),
  ];

  return cats;
}

// ── scoring + rendering ───────────────────────────────────────────
function scoreCats(cats) {
  const rows = Object.entries(cats).map(([name, checks]) => {
    const passed = checks.filter(c => c.pass).length;
    const score = checks.length ? Math.round((passed / checks.length) * 10) : 0;
    return { name, score, max: 10, checks };
  });
  const overall = rows.reduce((s, r) => s + r.score, 0);
  const max = rows.length * 10;
  return { rows, overall, max };
}

const GRADES = [[0.95, 'S'], [0.85, 'A'], [0.7, 'B'], [0.55, 'C'], [0.4, 'D'], [0, 'F']];
const gradeOf = (o, m) => GRADES.find(([t]) => o / m >= t)[1];

function bar(score, max) {
  const filled = Math.round((score / max) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function renderText(results) {
  const W = 59;
  const out = [];
  out.push('╔' + '═'.repeat(W) + '╗');
  out.push('║' + `  H A R N E S S   R A D A R   v${VERSION}`.padEnd(W) + '║');
  out.push('╚' + '═'.repeat(W) + '╝');
  for (const [target, { rows, overall, max }] of Object.entries(results)) {
    const grade = gradeOf(overall, max);
    out.push('');
    const head = ` ${target.toUpperCase()} `;
    const tail = ` ${overall}/${max}  grade ${grade} `;
    out.push('┌─' + head + '─'.repeat(Math.max(1, W - 3 - head.length - tail.length)) + tail + '─┐');
    for (const r of rows) {
      const mark = r.score === 10 ? '✓' : r.score >= 7 ? '~' : '✗';
      out.push('│' + ` ${mark} ${r.name.padEnd(16)} ${bar(r.score, r.max)}  ${String(r.score).padStart(2)}/10`.padEnd(W) + '│');
    }
    out.push('└' + '─'.repeat(W) + '┘');
    const fails = rows.flatMap(r => r.checks.filter(c => !c.pass).map(c => ({ cat: r.name, ...c })));
    if (fails.length) {
      out.push('  fixes:');
      fails.forEach((f, i) => {
        out.push(`  ${i + 1}. [${f.cat}] ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
        out.push(`     → ${f.fix}   ${f.file}`);
      });
    } else {
      out.push('  clean. nothing to fix.');
    }
  }
  return out.join('\n');
}

function renderMd(results) {
  const out = ['# Harness Radar Report', ''];
  for (const [target, { rows, overall, max }] of Object.entries(results)) {
    out.push(`## ${target} — ${overall}/${max} (grade ${gradeOf(overall, max)})`, '');
    out.push('| Category | Score | Bar |', '|---|---|---|');
    rows.forEach(r => out.push(`| ${r.name} | ${r.score}/10 | \`${bar(r.score, r.max)}\` |`));
    const fails = rows.flatMap(r => r.checks.filter(c => !c.pass).map(c => `- **[${r.name}]** ${c.name}: ${c.fix} (\`${c.file}\`)`));
    if (fails.length) out.push('', '### Fixes', ...fails);
    out.push('');
  }
  return out.join('\n');
}

// ── main ──────────────────────────────────────────────────────────
const results = {};
const customHome = flag('home', null);
if (customHome) {
  const home = path.resolve(customHome.replace(/^~/, HOME));
  results[flag('name', path.basename(home))] = scoreCats(auditGeneric({
    home,
    instructions: ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'instructions.md', 'SYSTEM.md'],
    extDirs: ['skills', 'commands', 'agents', 'extensions', 'plugins', 'rules'],
  }));
} else {
  if ((TARGET === 'claude' || TARGET === 'all') && exists(CLAUDE)) results.claude = scoreCats(auditClaude());
  if ((TARGET === 'codex' || TARGET === 'all') && exists(CODEX)) results.codex = scoreCats(auditCodex());
  for (const [name, def] of Object.entries(GENERIC_HARNESSES)) {
    const detectable = exists(def.home) &&
      ((def.instructions || []).some(p => exists(resolveIn(def.home, p))) ||
       (def.configs || []).some(p => exists(resolveIn(def.home, p))));
    if (TARGET === name || (TARGET === 'all' && detectable)) results[name] = scoreCats(auditGeneric(def));
  }
}
if (Object.keys(results).length === 0) {
  console.error(`No harness found for target "${TARGET}". Known: claude, codex, ${Object.keys(GENERIC_HARNESSES).join(', ')}, or --home <dir>.`);
  process.exit(2);
}

if (FORMAT === 'json') {
  console.log(JSON.stringify({ version: VERSION, generated_by: 'harness-radar', results }, null, 2));
} else if (FORMAT === 'md') {
  console.log(renderMd(results));
} else {
  console.log(renderText(results));
}

if (CI_MIN !== null) {
  const worst = Math.min(...Object.values(results).map(r => (r.overall / r.max) * 100));
  if (worst < Number(CI_MIN)) process.exit(1);
}
