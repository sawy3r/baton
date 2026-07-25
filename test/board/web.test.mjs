import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { runInNewContext } from 'node:vm';
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

class TestNode {
  constructor(tag = null, value = '') {
    this.tag = tag;
    this.className = '';
    this.attributes = {};
    this.children = [];
    this.value = String(value);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
    this.value = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  set textContent(value) {
    this.value = String(value);
    this.children = [];
  }

  get textContent() {
    return `${this.value}${this.children.map((child) => child.textContent).join('')}`;
  }
}

function executeClient(client, board, secondBoard) {
  const createdTags = [];
  const roots = {
    board: new TestNode('main'),
    freshness: new TestNode('p', 'Connecting'),
  };
  const document = {
    getElementById(id) {
      return roots[id] ?? null;
    },
    createElement(tag) {
      createdTags.push(tag);
      return new TestNode(tag);
    },
    createElementNS(_namespace, tag) {
      createdTags.push(tag);
      return new TestNode(tag);
    },
    createTextNode(value) {
      return new TestNode(null, value);
    },
    createDocumentFragment() {
      return new TestNode(null);
    },
  };
  let interval = null;
  let requestCount = 0;
  const context = {
    document,
    fetch: async () => {
      requestCount += 1;
      if (requestCount > 1 && secondBoard === undefined) {
        throw new Error('expected refresh failure');
      }
      return {
        ok: true,
        json: async () => requestCount > 1 ? secondBoard : board,
      };
    },
    window: {
      setInterval(callback, milliseconds) {
        interval = { callback, milliseconds };
        return 1;
      },
    },
  };
  runInNewContext(client, context, { timeout: 1000 });
  return {
    ...roots,
    createdTags,
    interval: () => interval,
    requestCount: () => requestCount,
  };
}

function nodeSnapshot(node) {
  return {
    tag: node.tag,
    className: node.className,
    attributes: node.attributes,
    value: node.value,
    children: node.children.map(nodeSnapshot),
  };
}

function descendants(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  node.children.forEach((child) => descendants(child, predicate, found));
  return found;
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
    assert.match(client, /baton\.graph\/v1/);
    assert.doesNotMatch(
      client,
      /work\.status|work\.next_role|work\.next_operation|track\.composition|track\.depends_on/,
    );
  } finally {
    await running.close();
  }
});

test('client renders repository text literally and retains the last view after refresh failure', async () => {
  const running = await startBoardServer({
    port: 0,
    project: () => BOARD,
  });
  try {
    const client = (await fetchLocal(running, { path: '/app.js' })).body;
    const rendered = JSON.parse(JSON.stringify(BOARD));
    const corpus = [
      '<script>globalThis.executed = true</script>',
      '<svg onload="globalThis.executed = true">',
      '" onpointerover="globalThis.executed = true',
      'javascript:globalThis.executed = true',
      '\u001b[31mcontrol\u0007',
      '\u202eright-to-left',
      'line one\nline two\u2028line three',
    ].join(' | ');
    rendered.repository = corpus;
    rendered.releases[0].release = corpus;
    rendered.releases[0].tracks[0].work[0].id = corpus;
    const graphNode = rendered.releases[0].graph.nodes
      .find((node) => node.id === 'slice:W1');
    graphNode.id = `slice:${corpus}`;
    graphNode.work = corpus;
    rendered.releases[0].graph.edges.forEach((edge) => {
      if (edge.from === 'slice:W1') edge.from = graphNode.id;
      if (edge.to === 'slice:W1') edge.to = graphNode.id;
    });
    const execution = executeClient(client, rendered);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(execution.requestCount(), 1);
    assert.equal(execution.freshness.textContent, 'Committed state · current');
    assert.match(execution.board.textContent, /<script>/);
    assert.match(execution.board.textContent, /<svg onload/);
    assert.equal(execution.createdTags.includes('script'), false);
    assert.equal(execution.createdTags.includes('svg'), true);
    assert.equal(execution.createdTags.includes('foreignObject'), false);
    assert.deepEqual(execution.interval()?.milliseconds, 15000);

    const committedView = nodeSnapshot(execution.board);
    await execution.interval().callback();
    assert.equal(execution.requestCount(), 2);
    assert.deepEqual(nodeSnapshot(execution.board), committedView);
    assert.equal(
      execution.freshness.textContent,
      'Refresh failed · showing last committed view',
    );
  } finally {
    await running.close();
  }
});

test('malformed graph refresh retains the last complete committed view', async () => {
  const running = await startBoardServer({
    port: 0,
    project: () => BOARD,
  });
  try {
    const client = (await fetchLocal(running, { path: '/app.js' })).body;
    const malformed = JSON.parse(JSON.stringify(BOARD));
    malformed.releases[0].graph.edges[0].from = 'missing-node';
    const execution = executeClient(client, BOARD, malformed);
    await new Promise((resolve) => setImmediate(resolve));
    const committedView = nodeSnapshot(execution.board);

    await execution.interval().callback();

    assert.equal(execution.requestCount(), 2);
    assert.deepEqual(nodeSnapshot(execution.board), committedView);
    assert.equal(
      execution.freshness.textContent,
      'Refresh failed · showing last committed view',
    );
  } finally {
    await running.close();
  }
});

test('client renders the release as a semantic relay graph with explicit relationships', async () => {
  const running = await startBoardServer({
    port: 0,
    project: () => BOARD,
  });
  try {
    const client = (await fetchLocal(running, { path: '/app.js' })).body;
    const rendered = JSON.parse(JSON.stringify(BOARD));
    rendered.releases[0].plan_revision = 2;
    rendered.releases[0].graph.edges
      .find((edge) => edge.from === 'slice:W1' && edge.to === 'slice:W2')
      .kinds.push('consumes');
    const execution = executeClient(client, rendered);
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(execution.board.textContent, /Release relay/);
    assert.match(execution.board.textContent, /Leg 01W1/);
    assert.match(execution.board.textContent, /after W1 · uses W1/);
    assert.match(execution.board.textContent, /Depends on W1/);
    assert.match(execution.board.textContent, /Consumes W1/);
    assert.match(execution.board.textContent, /Final exchangeAssembly/);
    assert.match(execution.board.textContent, /FinishMergewaiting/);
    assert.match(execution.board.textContent, /Leg 01W2waiting/);

    const semanticTags = new Set(descendants(
      execution.board,
      (node) => ['ol', 'li', 'details', 'summary'].includes(node.tag),
    ).map((node) => node.tag));
    assert.deepEqual([...semanticTags].sort(), ['details', 'li', 'ol', 'summary']);
    const graphRegions = descendants(
      execution.board,
      (node) => node.attributes.role === 'region' && /relay graph/.test(node.attributes['aria-label']),
    );
    assert.equal(graphRegions.length, 1);
    const decorativeGraphs = descendants(
      execution.board,
      (node) => node.tag === 'svg' && node.attributes['aria-hidden'] === 'true',
    );
    assert.equal(decorativeGraphs.length, 1);
  } finally {
    await running.close();
  }
});
