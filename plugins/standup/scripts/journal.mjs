#!/usr/bin/env node
// standup — journals Claude Code sessions for standup reports.
//
//   journal.mjs log             SessionEnd hook: reads hook JSON on stdin, parses the
//                               transcript, appends one journal entry. Always exits 0.
//   journal.mjs report [--days N]   print journal entries from the last N days (default 4)
//                                   plus commits by the user across --repos-dir, as JSON
//
// Journal: ~/.claude/standup/journal.jsonl (one entry per session, last write wins).
// Config:  ~/.claude/standup.json  { "reportsDir": "~/standups", "reposDir": "~/repos" }
// Overrides for testing: STANDUP_STATE, STANDUP_CONFIG.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = os.homedir();
const STATE_DIR = process.env.STANDUP_STATE || path.join(HOME, '.claude', 'standup');
const CONFIG_PATH = process.env.STANDUP_CONFIG || path.join(HOME, '.claude', 'standup.json');
const JOURNAL = path.join(STATE_DIR, 'journal.jsonl');
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

const expand = (p) => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {
    reportsDir: expand(cfg.reportsDir || '~/standups'),
    reposDir: expand(cfg.reposDir || ''),
  };
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 });
  return res.status === 0 ? res.stdout.trim() : '';
}

// ---------- log (SessionEnd hook) ----------

function parseTranscript(file) {
  const out = {
    topic: '', userMessages: 0, files: new Set(), models: new Set(),
    tokens: { in: 0, out: 0, cacheRead: 0 }, first: null, last: null,
  };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain) continue;
    if (d.timestamp) {
      if (!out.first) out.first = d.timestamp;
      out.last = d.timestamp;
    }
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      const s = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : '';
      // skip slash-command wrappers, hook noise, and tool results
      if (s && !s.startsWith('<') && !s.startsWith('[Request interrupted')) {
        out.userMessages += 1;
        if (!out.topic) out.topic = s.replace(/\s+/g, ' ').slice(0, 200);
      }
    }
    if (d.type === 'assistant' && d.message) {
      if (d.message.model) out.models.add(d.message.model);
      const u = d.message.usage || {};
      out.tokens.in += u.input_tokens || 0;
      out.tokens.out += u.output_tokens || 0;
      out.tokens.cacheRead += u.cache_read_input_tokens || 0;
      for (const b of Array.isArray(d.message.content) ? d.message.content : []) {
        if (b.type === 'tool_use' && EDIT_TOOLS.has(b.name)) {
          const f = (b.input || {}).file_path || (b.input || {}).notebook_path;
          if (f) out.files.add(f);
        }
      }
    }
  }
  return out;
}

function cmdLog() {
  let hook = {};
  try { hook = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  const cwd = hook.cwd || process.cwd();
  const t = hook.transcript_path ? parseTranscript(hook.transcript_path) : null;
  if (!t) return;

  const repoRoot = git(['rev-parse', '--show-toplevel'], cwd);
  const repo = repoRoot ? path.basename(repoRoot) : path.basename(cwd);
  const branch = repoRoot ? git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) : '';
  const email = git(['config', 'user.email'], cwd);
  const commits = repoRoot && t.first
    ? git(['log', '--oneline', '--no-merges', `--author=${email}`, `--since=${t.first}`, `--until=${new Date(Date.now() + 60000).toISOString()}`], cwd)
        .split('\n').filter(Boolean)
    : [];

  // skip trivial sessions: nothing edited, nothing committed, barely any conversation
  if (!t.files.size && !commits.length && t.userMessages < 2) return;

  const durationMin = t.first && t.last
    ? Math.max(1, Math.round((Date.parse(t.last) - Date.parse(t.first)) / 60000)) : 0;
  const entry = {
    sessionId: hook.session_id || '',
    ts: t.last || new Date().toISOString(),
    repo, branch, cwd,
    topic: t.topic,
    files: [...t.files].map((f) => (repoRoot && f.startsWith(repoRoot + '/') ? f.slice(repoRoot.length + 1) : f)).slice(0, 50),
    commits: commits.slice(0, 30),
    durationMin,
    models: [...t.models],
    tokens: t.tokens,
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(JOURNAL, JSON.stringify(entry) + '\n');
}

// ---------- report ----------

function readJournal(sinceMs) {
  const bySession = new Map(); // last write wins per session
  let text;
  try { text = fs.readFileSync(JOURNAL, 'utf8'); } catch { return []; }
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line);
      bySession.set(e.sessionId || e.ts, e);
    } catch {}
  }
  return [...bySession.values()]
    .filter((e) => Date.parse(e.ts) >= sinceMs)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

function scanRepos(reposDir, sinceMs) {
  const commits = {};
  if (!reposDir || !fs.existsSync(reposDir)) return commits;
  const email = git(['config', '--global', 'user.email'], HOME);
  if (!email) return commits;
  const since = new Date(sinceMs).toISOString();
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(reposDir, entry.name);
    if (!fs.existsSync(path.join(dir, '.git'))) continue;
    const log = git(['log', '--all', '--oneline', '--no-merges', `--author=${email}`, `--since=${since}`], dir);
    if (log) commits[entry.name] = log.split('\n').filter(Boolean).slice(0, 30);
  }
  return commits;
}

function cmdReport(args) {
  const cfg = loadConfig();
  const i = args.indexOf('--days');
  const days = i >= 0 ? Number(args[i + 1]) || 4 : 4;
  const sinceMs = Date.now() - days * 86400000;
  const out = {
    generatedAt: new Date().toISOString(),
    sinceDays: days,
    reportsDir: cfg.reportsDir,
    sessions: readJournal(sinceMs),
    commitsByRepo: scanRepos(cfg.reposDir, sinceMs),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ---------- main ----------

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'log') cmdLog();
  else if (cmd === 'report') cmdReport(rest);
  else { console.error('usage: journal.mjs <log|report [--days N]>'); process.exit(1); }
} catch (e) {
  if (cmd === 'log') process.exit(0); // never disturb session shutdown
  throw e;
}
