import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { TextDecoder } from 'node:util';

import { parsePlanBytes } from '../../reference/records/records.mjs';

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
      new RegExp(`^---\\noperation: ${name}\\nversion: baton\\.operation/v1\\n---\\n`),
    );
    const observedHeadings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(observedHeadings, HEADINGS, `${name} heading contract`);
    const count = words(text);
    assert.ok(count <= 400, `${name} has ${count} words`);
    total += count;
  }
  assert.ok(total <= 2_000, `all operations have ${total} words`);
});

test('canonical operation prose is tool-neutral and excludes retired workflow', async () => {
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
  ]) {
    assert.doesNotMatch(combined, forbidden);
  }
});

test('operations name the composed B1 actions, outcomes, and handoffs', async () => {
  const byName = Object.fromEntries(await Promise.all(OPERATION_NAMES.map(async (name) => [
    name,
    await readFile(join(ROOT, 'operations', `${name}.md`), 'utf8'),
  ])));
  assert.match(byName['baton-plan'], /installApprovedPlan/);
  assert.match(byName['baton-plan'], /reboundPristinePlan/);
  assert.match(byName['baton-implement'], /materializeTrack/);
  assert.match(byName['baton-implement'], /DESIGN_WRITTEN/);
  assert.match(byName['baton-implement'], /IMPLEMENTED/);
  for (const result of ['PROCEED', 'REVISE', 'ESCALATE']) {
    assert.match(byName['baton-design-review'], new RegExp(`\`${result}\``));
  }
  for (const result of ['PASS', 'FAIL', 'BLOCKED']) {
    assert.match(byName['baton-verify'], new RegExp(`\`${result}\``));
  }
  assert.match(byName['baton-verify'], /`NO_VERDICT`/);
  assert.match(byName['baton-merge'], /composeTrack/);
  assert.match(byName['baton-merge'], /prepareAssembly/);
  assert.match(byName['baton-merge'], /integrateRelease/);
});

test('exactly three concise templates exist and the plan starts with valid strict metadata', async () => {
  assert.deepEqual(
    (await readdir(join(ROOT, 'templates'))).sort(),
    ['design.md', 'plan.md', 'proof.md'],
  );
  const planBytes = await readFile(join(ROOT, 'templates', 'plan.md'));
  assert.equal(planBytes.indexOf(Buffer.from('```baton-plan-v1\n')), 0);
  const parsed = parsePlanBytes(planBytes);
  assert.equal(parsed.metadata.schema_version, 'baton.plan/v1');
  assert.equal(parsed.metadata.tracks.length, 1);
  for (const name of ['plan.md', 'design.md', 'proof.md']) {
    const text = await readFile(join(ROOT, 'templates', name), 'utf8');
    assert.ok(words(text) <= 300, `${name} stays concise`);
  }
});
