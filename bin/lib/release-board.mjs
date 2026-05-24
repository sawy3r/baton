#!/usr/bin/env node
// release-board.mjs — shared, branch-aware release-board reader.
//
// Resolves every slice's authoritative status.json straight from git refs,
// in priority order:
//   1. track/<release>/<track-id>   the slice's own track branch (authoritative)
//   2. release-wt/<release>         the release assembly branch (baseline)
//   3. the working tree             last resort (a release with no branch yet)
//
// Reading committed refs — not whatever happens to be checked out — keeps the
// board honest regardless of the current branch or worktree on disk.
//
// Every track branch carries a full (and usually stale) copy of every other
// track's slices, so the authoritative copy is selected by OWNERSHIP
// (slice -> track, from index.md `tracks:` frontmatter), never by recency.
//
// Consumed by:
//   - release-board-ui.mjs      imports { readBoard, TERMINAL_STATES }
//   - release-board-status.sh   runs this file directly for its JSON payload
//
// The repo it reports on is resolved from the current working directory, so it
// works whether it lives inside the repo or is installed at ~/.claude/bin/lib/.
// The release-docs root defaults to docs/release/ (baton's convention — a real
// directory or a symlink into a docs-site subtree); override with the
// BATON_RELEASE_DIR environment variable for a non-standard layout.
//
// Run directly to emit the whole board as JSON:
//   node release-board.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

// The target repo is the one we are invoked from — resolved from the current
// working directory, NOT this script's install location. Once installed the
// script lives at ~/.claude/bin/lib/, nowhere near the repo it reports on.
function resolveRepoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = resolveRepoRoot();
// Release-docs root, relative to the repo. baton's convention is docs/release/.
const RELEASE_DIR_REL = process.env.BATON_RELEASE_DIR || 'docs/release';
const RELEASE_DIR = path.join(REPO_ROOT, RELEASE_DIR_REL);

// git ls-tree / git show do NOT traverse symlinks. A project that points
// `docs/` at its docs-site subtree (baton's Fumadocs symlink convention)
// therefore needs the *canonical* repo-relative path for every git-ref read —
// otherwise those reads silently return nothing and the board falls back to
// stale working-tree data. Resolve the real path once, here; the filesystem
// reads keep using RELEASE_DIR, where symlinks resolve fine on their own.
function canonicalGitPath() {
  try {
    const rel = path.relative(REPO_ROOT, fs.realpathSync(RELEASE_DIR));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  } catch { /* release dir not created yet — the literal path is the best guess */ }
  return RELEASE_DIR_REL;
}
const RELEASE_DIR_GIT = canonicalGitPath();

// Slices in these states don't block go-live.
export const TERMINAL_STATES = new Set(['verified', 'shipped', 'deferred']);

// index.md spec-column values that mean "no spec written yet".
const PENDING_SPEC_CELLS = new Set(['', '(pending)', '—', '-']);

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
      ...opts,
    });
  } catch {
    return null;
  }
}

function listBranches(prefix) {
  const out = git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`]);
  if (!out) return [];
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

// Does a ref resolve? Used to prefer a local branch over its origin/ mirror.
function refExists(ref) {
  return git(['rev-parse', '--verify', '--quiet', ref]) != null;
}

// Is `ancestor` fully contained in `descendant`'s history? `git merge-base
// --is-ancestor` exits 0 (yes) or non-zero (no, or a bad ref); git() maps every
// non-zero exit to null, so a non-null result is exactly the "yes" answer.
function isAncestor(ancestor, descendant) {
  return git(['merge-base', '--is-ancestor', ancestor, descendant]) != null;
}

// Parse a status.json blob, healing the one known subagent artifact in memory
// (stray `</content></invoke>` tool-envelope tags). Returns the object or null.
// The heal is in-memory only — the file on disk is never rewritten.
function parseStatus(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const healed = raw.replace(/\s*<\/content>\s*<\/invoke>\s*$/, '\n');
    if (healed === raw) return null;
    try { return JSON.parse(healed); } catch { return null; }
  }
}

// ---------------------------------------------------------------------------
// per-branch / per-worktree readers
// ---------------------------------------------------------------------------

// One release folder read from one git branch in a single ls-tree pass:
// every slice's parsed status.json, plus the set of slice IDs carrying a
// spec.md. Returns { statuses: { sliceId: obj }, specSlices: Set<sliceId> }.
function readBranchTree(branch, releaseDirRel) {
  const tree = git(['ls-tree', '-r', branch, '--', releaseDirRel]);
  if (!tree) return { statuses: {}, specSlices: new Set() };

  const statusEntries = [];
  const specSlices = new Set();
  for (const line of tree.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const meta = line.slice(0, tab).split(/\s+/); // [mode, type, sha]
    const filePath = line.slice(tab + 1);
    if (meta[1] !== 'blob') continue;
    if (filePath.endsWith('/status.json')) {
      statusEntries.push({ sha: meta[2], path: filePath });
    } else if (filePath.endsWith('/spec.md')) {
      specSlices.add(filePath.split('/').at(-2));
    }
  }
  if (statusEntries.length === 0) return { statuses: {}, specSlices };

  // cat-file --batch output order matches the SHA order fed on stdin.
  // encoding:null returns the raw Buffer (the literal 'buffer' string is
  // rejected by execFileSync); blob sizes are byte counts, so byte offsets
  // into the Buffer are what the parse below relies on.
  const batch = git(['cat-file', '--batch'], {
    input: statusEntries.map(e => e.sha).join('\n') + '\n',
    encoding: null,
  });
  if (!batch) return { statuses: {}, specSlices };

  const statuses = {};
  let off = 0;
  for (const entry of statusEntries) {
    const nl = batch.indexOf(0x0a, off);
    if (nl < 0) break;
    const header = batch.toString('utf8', off, nl).split(' ');
    off = nl + 1;
    if (header[1] === 'missing') continue;
    const size = parseInt(header[2], 10); // size is bytes, off is a byte offset
    if (!Number.isFinite(size)) break;
    const parsed = parseStatus(batch.toString('utf8', off, off + size));
    off += size + 1; // content + trailing LF
    if (!parsed) continue;
    statuses[entry.path.split('/').at(-2)] = parsed;
  }
  return { statuses, specSlices };
}

// One release folder read from the working tree. Lowest-priority fallback —
// a release with no branch at all, or git unavailable.
function readWorktreeTree(rel) {
  const statuses = {};
  const specSlices = new Set();
  const relDir = path.join(RELEASE_DIR, rel);
  if (!fs.existsSync(relDir)) return { statuses, specSlices };
  // withFileTypes resolves the entry type within the readdir syscall — no
  // follow-up statSync, so an atomic-write temp file (index.md.tmp.<pid>.<hash>)
  // renamed away between listing and stat can't ENOENT-crash the scan.
  for (const entry of fs.readdirSync(relDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slice = entry.name;
    const sliceDir = path.join(relDir, slice);
    if (fs.existsSync(path.join(sliceDir, 'spec.md'))) specSlices.add(slice);
    const statusFile = path.join(sliceDir, 'status.json');
    if (!fs.existsSync(statusFile)) continue;
    const parsed = parseStatus(fs.readFileSync(statusFile, 'utf8'));
    if (parsed) statuses[slice] = parsed;
    else console.warn(`[release-board] skipping ${path.relative(REPO_ROOT, statusFile)} — parse error`);
  }
  return { statuses, specSlices };
}

// ---------------------------------------------------------------------------
// index.md parsing
// ---------------------------------------------------------------------------

// A release's index.md text, preferring the release-wt branch copy over the
// working tree — planning artefacts land on release-wt, not the integration
// branch.
function indexText(rel, releaseWtBranches) {
  const rwt = `release-wt/${rel}`;
  const fromBranch = releaseWtBranches.has(rwt)
    ? git(['show', `${rwt}:${RELEASE_DIR_GIT}/${rel}/index.md`])
    : null;
  if (fromBranch != null) return fromBranch;
  const wt = path.join(RELEASE_DIR, rel, 'index.md');
  return fs.existsSync(wt) ? fs.readFileSync(wt, 'utf8') : '';
}

// Parsed view of a release's index.md frontmatter `tracks:` block. Returns:
//   sliceTrack — { sliceId: trackId }   ownership map (resolution)
//   trackIds   — Set<trackId>            for the ghost-slice row filter
//   tracks     — [{ id, state, dependsOn:[trackId], slices:[sliceId],
//                   worktreePath, worktreeBranch }]  in frontmatter order
// `worktreePath` / `worktreeBranch` let the oracle stand in as the complete
// track-discovery source for the slash commands — they no longer re-read
// index.md frontmatter themselves (a launch-directory read was the recurring
// stale-branch trap). An un-materialised track has `worktreePath: null`.
// The per-slice `track` field in status.json was not backfilled for slices
// planned before track mode, so index.md is the authoritative mapping.
//
// Accepted YAML shapes for list-valued track keys (`slices`, `depends_on`):
//   inline-flow:    `slices: [S01, S02]`
//   multi-line flow `slices:` then `[`, items on separate lines, then `]`
//   block-list:     `slices:` followed by indented `- S01` / `- S02` lines
//   single-scalar   `depends_on: T1-foo`
//   null/empty:     `depends_on: null` / `depends_on: []`
// The earlier regex-only walker silently dropped every shape except inline
// flow — sessions that emitted block YAML or pretty-printed multi-line flow
// produced a board with empty per-track `slices`, breaking the dashboard's
// track-grouped render.
function parseTracks(text) {
  const sliceTrack = {};
  const trackIds = new Set();
  const tracks = [];
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return { sliceTrack, trackIds, tracks };

  const SCALAR_KEYS = { state: 'state',
                        worktree_path: 'worktreePath',
                        worktree_branch: 'worktreeBranch' };
  const LIST_KEYS = { slices: 'slices', depends_on: 'dependsOn' };

  let cur = null;
  // Which list key on `cur` is currently "open" — i.e. was declared with an
  // empty value, so subsequent indented `- <item>` lines feed into it.
  // Closed when any other key on the track is seen, or a new track starts.
  let openKey = null;

  const pushTo = (prop, value) => {
    cur[prop].push(value);
    if (prop === 'slices') sliceTrack[value] = cur.id;
  };

  const lines = fm[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // `- id:` always starts a new track entry, regardless of any open list.
    const idM = line.match(/^\s*-\s+id:\s*(\S+)/);
    if (idM) {
      cur = { id: idM[1], state: null, dependsOn: [], slices: [],
              worktreePath: null, worktreeBranch: null };
      trackIds.add(cur.id);
      tracks.push(cur);
      openKey = null;
      continue;
    }
    if (!cur) continue;

    // Indented `- <scalar>` bullet — feeds the currently open list key.
    const bulletM = line.match(/^\s+-\s+(\S.*)$/);
    if (bulletM && openKey) {
      const v = bulletM[1].trim();
      if (v) pushTo(openKey, v);
      continue;
    }

    // `key: <maybe-value>` on a track property line.
    const kvM = line.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kvM) continue;
    const key = kvM[1];
    let rest = kvM[2].trim();

    if (key in SCALAR_KEYS) {
      cur[SCALAR_KEYS[key]] = rest || null;
      openKey = null;
      continue;
    }

    if (key in LIST_KEYS) {
      const prop = LIST_KEYS[key];
      // Empty value: could be a block-list (next non-blank line is `- item`),
      // a multi-line flow sequence (next non-blank line starts with `[`), or
      // just an empty key. Peek to disambiguate.
      if (rest === '') {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        const peek = j < lines.length ? lines[j].trim() : '';
        if (peek.startsWith('[')) {
          // Multi-line flow — collect lines until the closing `]`.
          let buf = '';
          for (; j < lines.length; j++) {
            buf += ' ' + lines[j];
            if (lines[j].includes(']')) { i = j; break; }
          }
          rest = buf.trim();
        } else {
          openKey = prop;
          continue;
        }
      }
      openKey = null;
      // Explicit null/empty.
      if (rest === 'null' || rest === '~' || rest === '[]') continue;
      // Flow sequence `[a, b, c]` (single- or multi-line, after joining above).
      const flow = rest.match(/^\[([\s\S]*)\]$/);
      if (flow) {
        for (const s of flow[1].split(',')) {
          const id = s.trim();
          if (id) pushTo(prop, id);
        }
        continue;
      }
      // Bare single scalar (`depends_on: T1-foo`).
      pushTo(prop, rest);
    }
  }
  return { sliceTrack, trackIds, tracks };
}

// Release-level worktree fields from index.md frontmatter — the release
// assembly worktree, set by the first /implement-slice in the release.
// Top-level frontmatter keys, distinct from the per-track worktree_path.
function parseReleaseWorktree(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const body = fm ? fm[1] : '';
  const pick = (key) => (body.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim() || null;
  return {
    releaseWorktreePath: pick('release_worktree_path'),
    releaseWorktreeBranch: pick('release_worktree_branch'),
  };
}

// The integration branch a release merges back into, from index.md "Release
// summary" — e.g. "- **Target version / integration branch**: `release/v0.5.0`".
function parseIntegrationBranch(text) {
  const m = text.match(/integration branch[^\n`]*`([^`]+)`/i);
  return m ? m[1].trim() : null;
}

// Has this release already been merged into its integration branch? /merge-release
// records nothing structural (no release-level state flag), so git ancestry is
// the only signal: the release-wt branch is contained in the integration branch.
// A release-wt branch that no longer exists was wound down after merging
// (merge-release.md retains it only until the release is concluded) — also
// treated as merged. Unknown integration branch ⇒ false (cannot claim merged).
function releaseMergedToBase(rel, idxText) {
  const rwt = `release-wt/${rel}`;
  const rwtRef = refExists(rwt) ? rwt
               : refExists(`origin/${rwt}`) ? `origin/${rwt}` : null;
  if (!rwtRef) return true; // no release-wt branch anywhere — release concluded
  const integ = parseIntegrationBranch(idxText);
  if (!integ) return false;
  const integRef = refExists(integ) ? integ
                 : refExists(`origin/${integ}`) ? `origin/${integ}` : null;
  if (!integRef) return false;
  return isAncestor(rwtRef, integRef);
}

// Slice rows from a release's index.md `## Slices` table. Returns
// [{ sid, specCell }]. Track-table rows share the row shape `| `ID` | ... |`
// (`T1-projection` matches a slice-ID regex just as well as `S13-...`), so
// rows whose ID is a known track ID are dropped — that ambiguity is exactly
// what made the pre-track-mode check flag every track as a ghost slice.
function indexSliceRows(text, trackIds) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*`([A-Z][0-9a-zA-Z-]+)`\s*\|/);
    if (!m) continue;
    const sid = m[1];
    if (trackIds.has(sid)) continue;
    // Row layout: (empty) | ID | outcome | state | owner | spec | proof
    const specCell = (line.split('|')[5] ?? '').trim();
    rows.push({ sid, specCell });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// per-release resolution
// ---------------------------------------------------------------------------

// Resolve every slice in one release to its authoritative state, and gather
// the raw material the planning-record check needs.
function readRelease(rel, releaseWtBranches) {
  const releaseDirGit = `${RELEASE_DIR_GIT}/${rel}`;
  const idxText = indexText(rel, releaseWtBranches);
  const { sliceTrack, trackIds, tracks } = parseTracks(idxText);
  const { releaseWorktreePath, releaseWorktreeBranch } = parseReleaseWorktree(idxText);

  const trackTrees = {}; // track branch name -> { statuses, specSlices }
  for (const tb of listBranches(`track/${rel}/`)) {
    trackTrees[tb] = readBranchTree(tb, releaseDirGit);
  }
  const rwt = `release-wt/${rel}`;
  const rwtTree = releaseWtBranches.has(rwt)
    ? readBranchTree(rwt, releaseDirGit)
    : { statuses: {}, specSlices: new Set() };
  const wtTree = readWorktreeTree(rel);

  // A slice has a spec if spec.md exists on any branch we read, or on disk.
  const specSlices = new Set([
    ...rwtTree.specSlices,
    ...wtTree.specSlices,
    ...Object.values(trackTrees).flatMap(t => [...t.specSlices]),
  ]);

  const dirIds = new Set([
    ...Object.keys(rwtTree.statuses),
    ...Object.keys(wtTree.statuses),
    ...Object.values(trackTrees).flatMap(t => Object.keys(t.statuses)),
  ]);

  const slices = [];
  const knownIds = new Set();
  const stateById = {};
  for (const id of dirIds) {
    // A baseline copy supplies the `track` field (and the fallback state).
    const base = rwtTree.statuses[id] ?? wtTree.statuses[id]
      ?? Object.values(trackTrees).map(t => t.statuses[id]).find(Boolean);
    if (!base) continue;

    // Authoritative copy = the slice's own track branch, if materialised.
    const trackId = sliceTrack[id] ?? base.track;
    const trackBranch = trackId ? `track/${rel}/${trackId}` : null;
    const status = (trackBranch && trackTrees[trackBranch]?.statuses?.[id]) || base;

    const sliceId = status.slice_id ?? id;
    const state = status.state ?? 'unknown';
    slices.push({
      id: sliceId,
      state,
      owner: status.owner ?? '',
      lastUpdated: status.last_updated_at ?? null,
      track: trackId ?? null,
      actionable: false,
    });
    // Index rows may name the slice by directory name or by slice_id field;
    // key both so the planning-record check matches either spelling.
    knownIds.add(id);
    knownIds.add(sliceId);
    stateById[id] = state;
    stateById[sliceId] = state;
  }

  // --- "what's next" derivation: sequential gate + dependency gate --------
  // Tag the one actionable slice per track (first non-terminal, in track
  // order); record each track's unmet dependencies and merge-readiness. A
  // dependency-blocked track has no actionable slice. Untracked slices are
  // independent — every non-terminal one is actionable.
  const sliceById = {};
  for (const s of slices) sliceById[s.id] = s;
  const mergedTrackIds = new Set(
    tracks.filter(t => t.state === 'merged').map(t => t.id));
  for (const tr of tracks) {
    tr.blockedBy = tr.dependsOn.filter(d => !mergedTrackIds.has(d));
    const own = tr.slices.map(id => sliceById[id]).filter(Boolean);
    const allTerminal = own.length > 0 && own.every(s => TERMINAL_STATES.has(s.state));
    tr.readyToMerge = allTerminal && tr.state !== 'merged' && tr.blockedBy.length === 0;
    if (tr.blockedBy.length === 0) {
      const next = own.find(s => !TERMINAL_STATES.has(s.state));
      if (next) next.actionable = true;
    }
  }
  for (const s of slices) {
    if (!s.track && !TERMINAL_STATES.has(s.state)) s.actionable = true;
  }

  return { rel, slices, specSlices, knownIds, stateById, idxText, trackIds, tracks,
           releaseWorktreePath, releaseWorktreeBranch,
           mergedToBase: releaseMergedToBase(rel, idxText) };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

// The whole release board: every release's resolved slices and ordered
// `tracks` metadata, plus planning-record integrity warnings (index.md rows
// that diverge from committed branch reality).
// Each slice carries `track` + `actionable` (the next slice to act on in its
// track); each track carries `state`, `dependsOn`, `blockedBy` (unmet deps),
// `readyToMerge`, and `worktreePath` / `worktreeBranch`. Each release also
// carries `releaseWorktreePath` / `releaseWorktreeBranch` and `mergedToBase`
// (release-wt is already contained in the integration branch).
// Shape: { releases: { <rel>: { slices, tracks, releaseWorktreePath,
//          releaseWorktreeBranch, mergedToBase } }, ghostSlices, pendingSpecs }.
export function readBoard() {
  const releaseWtBranches = new Set(listBranches('release-wt/'));

  // Releases are discovered from the working tree AND from release-wt branch
  // names — a release planned straight onto its branch has no working-tree dir.
  const names = new Set();
  if (fs.existsSync(RELEASE_DIR)) {
    for (const rel of fs.readdirSync(RELEASE_DIR)) {
      if (fs.statSync(path.join(RELEASE_DIR, rel)).isDirectory()) names.add(rel);
    }
  }
  for (const b of releaseWtBranches) names.add(b.slice('release-wt/'.length));

  const releases = {};
  const ghostSlices = [];
  const pendingSpecs = [];

  for (const rel of [...names].sort()) {
    const r = readRelease(rel, releaseWtBranches);
    if (r.slices.length) {
      releases[rel] = {
        slices: r.slices,
        tracks: r.tracks,
        releaseWorktreePath: r.releaseWorktreePath,
        releaseWorktreeBranch: r.releaseWorktreeBranch,
        mergedToBase: r.mergedToBase,
      };
    }

    // Planning-record integrity: walk the index.md `## Slices` table and flag
    // rows that committed branch state can't back.
    for (const { sid, specCell } of indexSliceRows(r.idxText, r.trackIds)) {
      if (!r.knownIds.has(sid)) {
        // (a) ghost slice: named in index.md, no status.json on any branch.
        ghostSlices.push(`${rel} / ${sid}`);
        continue;
      }
      // (b) pending spec: a live slice whose spec column is unfilled and
      // whose spec.md is absent from every branch — anchored, unimplementable.
      if (!PENDING_SPEC_CELLS.has(specCell)) continue;
      if (r.specSlices.has(sid)) continue;
      const state = r.stateById[sid] ?? '';
      if (TERMINAL_STATES.has(state)) continue;
      pendingSpecs.push(`${rel} / ${sid} (index row spec: '${specCell}', state: ${state || 'unknown'})`);
    }
  }

  return { releases, ghostSlices, pendingSpecs };
}

// CLI: emit the board as JSON for release-board-status.sh to consume.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(readBoard()) + '\n');
}
