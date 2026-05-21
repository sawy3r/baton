#!/usr/bin/env node
// release-board-ui.mjs — local release-board dashboard (auto-refreshing HTML).
// Usage: release-board-ui.mjs [--port 3333]
// No dependencies — built-in Node.js only.
//
// All release-board data comes from lib/release-board.mjs, which reads
// committed git refs (track/* + release-wt/* branches). This file is pure
// presentation: HTML render + HTTP server. The CLI oracle
// (release-board-status.sh) reads the same library, so the dashboard and the
// terminal verdict can never disagree.
//
// Run from anywhere inside the target repo. The release-docs root defaults to
// docs/release/; override with the BATON_RELEASE_DIR environment variable.

import http from 'http';
import { readBoard, TERMINAL_STATES } from './lib/release-board.mjs';

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') ?? '3333', 10);

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

const STATE_ORDER = ['planned', 'in_progress', 'implemented', 'failed_verification', 'deferred', 'verified', 'shipped'];

const STATE_COLOUR = {
  verified:             '#22c55e',
  shipped:              '#16a34a',
  deferred:             '#6b7280',
  implemented:          '#f59e0b',
  in_progress:          '#fb923c',
  planned:              '#ef4444',
  failed_verification:  '#dc2626',
  unknown:              '#6b7280',
};

const STATE_LABEL = {
  verified:             'verified',
  shipped:              'shipped',
  deferred:             'deferred',
  implemented:          'implemented — needs verify',
  in_progress:          'in progress',
  planned:              'planned',
  failed_verification:  'failed verification',
  unknown:              'unknown',
};

function stateChip(state) {
  const col = STATE_COLOUR[state] ?? '#6b7280';
  const lbl = STATE_LABEL[state] ?? state;
  return `<span class="chip" style="background:${col}22;color:${col};border:1px solid ${col}44">${lbl}</span>`;
}

// --- track-state presentation -------------------------------------------

const TRACK_STATE_COLOUR = { merged: '#22c55e', in_progress: '#fb923c', planned: '#64748b' };
const TRACK_STATE_LABEL  = { merged: 'merged', in_progress: 'in progress', planned: 'planned' };

function trackStateChip(state) {
  const col = TRACK_STATE_COLOUR[state] ?? '#64748b';
  const lbl = TRACK_STATE_LABEL[state] ?? (state || 'unknown');
  return `<span class="chip" style="background:${col}22;color:${col};border:1px solid ${col}44">${lbl}</span>`;
}

// --- "what's next" command derivation -----------------------------------

// The slash command that advances a slice in a given state. null = terminal.
function sliceCommand(state, sliceId, release) {
  switch (state) {
    case 'planned':
    case 'in_progress':
    case 'failed_verification':
      return `/implement-slice ${sliceId} ${release}`;
    case 'implemented':
      return `/verify-slice ${sliceId} ${release}`;
    default:
      return null; // verified / shipped / deferred
  }
}

// A click-to-copy chip: shows the command verb, copies the full command.
function copyChip(cmd, kind) {
  const verb = cmd.split(' ')[0];
  return `<button class="copy-cmd ${kind}" data-cmd="${cmd}" title="copy: ${cmd}"`
       + ` onclick="copyCmd(event, this)">⧉ ${verb}</button>`;
}

// One slice table. `actionableIds` is the set of slice IDs whose "next"
// command is live right now; every other non-terminal slice shows "blocked".
function sliceTable(arr, release, actionableIds) {
  const rows = arr.map(s => {
    const cmd = sliceCommand(s.state, s.id, release);
    let next = '';
    if (cmd && actionableIds.has(s.id)) next = copyChip(cmd, 'cmd-go');
    else if (!TERMINAL_STATES.has(s.state)) next = '<span class="blocked-mark">blocked</span>';
    return `
        <tr>
          <td class="slice-id">${s.id}</td>
          <td>${stateChip(s.state)}</td>
          <td class="muted">${s.owner}</td>
          <td class="muted">${s.lastUpdated ? s.lastUpdated.slice(0, 10) : ''}</td>
          <td class="next-cell">${next}</td>
        </tr>`;
  }).join('');
  return `<table class="slice-table">
          <thead><tr><th>Slice</th><th>State</th><th>Owner</th><th>Updated</th><th>Next</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
}

function renderPage(releases) {
  let total = 0, terminal = 0;

  // Incomplete releases first so blocked work is visible without scrolling;
  // cleared releases sink to the bottom. Array.sort is stable, so each group
  // keeps readBoard()'s alphabetical order.
  const releaseList = Object.entries(releases).map(([name, { slices, tracks }]) => {
    const t = slices.filter(s => TERMINAL_STATES.has(s.state)).length;
    const n = slices.length;
    total += n;
    terminal += t;
    return { name, slices, tracks: tracks || [], t, n, clear: t === n };
  });
  releaseList.sort((a, b) => Number(a.clear) - Number(b.clear));

  const releaseBlocks = releaseList.map(({ name, slices, tracks, t, n, clear }) => {
    const pct = n === 0 ? 100 : Math.round((t / n) * 100);
    const barCol = clear ? '#22c55e' : pct > 50 ? '#f59e0b' : '#ef4444';
    const short = name.replace(/^\d{4}-\d{2}-\d{2}-/, '');

    const hasTracks = tracks.length > 0;
    const mergedIds = new Set(tracks.filter(tr => tr.state === 'merged').map(tr => tr.id));
    const allMerged = hasTracks && tracks.every(tr => tr.state === 'merged');
    // A release "needs attention" — and so renders expanded — if any slice is
    // non-terminal or any track is still unmerged.
    const needsAttention = !clear || (hasTracks && !allMerged);

    let detail;
    if (hasTracks) {
      const byId = Object.fromEntries(slices.map(s => [s.id, s]));
      const groups = tracks.map(tr => {
        const trSlices = tr.slices.map(id => byId[id]).filter(Boolean);
        if (!trSlices.length) return '';
        const tt = trSlices.filter(s => TERMINAL_STATES.has(s.state)).length;
        const allTerminal = tt === trSlices.length;
        // A track is dependency-blocked while any depends_on track is unmerged.
        const unmet = tr.dependsOn.filter(d => !mergedIds.has(d));
        const depBlocked = unmet.length > 0;
        // Sequential gate: only the first non-terminal slice is actionable —
        // and none are, if the whole track is dependency-blocked.
        const nextSlice = depBlocked ? null : trSlices.find(s => !TERMINAL_STATES.has(s.state));
        const actionableIds = new Set(nextSlice ? [nextSlice.id] : []);
        // A fully-verified, not-yet-merged, unblocked track is ready to merge.
        const trackCmd = (!depBlocked && allTerminal && tr.state !== 'merged')
          ? copyChip(`/merge-track ${tr.id} ${name}`, 'cmd-merge') : '';
        const dep = depBlocked
          ? `<span class="track-dep">needs ${unmet.join(', ')}</span>` : '';
        return `
        <div class="track-group">
          <div class="track-header">
            <span class="track-id">${tr.id}</span>
            ${trackStateChip(tr.state)}
            ${dep}
            <span class="track-count">${tt} / ${trSlices.length}</span>
            ${trackCmd}
          </div>
          ${sliceTable(trSlices, name, actionableIds)}
        </div>`;
      }).filter(Boolean);

      // Slices belonging to no track (e.g. pre-track-mode slices). These are
      // independent — every non-terminal one is actionable.
      const untracked = slices.filter(s => !s.track)
        .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
      if (untracked.length) {
        const ut = untracked.filter(s => TERMINAL_STATES.has(s.state)).length;
        const actionableIds = new Set(
          untracked.filter(s => !TERMINAL_STATES.has(s.state)).map(s => s.id));
        groups.push(`
        <div class="track-group">
          <div class="track-header">
            <span class="track-id track-id-muted">untracked</span>
            <span class="track-count">${ut} / ${untracked.length}</span>
          </div>
          ${sliceTable(untracked, name, actionableIds)}
        </div>`);
      }
      detail = groups.join('\n');
    } else {
      // Pre-track-mode release: flat table, every non-terminal slice actionable.
      const flat = [...slices].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
      const actionableIds = new Set(flat.filter(s => !TERMINAL_STATES.has(s.state)).map(s => s.id));
      detail = sliceTable(flat, name, actionableIds);
    }

    const releaseCmd = allMerged ? copyChip(`/merge-release ${name}`, 'cmd-merge') : '';

    return `
    <div class="release-card ${clear ? 'clear' : 'blocked'}${needsAttention ? ' open' : ''}">
      <div class="release-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="release-left">
          <span class="caret">▶</span>
          <span class="release-name">${short}</span>
        </div>
        <div class="release-right">
          ${releaseCmd}
          <span class="counts">${t} / ${n}</span>
          <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${barCol}"></div></div>
          <span class="verdict ${clear ? 'verdict-clear' : 'verdict-blocked'}">${clear ? '✓ CLEAR' : `${n - t} remaining`}</span>
        </div>
      </div>
      <div class="slice-table-wrap">
        ${detail}
      </div>
    </div>`;
  });

  const remaining = total - terminal;
  const totalPct = total === 0 ? 100 : Math.round((terminal / total) * 100);
  const ready = remaining === 0;
  const now = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20">
<title>Release Board</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --surface2: #21253a;
    --border: #2d3148; --text: #e2e8f0; --muted: #64748b;
    --accent: #6366f1;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: var(--bg); color: var(--text); padding: 32px 24px; min-height: 100vh; }
  h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
  .subtitle { color: var(--muted); font-size: 0.85rem; margin-bottom: 28px; }
  .summary-row { display: flex; align-items: center; gap: 20px; margin-bottom: 28px;
                 background: var(--surface); border: 1px solid var(--border);
                 border-radius: 12px; padding: 20px 24px; }
  .big-num { font-size: 2.5rem; font-weight: 800; line-height: 1; }
  .big-label { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }
  .divider { width: 1px; height: 48px; background: var(--border); }
  .total-bar-wrap { flex: 1; background: var(--surface2); border-radius: 4px; height: 8px; overflow: hidden; }
  .total-bar { height: 100%; border-radius: 4px; transition: width 0.4s; }
  .verdict-badge { font-size: 0.95rem; font-weight: 700; padding: 6px 16px; border-radius: 8px; }
  .verdict-badge.ready    { background: #22c55e22; color: #22c55e; border: 1px solid #22c55e44; }
  .verdict-badge.not-ready{ background: #ef444422; color: #ef4444; border: 1px solid #ef444444; }

  .releases { display: flex; flex-direction: column; gap: 10px; }
  .release-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .release-card.clear { border-color: #22c55e33; }
  .release-header { display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 18px; cursor: pointer; user-select: none;
                    transition: background 0.15s; }
  .release-header:hover { background: var(--surface2); }
  .release-left { display: flex; align-items: center; gap: 10px; }
  .caret { color: var(--muted); font-size: 0.7rem; transition: transform 0.2s; }
  .release-card.open .caret { transform: rotate(90deg); }
  .release-name { font-weight: 600; font-size: 0.95rem; }
  .release-right { display: flex; align-items: center; gap: 14px; }
  .counts { color: var(--muted); font-size: 0.85rem; min-width: 50px; text-align: right; }
  .bar-wrap { width: 120px; background: var(--surface2); border-radius: 4px; height: 6px; overflow: hidden; }
  .bar { height: 100%; border-radius: 4px; transition: width 0.4s; }
  .verdict { font-size: 0.8rem; font-weight: 600; min-width: 100px; text-align: right; }
  .verdict-clear   { color: #22c55e; }
  .verdict-blocked { color: #ef4444; }

  .slice-table-wrap { display: none; border-top: 1px solid var(--border); padding: 0 18px 14px; }
  .release-card.open .slice-table-wrap { display: block; }
  .slice-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 12px; }
  .slice-table th { color: var(--muted); font-weight: 500; text-align: left;
                    padding: 4px 8px 8px; border-bottom: 1px solid var(--border); }
  .slice-table td { padding: 6px 8px; }
  .slice-table tr + tr td { border-top: 1px solid var(--border)18; }
  .slice-id { font-family: 'SF Mono', 'Fira Code', monospace; color: var(--muted); font-size: 0.78rem; }
  .muted { color: var(--muted); }

  .chip { display: inline-block; font-size: 0.75rem; font-weight: 600;
          padding: 2px 8px; border-radius: 99px; letter-spacing: 0.01em; }

  /* track groups */
  .track-group { margin-top: 16px; }
  .track-group:first-child { margin-top: 12px; }
  .track-header { display: flex; align-items: center; gap: 9px;
                  padding: 5px 8px; border-bottom: 1px solid var(--border); }
  .track-id { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8rem;
              font-weight: 600; color: var(--text); }
  .track-id-muted { color: var(--muted); font-weight: 500; }
  .track-dep { font-size: 0.72rem; color: #fb923c; }
  .track-count { margin-left: auto; color: var(--muted); font-size: 0.78rem; }
  .track-group .slice-table { margin-top: 0; }
  .track-group .slice-table th { border-bottom: none; }

  /* what's-next copy chips */
  .copy-cmd { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.72rem;
              font-weight: 600; padding: 3px 9px; border-radius: 6px;
              cursor: pointer; white-space: nowrap; transition: background 0.12s; }
  .copy-cmd.cmd-go    { background: #6366f122; color: #a5b4fc; border: 1px solid #6366f155; }
  .copy-cmd.cmd-go:hover    { background: #6366f138; }
  .copy-cmd.cmd-merge { background: #22c55e1f; color: #4ade80; border: 1px solid #22c55e55; }
  .copy-cmd.cmd-merge:hover { background: #22c55e33; }
  .copy-cmd.copied { background: #22c55e44 !important; color: #bbf7d0 !important; }
  .next-cell { white-space: nowrap; }
  .blocked-mark { font-size: 0.72rem; color: var(--muted); font-style: italic; }

  footer { margin-top: 28px; color: var(--muted); font-size: 0.78rem; text-align: center; }
  a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
<div class="header">
  <h1>Release Board</h1>
</div>
<p class="subtitle">Last updated ${now} &nbsp;·&nbsp; refreshes every 20s &nbsp;·&nbsp; <a href="javascript:location.reload()">refresh now</a></p>

<div class="summary-row">
  <div>
    <div class="big-num" style="color:${ready ? '#22c55e' : '#ef4444'}">${remaining}</div>
    <div class="big-label">slices remaining</div>
  </div>
  <div class="divider"></div>
  <div>
    <div class="big-num">${terminal}</div>
    <div class="big-label">verified</div>
  </div>
  <div class="divider"></div>
  <div style="flex:1">
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:0.8rem;color:var(--muted)">${totalPct}% complete</span>
      <span style="font-size:0.8rem;color:var(--muted)">${total} total</span>
    </div>
    <div class="total-bar-wrap">
      <div class="total-bar" style="width:${totalPct}%;background:${ready ? '#22c55e' : totalPct > 50 ? '#f59e0b' : '#ef4444'}"></div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="verdict-badge ${ready ? 'ready' : 'not-ready'}">${ready ? 'READY TO SHIP' : 'NOT READY'}</div>
</div>

<div class="releases">
${releaseBlocks.join('\n')}
</div>

<footer>
  <code>release-board-status.sh --verbose</code> for terminal view &nbsp;·&nbsp;
  reading <code>release-wt/*</code> + <code>track/*</code> branches via git
</footer>

<script>
// Click-to-copy: writes the full slash command to the clipboard so it can be
// pasted straight into an agent session. localhost is a secure context, so
// navigator.clipboard is available.
function copyCmd(ev, btn) {
  ev.stopPropagation(); // don't toggle the enclosing release card
  navigator.clipboard.writeText(btn.dataset.cmd).then(function () {
    var prev = btn.textContent;
    btn.textContent = '✓ copied';
    btn.classList.add('copied');
    setTimeout(function () {
      btn.textContent = prev;
      btn.classList.remove('copied');
    }, 1200);
  });
}
</script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/favicon.ico') {
    res.writeHead(404); res.end(); return;
  }
  if (req.url === '/favicon.ico') {
    res.writeHead(204); res.end(); return;
  }

  const { releases } = readBoard();
  const html = renderPage(releases);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Release Board  →  http://localhost:${PORT}\n`);
  console.log(`  Reading:  release-wt/* + track/* branches via git`);
  console.log(`  Auto-refreshes every 20s. Ctrl+C to stop.\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} in use. Try: release-board-ui.mjs --port 3334`);
  } else { console.error(err); }
  process.exit(1);
});
