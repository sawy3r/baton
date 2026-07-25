import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { TextDecoder } from 'node:util';

const ROOT = resolve(import.meta.dirname, '../..');
const OPERATION_NAMES = [
  'baton-plan',
  'baton-implement',
  'baton-design-review',
  'baton-verify',
  'baton-merge',
];
const HEADINGS = [
  'Purpose',
  'Inputs',
  'Authority',
  'Actions',
  'Required output',
  'Stop conditions',
  'Next handoff',
];

function words(text) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

test('exactly five canonical operations obey byte, heading, and word contracts', async () => {
  const observed = (await readdir(join(ROOT, 'operations')))
    .filter((path) => path.endsWith('.md'))
    .sort();
  assert.deepEqual(observed, OPERATION_NAMES.map((name) => `${name}.md`).sort());

  let total = 0;
  for (const name of OPERATION_NAMES) {
    const bytes = await readFile(join(ROOT, 'operations', `${name}.md`));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert.equal(text.includes('\r'), false, `${name} must use LF`);
    assert.equal(text.endsWith('\n'), true, `${name} needs a final newline`);
    assert.match(
      text,
      new RegExp(`^---\\noperation: ${name}\\nversion: baton\\.operation/v2\\n---\\n`),
    );
    const observedHeadings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(observedHeadings, HEADINGS, `${name} heading contract`);
    const count = words(text);
    assert.ok(count <= 350, `${name} has ${count} words`);
    total += count;
  }
  assert.ok(total <= 1_700, `all operations have ${total} words`);
});

test('canonical operation prose is tool-neutral and excludes retired machinery', async () => {
  const combined = (
    await Promise.all(OPERATION_NAMES.map((name) => (
      readFile(join(ROOT, 'operations', `${name}.md`), 'utf8')
    )))
  ).join('\n');
  for (const forbidden of [
    /\bclaude\b/i,
    /\bcodex\b/i,
    /\bprovider\b/i,
    /\bmodel\b/i,
    /\bhost\b/i,
    /\bhome directory\b/i,
    /\bmemory product\b/i,
    /\bAskUserQuestion\b/i,
    /\$[1-9]\b/,
    /\bmark-shipped\b/i,
    /\b(?:design\.md|proof\.md|status\.json)\b/i,
    /\b(?:recordTransition|materializeTrack|reboundPristinePlan)\b/,
  ]) {
    assert.doesNotMatch(combined, forbidden);
  }
});

test('operations return trust decisions and evidence for machine-written receipts', async () => {
  const byName = Object.fromEntries(await Promise.all(OPERATION_NAMES.map(async (name) => [
    name,
    await readFile(join(ROOT, 'operations', `${name}.md`), 'utf8'),
  ])));
  assert.match(byName['baton-plan'], /forward-only revision/);
  assert.match(byName['baton-plan'], /stable slice identities/);
  assert.match(byName['baton-implement'], /design\s+TL;DR/);
  assert.match(byName['baton-implement'], /implementation\s+attempt/);
  for (const result of ['PROCEED', 'REVISE', 'ESCALATE']) {
    assert.match(byName['baton-design-review'], new RegExp(`\`${result}\``));
  }
  for (const result of ['PASS', 'FAIL', 'BLOCKED']) {
    assert.match(byName['baton-verify'], new RegExp(`\`${result}\``));
  }
  assert.match(byName['baton-verify'], /operational failure/);
  assert.match(byName['baton-merge'], /exact retry/);
  for (const text of Object.values(byName)) assert.match(text, /receipt/i);
});

test('the only required template is one concise stable-slice plan', async () => {
  assert.deepEqual((await readdir(join(ROOT, 'templates'))).sort(), ['plan.md']);
  const bytes = await readFile(join(ROOT, 'templates', 'plan.md'));
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.equal(text.indexOf('```baton-plan-v2\n'), 0);
  const fenced = text.match(/^```baton-plan-v2\n([\s\S]*?)\n```\n/);
  assert.ok(fenced, 'plan template starts with one v2 JSON block');
  const metadata = JSON.parse(fenced[1]);
  assert.equal(metadata.schema_version, 'baton.plan/v2');
  assert.equal(metadata.revision, 1);
  assert.equal(metadata.tracks[0].slices[0].id, 'S1');
  assert.deepEqual(metadata.tracks[0].slices[0].consumes, []);
  assert.ok(words(text) <= 300, 'plan template stays concise');
});
