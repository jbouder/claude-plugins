#!/usr/bin/env node
// skills-sync — keeps ~/.claude/skills in sync with upstream git repos.
//
// Modes:
//   sync.mjs hook              throttled sync for the SessionStart hook; JSON on stdout
//                              only when something happened, always exits 0
//   sync.mjs sync              full sync now (ignores throttle), human-readable report
//   sync.mjs status [--fetch]  report state without changing anything
//   sync.mjs add <owner/repo> [--path <p>] [--skills a,b] [--exclude a,b] [--url <git-url>]
//   sync.mjs remove <owner/repo>
//   sync.mjs install <skill> [...]   install pending new upstream skills
//   sync.mjs exclude <skill> [...]   permanently exclude skills from their source
//   sync.mjs relock [--all | <skill> ...]  set lock baseline to current installed content
//   sync.mjs init              write a starter manifest if none exists
//
// State: manifest at ~/.claude/skills-sync.json (user-owned), lock + clone cache under
// ~/.claude/skills-sync/. Overridable via SKILLS_SYNC_CONFIG / SKILLS_SYNC_STATE /
// SKILLS_SYNC_SKILLS_DIR for testing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HOME = os.homedir();
const CONFIG_PATH = process.env.SKILLS_SYNC_CONFIG || path.join(HOME, '.claude', 'skills-sync.json');
const STATE_DIR = process.env.SKILLS_SYNC_STATE || path.join(HOME, '.claude', 'skills-sync');
const SKILLS_DIR = process.env.SKILLS_SYNC_SKILLS_DIR || path.join(HOME, '.claude', 'skills');
const LOCK_PATH = path.join(STATE_DIR, 'lock.json');
const CACHE_DIR = path.join(STATE_DIR, 'cache');
const GIT_TIMEOUT_MS = 20000;
const IGNORED = new Set(['.DS_Store', '.git']);

// ---------- small utils ----------

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null);
  if (!cfg) return null;
  cfg.sources = Array.isArray(cfg.sources) ? cfg.sources : [];
  cfg.throttleHours = typeof cfg.throttleHours === 'number' ? cfg.throttleHours : 6;
  cfg.newSkills = ['auto', 'prompt', 'ignore'].includes(cfg.newSkills) ? cfg.newSkills : 'auto';
  return cfg;
}

function loadLock() {
  const lock = readJson(LOCK_PATH, {});
  lock.skills = lock.skills || {};
  lock.untrackedSeen = lock.untrackedSeen || [];
  return lock;
}

function saveLock(lock) { writeJson(LOCK_PATH, lock); }

// Content hash of a skill directory: sorted relative paths + file bytes.
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORED.has(entry.name)) continue;
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile()) {
        h.update(childRel + '\0');
        h.update(fs.readFileSync(path.join(dir, childRel)));
        h.update('\0');
      }
    }
  };
  walk('');
  return h.digest('hex');
}

function copySkill(fromDir, toDir) {
  fs.rmSync(toDir, { recursive: true, force: true });
  fs.cpSync(fromDir, toDir, {
    recursive: true,
    filter: (src) => !IGNORED.has(path.basename(src)),
  });
}

function git(args, cwd) {
  const res = spawnSync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const ok = res.status === 0 && !res.error;
  return { ok, err: (res.error && res.error.message) || (res.stderr || '').trim().split('\n').pop() || '' };
}

// ---------- sources ----------

function sourceUrl(source) {
  return source.url || `https://github.com/${source.repo}.git`;
}

function sourceCacheDir(source) {
  return path.join(CACHE_DIR, source.repo.replace(/\//g, '__'));
}

// Clone or update the cached shallow clone. Returns { ok, err }.
function refreshSource(source) {
  const dir = sourceCacheDir(source);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    return git(['clone', '--quiet', '--depth', '1', sourceUrl(source), dir]);
  }
  const fetch = git(['fetch', '--quiet', '--depth', '1', 'origin', 'HEAD'], dir);
  if (!fetch.ok) return fetch;
  return git(['reset', '--quiet', '--hard', 'FETCH_HEAD'], dir);
}

// Skills a source provides: subdirs of source.path containing SKILL.md,
// filtered by its skills allowlist / exclude list.
function sourceSkills(source) {
  const root = path.join(sourceCacheDir(source), source.path || '.');
  if (!fs.existsSync(root)) return new Map();
  const allow = source.skills && source.skills !== '*' ? new Set(source.skills) : null;
  const exclude = new Set(source.exclude || []);
  const map = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORED.has(entry.name)) continue;
    if (allow && !allow.has(entry.name)) continue;
    if (exclude.has(entry.name)) continue;
    if (!fs.existsSync(path.join(root, entry.name, 'SKILL.md'))) continue;
    map.set(entry.name, path.join(root, entry.name));
  }
  return map;
}

function installedSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !IGNORED.has(e.name))
    .map((e) => e.name);
}

// First source that provides each skill wins; later duplicates are collisions.
function claimSkills(cfg) {
  const claimed = new Map(); // name -> { source, dir }
  const collisions = [];
  for (const source of cfg.sources) {
    for (const [name, dir] of sourceSkills(source)) {
      if (claimed.has(name)) collisions.push({ name, source: source.repo, winner: claimed.get(name).source.repo });
      else claimed.set(name, { source, dir });
    }
  }
  return { claimed, collisions };
}

// ---------- core sync ----------

function runSync(cfg, { network = true, apply = true } = {}) {
  const lock = loadLock();
  const report = {
    updated: [], installed: [], newAvailable: [], conflicts: [], goneUpstream: [],
    localMods: [], pinned: [], untracked: [], untrackedNew: [], collisions: [], errors: [], removedLocally: [],
  };

  if (network) {
    for (const source of cfg.sources) {
      const res = refreshSource(source);
      if (!res.ok) report.errors.push(`${source.repo}: ${res.err || 'git fetch failed'}`);
    }
  }

  const { claimed, collisions } = claimSkills(cfg);
  report.collisions = collisions.map((c) => `${c.name} (${c.source} shadowed by ${c.winner})`);
  const installed = new Set(installedSkills());

  for (const [name, { source, dir }] of claimed) {
    const upstreamHash = hashDir(dir);
    const entry = lock.skills[name];
    const installDir = path.join(SKILLS_DIR, name);
    const isInstalled = installed.has(name);

    if (!isInstalled) {
      if (entry && !entry.removedLocally) {
        // Was synced before, user deleted it locally: respect that, note it once.
        entry.removedLocally = true;
        report.removedLocally.push(name);
      } else if (!entry && cfg.newSkills !== 'ignore') {
        if (cfg.newSkills === 'auto' && apply) {
          copySkill(dir, installDir);
          lock.skills[name] = { source: source.repo, hash: upstreamHash };
          report.installed.push(name);
        } else {
          report.newAvailable.push(`${name} (from ${source.repo})`);
        }
      }
      continue;
    }

    const installedHash = hashDir(installDir);
    if (entry && entry.removedLocally) delete entry.removedLocally; // it's back

    if (!entry) {
      // Installed before tracking began. If it matches upstream, track normally; if it
      // differs we cannot tell a stale version from a local edit — pin it and let the
      // user decide (install = take upstream, stays pinned = keep local).
      lock.skills[name] = { source: source.repo, hash: installedHash };
      if (installedHash !== upstreamHash) {
        lock.skills[name].pinned = true;
        lock.skills[name].upstreamSeen = upstreamHash;
        report.pinned.push(`${name} (differs from upstream — kept; "install ${name}" takes upstream)`);
      }
      continue;
    }

    entry.source = source.repo;
    if (entry.pinned) {
      // User chose to keep a local version. Never auto-apply; note when upstream moves.
      if (installedHash === upstreamHash) {
        delete entry.pinned;
        delete entry.upstreamSeen;
        entry.hash = upstreamHash; // converged again
      } else if (upstreamHash !== entry.upstreamSeen) {
        entry.upstreamSeen = upstreamHash;
        report.pinned.push(`${name} (upstream changed again — still pinned to local)`);
      }
      continue;
    }
    if (installedHash === entry.hash) {
      if (upstreamHash !== entry.hash) {
        if (apply) {
          copySkill(dir, installDir);
          entry.hash = upstreamHash;
          report.updated.push(name);
        } else {
          report.updated.push(`${name} (pending)`);
        }
      }
    } else if (installedHash === upstreamHash) {
      entry.hash = upstreamHash; // user applied the same change by hand
    } else if (upstreamHash === entry.hash) {
      report.localMods.push(name); // local edits only; never overwritten
    } else {
      report.conflicts.push(name); // both sides changed; never overwritten
    }
    delete entry.goneReported;
  }

  // Tracked skills whose upstream disappeared (renamed/removed).
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (claimed.has(name)) continue;
    if (!entry.goneReported) {
      entry.goneReported = true;
      report.goneUpstream.push(`${name} (was ${entry.source})`);
    }
  }

  // Installed skills no source provides.
  const untracked = [...installed].filter((n) => !claimed.has(n)).sort();
  report.untracked = untracked;
  const justGone = new Set(report.goneUpstream.map((s) => s.split(' ')[0]));
  report.untrackedNew = untracked.filter((n) => !lock.untrackedSeen.includes(n) && !justGone.has(n));
  lock.untrackedSeen = untracked;

  if (apply) {
    lock.lastRun = new Date().toISOString();
    saveLock(lock); // status mode (apply=false) must not persist throttle/seen-state
  }
  return report;
}

// ---------- output ----------

function summarize(report, { includeQuiet = false } = {}) {
  const lines = [];
  const add = (label, items) => { if (items.length) lines.push(`${label}: ${items.join(', ')}`); };
  add('updated', report.updated);
  add('installed new', report.installed);
  add('new skills available (not installed)', report.newAvailable);
  add('conflicts — local edits AND upstream changes, not overwritten', report.conflicts);
  add('gone upstream (kept locally)', report.goneUpstream);
  add('deleted locally (not reinstalled)', report.removedLocally);
  add('name collisions', report.collisions);
  add('sync errors', report.errors);
  add('pinned to local version (upstream differs)', report.pinned);
  add('new untracked skills (no source)', report.untrackedNew);
  if (includeQuiet) {
    add('locally modified (upstream unchanged)', report.localMods);
    add('untracked (no source)', report.untracked);
  }
  return lines;
}

function hookOutput(report) {
  const lines = summarize(report);
  if (!lines.length) return null;
  const context = [
    '[skills-sync] Profile-skill sync ran at session start:',
    ...lines.map((l) => `- ${l}`),
    'Briefly tell the user what changed. For conflicts, new available skills, or errors, offer to resolve them (the /skills-sync:sync skill manages sources, installs, adoption, and conflict resolution).',
  ].join('\n');
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
}

// ---------- commands ----------

function cmdHook() {
  const cfg = loadConfig();
  if (!cfg || !cfg.sources.length) return; // unconfigured: stay silent
  const lock = loadLock();
  if (lock.lastRun && Date.now() - Date.parse(lock.lastRun) < cfg.throttleHours * 3600 * 1000) return;
  const report = runSync(cfg);
  const out = hookOutput(report);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
}

function cmdSync() {
  const cfg = requireConfig();
  const report = runSync(cfg);
  const lines = summarize(report, { includeQuiet: true });
  console.log(lines.length ? lines.join('\n') : 'Everything in sync.');
}

function cmdStatus(args) {
  const cfg = requireConfig();
  const report = runSync(cfg, { network: args.includes('--fetch'), apply: false });
  console.log(`manifest: ${CONFIG_PATH}`);
  console.log(`sources: ${cfg.sources.map((s) => s.repo).join(', ') || '(none)'}`);
  console.log(`newSkills: ${cfg.newSkills}  throttleHours: ${cfg.throttleHours}`);
  const lines = summarize(report, { includeQuiet: true });
  console.log(lines.length ? lines.join('\n') : 'Everything in sync.');
  if (!args.includes('--fetch')) console.log('(compared against cached clones; pass --fetch to refresh)');
}

function cmdAdd(args) {
  const repo = args.find((a) => !a.startsWith('--'));
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) die('usage: add <owner/repo> [--path <p>] [--skills a,b] [--exclude a,b] [--url <git-url>]');
  const cfg = loadConfig() || { sources: [], throttleHours: 6, newSkills: 'auto' };
  if (cfg.sources.some((s) => s.repo === repo)) die(`source ${repo} already present`);
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const source = { repo, path: opt('path') || '.', skills: opt('skills') ? opt('skills').split(',') : '*' };
  if (opt('exclude')) source.exclude = opt('exclude').split(',');
  if (opt('url')) source.url = opt('url');
  cfg.sources.push(source);
  writeJson(CONFIG_PATH, cfg);
  const res = refreshSource(source);
  if (!res.ok) die(`added ${repo}, but fetching it failed: ${res.err}`);
  console.log(`added ${repo}; it provides: ${[...sourceSkills(source).keys()].join(', ') || '(no skills found under ' + source.path + ')'}`);
}

function cmdRemove(args) {
  const repo = args[0];
  const cfg = requireConfig();
  const before = cfg.sources.length;
  cfg.sources = cfg.sources.filter((s) => s.repo !== repo);
  if (cfg.sources.length === before) die(`no source ${repo} in manifest`);
  writeJson(CONFIG_PATH, cfg);
  console.log(`removed ${repo}; installed skills are left in place (now untracked)`);
}

function cmdInstall(args) {
  if (!args.length) die('usage: install <skill> [...]');
  const cfg = requireConfig();
  const { claimed } = claimSkills(cfg);
  const lock = loadLock();
  for (const name of args) {
    const hit = claimed.get(name);
    if (!hit) { console.error(`no source provides "${name}" (try sync first)`); continue; }
    copySkill(hit.dir, path.join(SKILLS_DIR, name));
    lock.skills[name] = { source: hit.source.repo, hash: hashDir(hit.dir) };
    console.log(`installed ${name} from ${hit.source.repo}`);
  }
  saveLock(lock);
}

function cmdExclude(args) {
  if (!args.length) die('usage: exclude <skill> [...]');
  const cfg = requireConfig();
  const { claimed } = claimSkills(cfg);
  for (const name of args) {
    const hit = claimed.get(name);
    const source = hit ? hit.source : cfg.sources[0];
    if (!source) die('no sources configured');
    source.exclude = [...new Set([...(source.exclude || []), name])];
    console.log(`excluded ${name} on ${source.repo}`);
  }
  writeJson(CONFIG_PATH, cfg);
}

function cmdRelock(args) {
  const cfg = requireConfig();
  const { claimed } = claimSkills(cfg);
  const lock = loadLock();
  const names = args.includes('--all') ? [...claimed.keys()] : args;
  if (!names.length) die('usage: relock --all | relock <skill> [...]');
  for (const name of names) {
    const installDir = path.join(SKILLS_DIR, name);
    const hit = claimed.get(name);
    if (!fs.existsSync(installDir)) { delete lock.skills[name]; continue; }
    if (!hit) { console.error(`skipping ${name}: no source provides it`); continue; }
    const installedHash = hashDir(installDir);
    const upstreamHash = hashDir(hit.dir);
    lock.skills[name] = { source: hit.source.repo, hash: installedHash };
    if (installedHash !== upstreamHash) {
      lock.skills[name].pinned = true;
      lock.skills[name].upstreamSeen = upstreamHash;
      console.log(`pinned ${name} to its current installed content (upstream differs; it will not be auto-applied)`);
    } else {
      console.log(`baselined ${name} at its current installed content (matches upstream)`);
    }
  }
  saveLock(lock);
}

function cmdInit() {
  if (fs.existsSync(CONFIG_PATH)) die(`manifest already exists at ${CONFIG_PATH}`);
  writeJson(CONFIG_PATH, {
    sources: [{ repo: 'OWNER/skills-repo', path: '.', skills: '*' }],
    throttleHours: 6,
    newSkills: 'auto',
  });
  console.log(`wrote starter manifest to ${CONFIG_PATH} — edit the sources, then run: sync`);
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg) die(`no manifest at ${CONFIG_PATH} — run: init`);
  return cfg;
}

function die(msg) { console.error(msg); process.exit(1); }

// ---------- main ----------

const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'hook': cmdHook(); break;
    case 'sync': cmdSync(); break;
    case 'status': cmdStatus(rest); break;
    case 'add': cmdAdd(rest); break;
    case 'remove': cmdRemove(rest); break;
    case 'install': cmdInstall(rest); break;
    case 'exclude': cmdExclude(rest); break;
    case 'relock': cmdRelock(rest); break;
    case 'init': cmdInit(); break;
    default: die('usage: sync.mjs <hook|sync|status|add|remove|install|exclude|relock|init>');
  }
} catch (e) {
  if (cmd === 'hook') process.exit(0); // never disturb session startup
  throw e;
}
