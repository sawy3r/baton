import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const PROMPT_START = 'Install Baton v1.0.0-rc.9 from\n';

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
  const readmePrompt = selfInstallPrompt(readme, 'README.md');
  const installPrompt = selfInstallPrompt(install, 'INSTALL.md');
  assert.equal(readmePrompt, installPrompt);
  assert.match(readmePrompt, /complete no-write preview/);
  assert.match(readmePrompt, /wait for my approval/);
  assert.match(readmePrompt, /Do not guess paths, edit instruction files, or install\nSworn\./);
  assert.match(readmePrompt, /all five Baton skills are discovered/);
});

test('current live surfaces expose only the neutral payload and neutral helper', async () => {
  const paths = [
    '.github/workflows/conformance.yml',
    '.gitignore',
    'README.md',
    'INSTALL.md',
    'RELEASING.md',
    'CONTRIBUTING.md',
    'conformance/check.py',
    'conformance/manifest.json',
    'conformance/README.md',
    'docs/releases/v1.0.0-rc.9.md',
    'scripts/measure-overhead.mjs',
  ];
  for (const path of paths) {
    const contents = await readFile(resolve(ROOT, path), 'utf8');
    assert.doesNotMatch(
      contents,
      /adapters\/generated|generate-adapters|install-(?:claude|codex)\.sh|scripts\/install\.mjs|test\/(?:adapters|install)\/|legacy\/v0\.16\.0|\/tmp-install\/|\.claude\/skills|\.codex\/skills/,
      path,
    );
  }
  await assert.rejects(lstat(resolve(ROOT, '.gitattributes')), { code: 'ENOENT' });

  const install = await readFile(resolve(ROOT, 'INSTALL.md'), 'utf8');
  assert.match(
    install,
    /node scripts\/manage-skills\.mjs install \/absolute\/path\/to\/skills\n```/,
  );
  assert.match(
    install,
    /node scripts\/manage-skills\.mjs install \/absolute\/path\/to\/skills --apply/,
  );
  assert.match(install, /check out that exact immutable release/);
  assert.match(install, /run that release's own safe uninstall preview/);
});
