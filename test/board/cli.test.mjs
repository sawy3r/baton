import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { baselineFixture } from './helpers.mjs';

const ORACLE = fileURLToPath(
  new URL('../../reference/board/oracle.mjs', import.meta.url),
);
const TERMINAL = fileURLToPath(
  new URL('../../reference/board/terminal.mjs', import.meta.url),
);
const BOARD_FIXTURE = readFileSync(
  new URL('../../conformance/fixtures/board/valid-incomplete-board.json', import.meta.url),
);
const TERMINAL_GOLDEN = readFileSync(
  new URL('../../conformance/fixtures/board/terminal-golden.txt', import.meta.url),
  'utf8',
);

function invoke(file, args = [], input = '') {
  return spawnSync(process.execPath, [file, ...args], {
    encoding: 'utf8',
    input,
  });
}

test('oracle CLI uses 0, 2, and 64 for valid, invalid-state, and invocation results', () => {
  const fixture = baselineFixture();
  const nonRepository = mkdtempSync(path.join(tmpdir(), 'baton-cli-non-repo-'));
  try {
    const valid = invoke(ORACLE, [fixture.repo]);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).valid, true);

    const invalid = invoke(ORACLE, [nonRepository]);
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stdout).valid, false);

    for (const args of [['--unknown'], ['one', 'two']]) {
      const invocation = invoke(ORACLE, args);
      assert.equal(invocation.status, 64);
      assert.equal(invocation.stdout, '');
      assert.match(invocation.stderr, /^Usage:/);
    }
    const help = invoke(ORACLE, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stderr, /^Usage:/);
  } finally {
    fixture.cleanup();
    rmSync(nonRepository, { recursive: true, force: true });
  }
});

test('terminal CLI is a pure stdin renderer with deterministic exit behavior', () => {
  const rendered = invoke(TERMINAL, ['--color', 'never'], BOARD_FIXTURE);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, TERMINAL_GOLDEN);

  const invalid = invoke(TERMINAL, [], '{"broken":');
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, '');

  const invocation = invoke(TERMINAL, ['--color', 'rainbow'], BOARD_FIXTURE);
  assert.equal(invocation.status, 64);
  assert.equal(invocation.stdout, '');
});
