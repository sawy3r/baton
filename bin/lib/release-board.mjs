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
  for (const slice of fs.readdirSync(relDir)) {
    const sliceDir = path.join(relDir, slice);
    if (!fs.statSync(sliceDir).isDirectory()) continue;
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
    ? git(['show', `${rwt}:${RELEASE_DIR_REL}/${rel}/index.md`])
    : null;
  if (fromBranch != null) return fromBranch;
  const wt = path.join(RELEASE_DIR, rel, 'index.md');
  return fs.existsSync(wt) ? fs.readFileSync(wt, 'utf8') : '';
}

// Parsed view of a release's index.md frontmatter `tracks:` block. Returns:
//   sliceTrack — { sliceId: trackId }   ownership map (resolution)
//   trackIds   — Set<trackId>            for the ghost-slice row filter
//   tracks     — [{ id, state, dependsOn:[trackId], slices:[sliceId] }]
//                in frontmatter order, for track-grouped rendering
// The per-slice `track` field in status.json was not backfilled for slices
// planned before track mode, so index.md is the authoritative mapping.
function parseTracks(text) {
  const sliceTrack = {};
  const trackIds = new Set();
  const tracks = [];
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return { sliceTrack, trackIds, tracks };
  let cur = null;
  for (const line of fm[1].split('\n')) {
    const idM = line.match(/^\s*-\s+id:\s*(\S+)/);
    if (idM) {
      cur = { id: idM[1], state: null, dependsOn: [], slices: [] };
      trackIds.add(cur.id);
      tracks.push(cur);
      continue;
    }
    if (!cur) continue;
    const slM = line.match(/^\s*slices:\s*\[(.*)\]/);
    if (slM) {
      for (const s of slM[1].split(',')) {
        const id = s.trim();
        if (id) { cur.slices.push(id); sliceTrack[id] = cur.id; }
      }
      continue;
    }
    const stM = line.match(/^\s*state:\s*(\S+)/);
    if (stM) { cur.state = stM[1]; continue; }
    const dgM = line.match(/^\s*depends_on:\s*(.+)$/);
    if (dgM) {
      const v = dgM[1].trim();
      if (v && v !== 'null') {
        cur.dependsOn = v.replace(/^\[|\]$/g, '').split(',')
          .map(x => x.trim()).filter(Boolean);
      }
    }
  }
  return { sliceTrack, trackIds, tracks };
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
  const releaseDirRel = `${RELEASE_DIR_REL}/${rel}`;
  const idxText = indexText(rel, releaseWtBranches);
  const { sliceTrack, trackIds, tracks } = parseTracks(idxText);

  const trackTrees = {}; // track branch name -> { statuses, specSlices }
  for (const tb of listBranches(`track/${rel}/`)) {
    trackTrees[tb] = readBranchTree(tb, releaseDirRel);
  }
  const rwt = `release-wt/${rel}`;
  const rwtTree = releaseWtBranches.has(rwt)
    ? readBranchTree(rwt, releaseDirRel)
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
    });
    // Index rows may name the slice by directory name or by slice_id field;
    // key both so the planning-record check matches either spelling.
    knownIds.add(id);
    knownIds.add(sliceId);
    stateById[id] = state;
    stateById[sliceId] = state;
  }

  return { rel, slices, specSlices, knownIds, stateById, idxText, trackIds, tracks };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

// The whole release board: every release's resolved slices (each tagged with
// its `track`) and ordered `tracks` metadata, plus planning-record integrity
// warnings (index.md rows that diverge from committed branch reality).
// Shape: { releases: { <rel>: { slices, tracks } }, ghostSlices, pendingSpecs }.
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
    if (r.slices.length) releases[rel] = { slices: r.slices, tracks: r.tracks };

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
