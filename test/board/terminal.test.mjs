import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  renderTerminal,
  sanitizeTerminalText,
} from '../../reference/board/terminal.mjs';

const FIXTURE = new URL(
  '../../conformance/fixtures/board/valid-incomplete-board.json',
  import.meta.url,
);
const GOLDEN = new URL(
  '../../conformance/fixtures/board/terminal-golden.txt',
  import.meta.url,
);

function fixture() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

test('terminal renderer matches the deterministic no-color golden', () => {
  assert.equal(
    renderTerminal(fixture(), { color: 'never' }),
    readFileSync(GOLDEN, 'utf8'),
  );
});

test('terminal renderer exposes plan revision and slice attempt when projected', () => {
  const board = fixture();
  board.releases[0].plan_revision = 3;
  board.releases[0].tracks[0].work[0].attempt = 2;
  const rendered = renderTerminal(board, { color: 'never' });
  assert.match(rendered, /Plan revision 3/);
  assert.match(rendered, /W1 — Ready for implementation · attempt 2/);
  assert.ok(
    rendered.indexOf('Ready for implementation') < rendered.indexOf('stage=design'),
    'plain status must appear before raw status details',
  );
});

test('terminal renderer sanitizes executable and directional control text', () => {
  const board = fixture();
  board.repository = [
    '\u001b[31mred\u001b[0m',
    'line one\nline two',
    '\u0000nul',
    '\ttab',
    '\u0085c1',
    '\u202eevil',
    '<script><svg onload=alert(1)>',
  ].join('|');
  const rendered = renderTerminal(board, { color: 'never' });
  assert.doesNotMatch(rendered, /\u001b|\u0000|\u0009|\u0085|\u202e|\nline two/);
  assert.match(rendered, /red\|line one ↩ line two\|�nul\|�tab\|�c1\|�evil/);
  assert.match(rendered, /<script><svg onload=alert\(1\)>/);
});

test('terminal text is bounded and color is explicit', () => {
  assert.equal(sanitizeTerminalText('x'.repeat(500)).length, 240);
  const board = fixture();
  assert.doesNotMatch(renderTerminal(board, { color: 'auto', isTTY: false }), /\u001b\[/);
  assert.match(renderTerminal(board, { color: 'auto', isTTY: true }), /\u001b\[/);
  assert.match(renderTerminal(board, { color: 'always' }), /\u001b\[/);
  assert.throws(
    () => renderTerminal(board, { color: 'rainbow' }),
    /color must be auto, always, or never/,
  );
});

test('terminal module contains no Git or lifecycle dependency', () => {
  const source = readFileSync(
    new URL('../../reference/board/terminal.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /records\/|child_process|execFile|spawn|stage\s*===/);
  assert.doesNotMatch(source, /ready to ship/i);
});
