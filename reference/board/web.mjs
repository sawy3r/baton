#!/usr/bin/env node

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  boardBytes,
  projectBoard,
} from './oracle.mjs';

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Baton release board</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <header class="masthead">
    <a class="skip-link" href="#board">Skip to board</a>
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <p class="eyebrow">Durable delivery truth</p>
        <p class="wordmark">Baton</p>
      </div>
    </div>
    <p id="freshness" class="freshness" role="status" aria-live="polite">Connecting</p>
  </header>
  <main id="board" class="board" tabindex="-1">
    <section class="loading" aria-labelledby="loading-title">
      <p class="eyebrow">Local release board</p>
      <h1 id="loading-title">Reading committed state</h1>
      <p>The board follows release and track refs, never whichever worktree happens to be open.</p>
    </section>
  </main>
  <footer class="footer">
    <p>Read-only. Refreshed from committed Baton records.</p>
  </footer>
</body>
</html>
`;

const APP_JS = `'use strict';

const boardRoot = document.getElementById('board');
const freshness = document.getElementById('freshness');
let lastBoard = null;

function text(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback || '—';
  return String(value);
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = text(value);
  return node;
}

function stateClass(value) {
  const safe = String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return 'state state--' + (safe || 'unknown');
}

function statePill(value) {
  return element('span', stateClass(value), text(value));
}

function labelledValue(label, value, mono) {
  const item = element('div', 'fact');
  item.append(element('dt', 'fact-label', label));
  item.append(element('dd', mono ? 'fact-value mono' : 'fact-value', text(value)));
  return item;
}

function operationIdentity(operation) {
  return [operation.release, operation.track, operation.work]
    .filter(function (value) { return value !== null; })
    .map(function (value) { return text(value); })
    .join(' / ');
}

function operationCard(operation) {
  const card = element('article', 'operation');
  const lead = element('div', 'operation-lead');
  lead.append(element('span', 'operation-name mono', operation.operation));
  lead.append(element('span', 'operation-scope', operation.scope));
  card.append(lead);
  card.append(element('p', 'operation-target mono', operationIdentity(operation)));
  return card;
}

function blockerBlock(blocker) {
  const block = element('div', 'blocker');
  block.append(element('p', 'blocker-code mono', blocker.code));
  block.append(element('p', 'blocker-summary', blocker.summary));
  return block;
}

function sourceLine(source) {
  const row = element('p', 'source mono');
  row.append(element('span', 'source-mode', text(source.mode)));
  row.append(document.createTextNode('  ' + text(source.ref) + ' @ ' + text(source.head)));
  return row;
}

function workCard(work) {
  const card = element('article', 'work');
  const heading = element('div', 'work-heading');
  heading.append(element('h4', 'work-id mono', work.id));
  heading.append(statePill(work.status));
  card.append(heading);

  const lifecycle = element('p', 'lifecycle');
  lifecycle.append(element('span', 'lifecycle-stage', text(work.stage)));
  lifecycle.append(document.createTextNode(' → '));
  lifecycle.append(element('span', 'lifecycle-role', text(work.next_role)));
  lifecycle.append(element('span', 'outcome', 'outcome ' + text(work.outcome)));
  card.append(lifecycle);
  card.append(sourceLine(work.source));

  if (Array.isArray(work.depends_on) && work.depends_on.length > 0) {
    card.append(element('p', 'dependency mono', 'after ' + work.depends_on.join(', ')));
  }
  if (work.blocker) card.append(blockerBlock(work.blocker));
  if (work.next_operation) {
    const next = element('div', 'next-inline');
    next.append(element('span', 'next-label', 'Next'));
    next.append(element('span', 'mono', work.next_operation.operation));
    card.append(next);
  }
  return card;
}

function trackLane(track) {
  const lane = element('section', 'track');
  const rail = element('div', 'rail');
  rail.setAttribute('aria-hidden', 'true');
  lane.append(rail);

  const content = element('div', 'track-content');
  const heading = element('header', 'track-heading');
  const title = element('div');
  title.append(element('p', 'eyebrow', 'Track'));
  title.append(element('h3', 'track-id mono', track.id));
  heading.append(title);
  heading.append(statePill(track.composition));
  content.append(heading);

  const facts = element('dl', 'track-facts');
  facts.append(labelledValue('Authority', track.materialisation));
  facts.append(labelledValue('Ref', track.ref, true));
  facts.append(labelledValue('Head', track.head, true));
  if (track.frozen_head) facts.append(labelledValue('Frozen', track.frozen_head, true));
  content.append(facts);

  if (Array.isArray(track.depends_on) && track.depends_on.length > 0) {
    content.append(element('p', 'dependency mono', 'depends on ' + track.depends_on.join(', ')));
  }
  if (Array.isArray(track.blockers) && track.blockers.length > 0) {
    content.append(element('p', 'track-waiting mono', 'waiting for ' + track.blockers.join(', ')));
  }

  const workList = element('div', 'work-list');
  (track.work || []).forEach(function (work) { workList.append(workCard(work)); });
  content.append(workList);
  if (track.next_operation && track.next_operation.scope !== 'work') {
    const next = element('div', 'track-next');
    next.append(element('p', 'eyebrow', 'Next handoff'));
    next.append(operationCard(track.next_operation));
    content.append(next);
  }
  lane.append(content);
  return lane;
}

function assemblyCard(assembly) {
  const section = element('section', 'assembly');
  const heading = element('header', 'assembly-heading');
  const title = element('div');
  title.append(element('p', 'eyebrow', 'Final gate'));
  title.append(element('h3', 'assembly-title', 'Assembly'));
  heading.append(title);
  heading.append(statePill(assembly ? assembly.status : 'invalid'));
  section.append(heading);
  if (!assembly) {
    section.append(element('p', 'empty-copy', 'Assembly state is unavailable.'));
    return section;
  }
  const lifecycle = element('p', 'lifecycle');
  lifecycle.append(element('span', 'lifecycle-stage', text(assembly.stage)));
  lifecycle.append(document.createTextNode(' → '));
  lifecycle.append(element('span', 'lifecycle-role', text(assembly.next_role)));
  lifecycle.append(element('span', 'outcome', 'outcome ' + text(assembly.outcome)));
  section.append(lifecycle);
  if (assembly.source) section.append(sourceLine(assembly.source));
  if (assembly.blocker) section.append(blockerBlock(assembly.blocker));
  if (assembly.next_operation) {
    const next = element('div', 'track-next');
    next.append(element('p', 'eyebrow', 'Next handoff'));
    next.append(operationCard(assembly.next_operation));
    section.append(next);
  }
  return section;
}

function diagnosticCard(item) {
  const card = element('article', 'diagnostic');
  const head = element('div', 'diagnostic-heading');
  head.append(element('span', 'diagnostic-mark', '!'));
  head.append(element('p', 'diagnostic-code mono', item.code));
  card.append(head);
  const scope = [item.release, item.track, item.work]
    .filter(function (value) { return value !== null; })
    .join(' / ');
  if (scope) card.append(element('p', 'diagnostic-scope mono', scope));
  card.append(element('p', 'diagnostic-message', item.message));
  return card;
}

function releaseSection(release) {
  const section = element('section', 'release');
  const header = element('header', 'release-heading');
  const title = element('div', 'release-title');
  title.append(element('p', 'eyebrow', 'Release'));
  title.append(element('h2', 'release-name', release.release));
  header.append(title);
  header.append(statePill(release.status));
  section.append(header);

  const facts = element('dl', 'release-facts');
  facts.append(labelledValue('Plan', release.plan_digest, true));
  facts.append(labelledValue('Release ref', release.release_ref, true));
  facts.append(labelledValue('Release head', release.release_head, true));
  facts.append(labelledValue('Target ref', release.target_ref, true));
  facts.append(labelledValue('Target head', release.target_head, true));
  section.append(facts);

  if (Array.isArray(release.diagnostics) && release.diagnostics.length > 0) {
    const diagnostics = element('div', 'diagnostics');
    release.diagnostics.forEach(function (item) { diagnostics.append(diagnosticCard(item)); });
    section.append(diagnostics);
  }

  const tracks = element('div', 'tracks');
  (release.tracks || []).forEach(function (track) { tracks.append(trackLane(track)); });
  section.append(tracks);
  section.append(assemblyCard(release.assembly));
  return section;
}

function render(board) {
  const fragment = document.createDocumentFragment();
  const intro = element('section', 'intro');
  const copy = element('div');
  copy.append(element('p', 'eyebrow', 'Committed state · exact refs'));
  copy.append(element('h1', 'intro-title', board.repository || 'No active release'));
  copy.append(element(
    'p',
    'intro-copy',
    board.valid
      ? 'Every lane below comes from immutable Baton records and captured Git heads.'
      : 'At least one release cannot be trusted. Its diagnostics are shown without partial progress claims.'
  ));
  intro.append(copy);
  intro.append(statePill(board.valid ? 'valid' : 'invalid'));
  fragment.append(intro);

  if (Array.isArray(board.diagnostics) && board.diagnostics.length > 0) {
    const diagnostics = element('section', 'diagnostics global-diagnostics');
    diagnostics.append(element('h2', 'section-title', 'Board diagnostics'));
    board.diagnostics.forEach(function (item) { diagnostics.append(diagnosticCard(item)); });
    fragment.append(diagnostics);
  }

  if (!Array.isArray(board.releases) || board.releases.length === 0) {
    const empty = element('section', 'empty');
    empty.append(element('p', 'eyebrow', 'Nothing queued'));
    empty.append(element('h2', 'section-title', 'No local release refs'));
    empty.append(element('p', 'empty-copy', 'Create an approved refs/heads/release-wt/* release to populate this board.'));
    fragment.append(empty);
  } else {
    board.releases.forEach(function (release) { fragment.append(releaseSection(release)); });
  }

  if (Array.isArray(board.next_operations) && board.next_operations.length > 0) {
    const queue = element('section', 'queue');
    const heading = element('div', 'queue-heading');
    heading.append(element('p', 'eyebrow', 'Independently actionable'));
    heading.append(element('h2', 'section-title', 'Next handoffs'));
    queue.append(heading);
    const operations = element('div', 'operation-grid');
    board.next_operations.forEach(function (operation) { operations.append(operationCard(operation)); });
    queue.append(operations);
    fragment.append(queue);
  }
  boardRoot.replaceChildren(fragment);
}

function markFresh() {
  freshness.className = 'freshness freshness--fresh';
  freshness.textContent = 'Committed state · current';
}

function markStale() {
  freshness.className = 'freshness freshness--stale';
  freshness.textContent = lastBoard
    ? 'Refresh failed · showing last committed view'
    : 'Board unavailable · retrying';
}

async function refresh() {
  try {
    const response = await fetch('/api/board', {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('board refresh failed');
    const board = await response.json();
    if (!board || board.schema_version !== 'baton.board/v1') {
      throw new Error('unexpected board contract');
    }
    lastBoard = board;
    render(board);
    markFresh();
  } catch (error) {
    markStale();
  }
}

refresh();
window.setInterval(refresh, 15000);
`;

const CSS = `:root {
  color-scheme: light;
  --ink: #17233b;
  --ink-soft: #4f5b70;
  --mist: #e9eff2;
  --paper: #f7f9fa;
  --white: #ffffff;
  --rail: #9aabb5;
  --brass: #b97918;
  --brass-soft: #f4e7ce;
  --teal: #176f64;
  --teal-soft: #dceeea;
  --red: #a43d47;
  --red-soft: #f5e1e3;
  --blue: #315d82;
  --blue-soft: #e0eaf2;
  --shadow: 0 20px 50px rgba(23, 35, 59, 0.09);
  font-family: Inter, Aptos, "Segoe UI", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--mist);
  color: var(--ink);
}

body {
  margin: 0;
  min-width: 320px;
  background:
    linear-gradient(90deg, rgba(49, 93, 130, 0.045) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(rgba(49, 93, 130, 0.045) 1px, transparent 1px) 0 0 / 40px 40px,
    var(--mist);
}

.skip-link {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 10;
  padding: 0.65rem 0.9rem;
  background: var(--ink);
  color: var(--white);
  transform: translateY(-180%);
}

.skip-link:focus {
  transform: translateY(0);
}

.masthead {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 74px;
  padding: 0.8rem clamp(1rem, 4vw, 4rem);
  border-bottom: 1px solid rgba(23, 35, 59, 0.16);
  background: rgba(247, 249, 250, 0.94);
  backdrop-filter: blur(14px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.brand-mark {
  position: relative;
  display: block;
  width: 12px;
  height: 42px;
  border-radius: 999px;
  background: var(--brass);
  box-shadow: inset 0 -8px 0 var(--ink);
}

.brand-mark::after {
  position: absolute;
  top: 7px;
  left: -5px;
  width: 22px;
  height: 3px;
  border-radius: 999px;
  background: var(--ink);
  content: "";
}

.eyebrow {
  margin: 0 0 0.25rem;
  color: var(--ink-soft);
  font-family: ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.wordmark {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.freshness {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--rail);
  border-radius: 999px;
  background: var(--white);
  color: var(--ink-soft);
  font-size: 0.74rem;
  font-weight: 700;
}

.freshness--fresh {
  border-color: var(--teal);
  color: var(--teal);
}

.freshness--stale {
  border-color: var(--red);
  background: var(--red-soft);
  color: var(--red);
}

.board {
  width: min(1440px, 100%);
  margin: 0 auto;
  padding: clamp(1.2rem, 4vw, 4rem);
  outline: none;
}

.intro,
.release-heading,
.track-heading,
.assembly-heading,
.queue-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.intro {
  margin-bottom: clamp(1.5rem, 4vw, 3rem);
  padding: clamp(1.4rem, 4vw, 3.2rem);
  border-left: 8px solid var(--brass);
  background: var(--ink);
  color: var(--white);
  box-shadow: var(--shadow);
}

.intro .eyebrow {
  color: #b9c8d3;
}

.intro-title {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2rem, 6vw, 5rem);
  line-height: 0.98;
  letter-spacing: -0.055em;
  overflow-wrap: anywhere;
}

.intro-copy {
  max-width: 62ch;
  margin: 1rem 0 0;
  color: #d9e1e6;
  line-height: 1.6;
}

.release {
  margin: 0 0 2rem;
  padding: clamp(1.2rem, 3vw, 2.25rem);
  border: 1px solid rgba(23, 35, 59, 0.17);
  background: var(--paper);
  box-shadow: var(--shadow);
}

.release-name,
.section-title,
.assembly-title {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.55rem, 3vw, 2.4rem);
  letter-spacing: -0.035em;
}

.state {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 28px;
  padding: 0.34rem 0.6rem;
  border: 1px solid var(--blue);
  border-radius: 999px;
  background: var(--blue-soft);
  color: var(--blue);
  font-family: ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 0.69rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.state--complete,
.state--composed,
.state--valid {
  border-color: var(--teal);
  background: var(--teal-soft);
  color: var(--teal);
}

.state--ready,
.state--merge_ready,
.state--assembly_ready {
  border-color: var(--brass);
  background: var(--brass-soft);
  color: #7b4a00;
}

.state--invalid,
.state--blocked {
  border-color: var(--red);
  background: var(--red-soft);
  color: var(--red);
}

.release-facts,
.track-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 1.5rem 0 0;
  background: rgba(23, 35, 59, 0.13);
}

.fact {
  min-width: 0;
  padding: 0.8rem;
  background: var(--white);
}

.release-facts .fact:last-child:nth-child(odd),
.track-facts .fact:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.fact-label {
  margin-bottom: 0.35rem;
  color: var(--ink-soft);
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.fact-value {
  margin: 0;
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
}

.tracks {
  margin-top: 2rem;
}

.track {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 0.8rem;
}

.track + .track {
  margin-top: 1rem;
}

.rail {
  position: relative;
  min-height: 100%;
}

.rail::before {
  position: absolute;
  top: 0;
  bottom: -1rem;
  left: 14px;
  width: 3px;
  background: var(--rail);
  content: "";
}

.rail::after {
  position: absolute;
  top: 1.1rem;
  left: 8px;
  width: 11px;
  height: 28px;
  border: 3px solid var(--paper);
  border-radius: 999px;
  background: var(--brass);
  box-shadow: 0 0 0 2px var(--rail);
  content: "";
}

.track-content {
  min-width: 0;
  padding: 1.25rem;
  border: 1px solid rgba(23, 35, 59, 0.13);
  background: var(--white);
}

.track-id {
  margin: 0;
  font-size: 1.15rem;
}

.track-facts {
  margin-top: 1rem;
}

.dependency,
.track-waiting {
  margin: 0.8rem 0 0;
  color: var(--ink-soft);
}

.track-waiting {
  color: var(--red);
  font-weight: 700;
}

.work-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.8rem;
  margin-top: 1rem;
}

.work {
  min-width: 0;
  padding: 1rem;
  border-top: 3px solid var(--blue);
  background: var(--paper);
}

.work-heading,
.operation-lead,
.diagnostic-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}

.work-id {
  margin: 0;
  font-size: 0.9rem;
}

.lifecycle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.9rem 0 0;
  font-size: 0.84rem;
}

.lifecycle-stage {
  font-weight: 800;
}

.lifecycle-role {
  color: var(--blue);
  font-weight: 800;
}

.outcome {
  margin-left: auto;
  color: var(--ink-soft);
  font-size: 0.72rem;
}

.source {
  margin: 0.75rem 0 0;
  color: var(--ink-soft);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.source-mode {
  color: var(--ink);
  font-weight: 800;
}

.next-inline,
.track-next {
  margin-top: 0.8rem;
}

.next-inline {
  display: flex;
  gap: 0.55rem;
  padding-top: 0.7rem;
  border-top: 1px solid rgba(23, 35, 59, 0.12);
}

.next-label {
  color: #7b4a00;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.assembly,
.queue,
.empty,
.loading,
.diagnostics {
  margin-top: 1.5rem;
  padding: 1.25rem;
  border: 1px solid rgba(23, 35, 59, 0.14);
  background: var(--white);
}

.assembly {
  margin-left: 44px;
  border-top: 5px solid var(--ink);
}

.operation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.7rem;
  margin-top: 1rem;
}

.operation {
  padding: 0.85rem;
  border-left: 4px solid var(--brass);
  background: var(--brass-soft);
}

.operation-name {
  color: #6b4000;
  font-weight: 850;
}

.operation-scope {
  color: #6b4000;
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
}

.operation-target {
  margin: 0.5rem 0 0;
  overflow-wrap: anywhere;
}

.blocker,
.diagnostic {
  margin-top: 0.8rem;
  padding: 0.85rem;
  border-left: 4px solid var(--red);
  background: var(--red-soft);
}

.blocker-code,
.blocker-summary,
.diagnostic-code,
.diagnostic-scope,
.diagnostic-message {
  margin: 0;
}

.blocker-code,
.diagnostic-code {
  color: var(--red);
  font-weight: 850;
}

.blocker-summary,
.diagnostic-message {
  margin-top: 0.4rem;
  line-height: 1.45;
}

.diagnostic-mark {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 50%;
  background: var(--red);
  color: var(--white);
  font-weight: 900;
}

.diagnostic-heading {
  justify-content: flex-start;
}

.diagnostic-scope {
  margin-top: 0.55rem;
  color: var(--ink-soft);
}

.global-diagnostics {
  margin-bottom: 1.5rem;
}

.empty-copy {
  max-width: 62ch;
  color: var(--ink-soft);
  line-height: 1.55;
}

.footer {
  padding: 1rem clamp(1rem, 4vw, 4rem) 2rem;
  color: var(--ink-soft);
  font-size: 0.75rem;
  text-align: center;
}

:focus-visible {
  outline: 3px solid var(--brass);
  outline-offset: 3px;
}

@media (max-width: 700px) {
  .masthead {
    align-items: flex-start;
  }

  .freshness {
    max-width: 48%;
    border-radius: 4px;
    text-align: right;
  }

  .intro,
  .release-heading,
  .track-heading,
  .assembly-heading {
    flex-direction: column;
  }

  .release-facts,
  .track-facts {
    grid-template-columns: 1fr;
  }

  .track {
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 0.4rem;
  }

  .rail::before {
    left: 7px;
  }

  .rail::after {
    left: 1px;
  }

  .assembly {
    margin-left: 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto;
  }
}
`;

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

const STATIC_ROUTES = Object.freeze({
  '/': Object.freeze({
    status: 200,
    type: 'text/html; charset=utf-8',
    body: Buffer.from(HTML),
  }),
  '/app.js': Object.freeze({
    status: 200,
    type: 'text/javascript; charset=utf-8',
    body: Buffer.from(APP_JS),
  }),
  '/style.css': Object.freeze({
    status: 200,
    type: 'text/css; charset=utf-8',
    body: Buffer.from(CSS),
  }),
});

function validateHost(host) {
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new TypeError('board host must be exactly 127.0.0.1 or ::1');
  }
  return host;
}

function validatePort(port) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError('board port must be an integer from 0 to 65535');
  }
  return port;
}

function exactRequestHost(host, port) {
  return host === '::1' ? `[::1]:${port}` : `${host}:${port}`;
}

function send(response, status, type, body, extraHeaders = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    'Content-Length': bytes.byteLength,
    'Content-Type': type,
  });
  response.end(bytes);
}

function errorBody(status, code) {
  return Buffer.from(`${JSON.stringify({ status, code })}\n`);
}

export function createBoardServer({
  repo = process.cwd(),
  host = '127.0.0.1',
  project = projectBoard,
} = {}) {
  validateHost(host);
  if (typeof project !== 'function') throw new TypeError('board projector must be a function');
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      send(
        response,
        405,
        'application/json; charset=utf-8',
        errorBody(405, 'METHOD_NOT_ALLOWED'),
        { Allow: 'GET' },
      );
      return;
    }
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    if (port === null || request.headers.host !== exactRequestHost(host, port)) {
      send(
        response,
        421,
        'application/json; charset=utf-8',
        errorBody(421, 'MISDIRECTED_REQUEST'),
      );
      return;
    }
    const route = request.url;
    if (
      typeof route !== 'string'
      || route.includes('?')
      || route.includes('#')
      || route.includes('%')
    ) {
      send(response, 404, 'application/json; charset=utf-8', errorBody(404, 'NOT_FOUND'));
      return;
    }
    if (route === '/favicon.ico') {
      response.writeHead(204, SECURITY_HEADERS);
      response.end();
      return;
    }
    if (route === '/api/board') {
      try {
        send(
          response,
          200,
          'application/json; charset=utf-8',
          boardBytes(project(repo)),
        );
      } catch {
        send(
          response,
          503,
          'application/json; charset=utf-8',
          errorBody(503, 'BOARD_UNAVAILABLE'),
        );
      }
      return;
    }
    const staticRoute = STATIC_ROUTES[route];
    if (!staticRoute) {
      send(response, 404, 'application/json; charset=utf-8', errorBody(404, 'NOT_FOUND'));
      return;
    }
    send(response, staticRoute.status, staticRoute.type, staticRoute.body);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export function startBoardServer({
  repo = process.cwd(),
  host = '127.0.0.1',
  port = 4177,
  project = projectBoard,
} = {}) {
  validateHost(host);
  validatePort(port);
  const server = createBoardServer({ repo, host, project });
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const actualPort = address.port;
      resolve(Object.freeze({
        server,
        host,
        port: actualPort,
        url: `http://${exactRequestHost(host, actualPort)}`,
        close() {
          return new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          });
        },
      }));
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function usage() {
  return [
    'Usage: node reference/board/web.mjs [--host 127.0.0.1|::1] [--port 0..65535] [repository]',
    '',
  ].join('\n');
}

async function main(argv) {
  let host = '127.0.0.1';
  let port = 4177;
  let repo = process.cwd();
  let sawRepo = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--host' && index + 1 < argv.length) {
      host = argv[++index];
    } else if (value === '--port' && index + 1 < argv.length) {
      port = Number(argv[++index]);
    } else if (!value.startsWith('-') && !sawRepo) {
      repo = value;
      sawRepo = true;
    } else {
      process.stderr.write(usage());
      process.exitCode = 64;
      return;
    }
  }
  try {
    const running = await startBoardServer({ repo, host, port });
    process.stdout.write(`${running.url}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? 'board server failed'}\n`);
    process.exitCode = error instanceof TypeError ? 64 : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
