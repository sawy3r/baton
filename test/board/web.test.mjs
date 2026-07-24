import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import test from 'node:test';

import {
  createBoardServer,
  startBoardServer,
} from '../../reference/board/web.mjs';

const BOARD = JSON.parse(readFileSync(
  new URL('../../conformance/fixtures/board/valid-incomplete-board.json', import.meta.url),
  'utf8',
));

function fetchLocal(running, {
  path = '/',
  method = 'GET',
  host = `127.0.0.1:${running.port}`,
} = {}) {
  return new Promise((resolve, reject) => {
    const operation = request({
      hostname: '127.0.0.1',
      port: running.port,
      path,
      method,
      headers: { Host: host },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    operation.on('error', reject);
    operation.end();
  });
}

test('server exposes only the fixed GET surface with exact security headers', async () => {
  const running = await startBoardServer({
    port: 0,
    project: () => BOARD,
  });
  try {
    const expected = {
      '/': 'text/html; charset=utf-8',
      '/app.js': 'text/javascript; charset=utf-8',
      '/style.css': 'text/css; charset=utf-8',
      '/api/board': 'application/json; charset=utf-8',
    };
    for (const [path, type] of Object.entries(expected)) {
      const response = await fetchLocal(running, { path });
      assert.equal(response.status, 200);
      assert.equal(response.headers['content-type'], type);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.equal(
        response.headers['content-security-policy'],
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
      );
    }
    const favicon = await fetchLocal(running, { path: '/favicon.ico' });
    assert.equal(favicon.status, 204);
    assert.equal(favicon.body, '');
  } finally {
    await running.close();
  }
});

test('Host, method, query, encoded, traversal, and unknown requests fail closed', async () => {
  let projections = 0;
  const running = await startBoardServer({
    port: 0,
    project() {
      projections += 1;
      return BOARD;
    },
  });
  try {
    const wrongHost = await fetchLocal(running, {
      path: '/',
      host: `localhost:${running.port}`,
    });
    assert.equal(wrongHost.status, 421);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = await fetchLocal(running, { path: '/api/board', method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.allow, 'GET');
    }
    for (const path of [
      '/api/board?release=v2',
      '/app%2ejs',
      '/%2e%2e/secret',
      '/../secret',
      '/unknown',
    ]) {
      const response = await fetchLocal(running, { path });
      assert.equal(response.status, 404);
    }
    assert.equal(projections, 0);

    const board = await fetchLocal(running, { path: '/api/board' });
    assert.equal(board.status, 200);
    assert.equal(projections, 1);
    assert.deepEqual(JSON.parse(board.body), BOARD);
  } finally {
    await running.close();
  }
});

test('projector failure is bounded and does not expose internal text', async () => {
  const running = await startBoardServer({
    port: 0,
    project() {
      throw new Error('/private/repository/secret');
    },
  });
  try {
    const response = await fetchLocal(running, { path: '/api/board' });
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(response.body), {
      status: 503,
      code: 'BOARD_UNAVAILABLE',
    });
    assert.doesNotMatch(response.body, /private|repository|secret/);
  } finally {
    await running.close();
  }
});

test('bind is restricted to exact numeric loopback addresses', () => {
  for (const host of ['0.0.0.0', '::', 'localhost', '127.0.0.2', 'example.com']) {
    assert.throws(() => createBoardServer({ host }), /exactly 127\.0\.0\.1 or ::1/);
  }
  assert.doesNotThrow(() => createBoardServer({ host: '127.0.0.1' }).close());
  assert.doesNotThrow(() => createBoardServer({ host: '::1' }).close());
});

test('shell, client, and stylesheet remain static and executable-sink free', async () => {
  const running = await startBoardServer({
    port: 0,
    project: () => BOARD,
  });
  try {
    const html = (await fetchLocal(running, { path: '/' })).body;
    const client = (await fetchLocal(running, { path: '/app.js' })).body;
    assert.match(html, /<script src="\/app\.js" defer><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="\/style\.css">/);
    assert.doesNotMatch(html, /<script(?! src)|<style| on[a-z]+=|javascript:/i);
    assert.doesNotMatch(
      client,
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|child_process/,
    );
    assert.match(client, /createElement/);
    assert.match(client, /textContent/);
    assert.match(client, /replaceChildren/);
    assert.match(client, /setInterval\(refresh, 15000\)/);
    assert.match(client, /showing last committed view/);
  } finally {
    await running.close();
  }
});
