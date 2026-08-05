import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const PROMPT_START = 'Install Baton v1.0.0-rc.15.3 from\n';
const LIVE_DOCS = [
  'README.md',
  'INSTALL.md',
  'RELEASING.md',
  'ROADMAP.md',
  'CONTRIBUTING.md',
  'conformance/README.md',
  'conformance/manifest.json',
  'docs/releases/v1.0.0-rc.14.md',
  'docs/releases/v1.0.0-rc.15.md',
  'docs/releases/v1.0.0-rc.15.1.md',
  'docs/releases/v1.0.0-rc.15.2.md',
  'docs/releases/v1.0.0-rc.15.3.md',
];

function selfInstallPrompt(document, path) {
  const blocks = [...document.matchAll(/```text\n([\s\S]*?)\n```/g)]
    .map((match) => match[1])
    .filter((block) => block.startsWith(PROMPT_START));
  assert.equal(blocks.length, 1, path);
  return blocks[0];
}

test('README and INSTALL carry one identical concise self-install prompt', async () => {
  const readme = await readFile(resolve(ROOT, 'README.md'), 'utf8');
  const install = await readFile(resolve(ROOT, 'INSTALL.md'), 'utf8');
  const prompt = selfInstallPrompt(readme, 'README.md');
  assert.equal(prompt, selfInstallPrompt(install, 'INSTALL.md'));
  assert.match(prompt, /complete no-write preview/);
  assert.match(prompt, /wait for my approval/);
  assert.match(prompt, /all five Baton skills are discovered/);
});

test('the live product has no client-specific or generic installer helper', async () => {
  const executableInstallers = [
    ...await readdir(ROOT),
    ...await readdir(resolve(ROOT, 'scripts')),
  ].filter((name) => /^(?:install|manage).*?(?:skills?)?\.(?:mjs|sh)$/i.test(name));
  assert.deepEqual(executableInstallers, []);
  for (const path of LIVE_DOCS) {
    const contents = await readFile(resolve(ROOT, path), 'utf8');
    assert.doesNotMatch(
      contents,
      /scripts\/manage-skills|\.claude\/skills|\.codex\/skills|client selector|client path table/,
      path,
    );
  }
});

test('the contract binds approval and fails closed on changed or partial state', async () => {
  const install = (await readFile(resolve(ROOT, 'INSTALL.md'), 'utf8'))
    .replace(/\s+/g, ' ');
  for (const required of [
    'exact release and commit',
    'payload digest',
    'canonical destination',
    'complete relative-path change set',
    'observed destination state',
    'immediately before any effect',
    'if anything changed, stop and show a new preview',
    'incomplete exact payload is never adopted as installed or removed automatically',
    'complete expected path set is byte-identical',
    'no missing, extra, symlink, or special entries',
    "exact immutable release's own safe uninstall",
    'separately approved operations',
    'After interruption or change',
  ]) {
    assert.match(install, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('RC15.3 package metadata, payload note, and retained RC15 history agree', async () => {
  const version = (await readFile(resolve(ROOT, 'VERSION'), 'utf8')).trim();
  const manifest = JSON.parse(
    await readFile(resolve(ROOT, 'conformance/manifest.json'), 'utf8'),
  );
  const payload = JSON.parse(
    await readFile(resolve(ROOT, 'skills/.baton-payload.json'), 'utf8'),
  );
  const roadmap = await readFile(resolve(ROOT, 'ROADMAP.md'), 'utf8');
  const release = await readFile(resolve(ROOT, 'docs/releases/v1.0.0-rc.15.3.md'), 'utf8');
  const retained = await readFile(resolve(ROOT, 'docs/releases/v1.0.0-rc.15.md'), 'utf8');

  assert.equal(version, '1.0.0-rc.15.3');
  assert.equal(manifest.baton_version, version);
  assert.equal(payload.package_version, version);
  assert.match(roadmap, /## RC15 — make the plan clear before code starts/);
  assert.match(release, new RegExp(payload.payload_digest));
  assert.match(retained, /^# Baton v1\.0\.0-rc\.15 — compact semantic planning/m);
});
