#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  readFile,
  readdir,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isDeepStrictEqual,
  TextDecoder,
} from 'node:util';

import {
  checkGenerated,
  extractCanonicalRegion,
  renderGenerated,
} from './generate-adapters.mjs';
import { OPERATIONS } from './lib/catalog.mjs';
import {
  repositoryRoot,
  unsafeRunGit,
} from '../reference/records/git.mjs';
import { strictParseJSON } from '../reference/records/records.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
export const DEFAULT_BASELINE = join(
  DEFAULT_ROOT,
  'conformance',
  'baselines',
  'v0.16.0-overhead.json',
);

const EXPECTED_OPERATIONS = Object.freeze([
  'baton-plan',
  'baton-implement',
  'baton-design-review',
  'baton-verify',
  'baton-merge',
]);
const NORMAL_WORK_INVOCATIONS = Object.freeze([
  Object.freeze({ id: 'implementer-design', operation: 'baton-implement' }),
  Object.freeze({ id: 'captain-review', operation: 'baton-design-review' }),
  Object.freeze({ id: 'implementer-delivery', operation: 'baton-implement' }),
  Object.freeze({ id: 'verifier', operation: 'baton-verify' }),
]);
const LOGICAL_HANDOFFS = Object.freeze([
  Object.freeze({ id: 'plan', path: '<applicable approved plan revision>' }),
  Object.freeze({ id: 'receipts', path: '<canonical compact receipt representation>' }),
]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const observed = Object.keys(value).sort();
  const required = [...expected].sort();
  if (!isDeepStrictEqual(observed, required)) {
    fail(`${label} fields differ: expected ${required.join(', ')}, got ${observed.join(', ')}`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
  return value;
}

function repositoryPath(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\\')
    || value.startsWith('/')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${label} is not a canonical repository path`);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function countWords(bytes) {
  const text = UTF8.decode(bytes);
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

function runGit(root, args, encoding = 'utf8') {
  return unsafeRunGit(root, args, {
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    label: `read overhead baseline with git ${args[0]}`,
  });
}

function gitText(root, args) {
  return runGit(root, args, 'utf8').trim();
}

function validateBaselineShape(value) {
  exactKeys(
    value,
    ['schema_version', 'source', 'word_count', 'audited_paths', 'normal_work_happy_path'],
    'baseline',
  );
  if (value.schema_version !== 'baton.overhead-baseline/v1') {
    fail('unsupported overhead baseline version');
  }
  exactKeys(value.source, ['tag', 'tag_object', 'commit', 'tree'], 'baseline source');
  if (value.source.tag !== 'v0.16.0') fail('baseline source must be v0.16.0');
  for (const field of ['tag_object', 'commit', 'tree']) {
    if (!OID.test(value.source[field])) fail(`baseline source ${field} is not one full OID`);
  }
  exactKeys(value.word_count, ['algorithm'], 'baseline word counter');
  if (value.word_count.algorithm !== 'utf8-whitespace-v1') {
    fail('unsupported baseline word-count algorithm');
  }
  if (!Array.isArray(value.audited_paths) || value.audited_paths.length === 0) {
    fail('baseline audited_paths must be non-empty');
  }
  const seen = new Set();
  for (const [index, entry] of value.audited_paths.entries()) {
    exactKeys(entry, ['path', 'bytes', 'words', 'digest'], `baseline path ${index}`);
    repositoryPath(entry.path, `baseline path ${index}`);
    if (seen.has(entry.path)) fail(`duplicate baseline path ${entry.path}`);
    seen.add(entry.path);
    positiveInteger(entry.bytes, `${entry.path} bytes`);
    positiveInteger(entry.words, `${entry.path} words`);
    if (!DIGEST.test(entry.digest)) fail(`${entry.path} has an invalid digest`);
  }
  const happy = value.normal_work_happy_path;
  exactKeys(
    happy,
    ['required_artifacts', 'minimum_invocations', 'invocations', 'fixed_words'],
    'baseline happy path',
  );
  if (
    !Array.isArray(happy.required_artifacts)
    || happy.required_artifacts.length === 0
    || happy.required_artifacts.some((item) => typeof item !== 'string' || item.length === 0)
    || new Set(happy.required_artifacts).size !== happy.required_artifacts.length
  ) {
    fail('baseline required artifacts must be unique non-empty strings');
  }
  positiveInteger(happy.minimum_invocations, 'baseline minimum invocations');
  positiveInteger(happy.fixed_words, 'baseline fixed words');
  if (!Array.isArray(happy.invocations) || happy.invocations.length === 0) {
    fail('baseline invocations must be non-empty');
  }
  for (const [index, invocation] of happy.invocations.entries()) {
    exactKeys(invocation, ['id', 'count', 'loaded_paths'], `baseline invocation ${index}`);
    if (typeof invocation.id !== 'string' || invocation.id.length === 0) {
      fail(`baseline invocation ${index} needs an id`);
    }
    if (!Number.isSafeInteger(invocation.count) || invocation.count < 1) {
      fail(`baseline invocation ${invocation.id} count must be positive`);
    }
    if (
      !Array.isArray(invocation.loaded_paths)
      || invocation.loaded_paths.length === 0
      || new Set(invocation.loaded_paths).size !== invocation.loaded_paths.length
    ) {
      fail(`baseline invocation ${invocation.id} has invalid loaded paths`);
    }
    for (const path of invocation.loaded_paths) {
      if (!seen.has(path)) fail(`baseline invocation ${invocation.id} uses unaudited path ${path}`);
    }
  }
  return value;
}

async function measureBaseline(root, baselinePath) {
  const baseline = validateBaselineShape(strictParseJSON(
    await readFile(baselinePath),
    'v0.16.0 overhead baseline',
    { maxBytes: 262_144 },
  ));
  const { source } = baseline;
  const observedTag = gitText(root, ['rev-parse', '--verify', `refs/tags/${source.tag}`]);
  if (observedTag !== source.tag_object) {
    fail(`baseline tag object moved: expected ${source.tag_object}, got ${observedTag}`);
  }
  if (gitText(root, ['cat-file', '-t', source.tag_object]) !== 'tag') {
    fail(`baseline ${source.tag_object} is not an annotated tag object`);
  }
  const observedCommit = gitText(root, ['rev-parse', '--verify', `${source.tag}^{commit}`]);
  if (observedCommit !== source.commit) {
    fail(`baseline peeled commit moved: expected ${source.commit}, got ${observedCommit}`);
  }
  const observedTree = gitText(root, ['rev-parse', '--verify', `${source.commit}^{tree}`]);
  if (observedTree !== source.tree) {
    fail(`baseline tree moved: expected ${source.tree}, got ${observedTree}`);
  }

  const audited = [];
  const wordsByPath = new Map();
  for (const expected of baseline.audited_paths) {
    const bytes = runGit(root, ['cat-file', 'blob', `${source.commit}:${expected.path}`], null);
    const observed = {
      path: expected.path,
      bytes: bytes.byteLength,
      words: countWords(bytes),
      digest: sha256(bytes),
    };
    if (!isDeepStrictEqual(observed, expected)) {
      fail(`baseline audit mismatch for ${expected.path}`);
    }
    audited.push(observed);
    wordsByPath.set(observed.path, observed.words);
  }

  let fixedWords = 0;
  let minimumInvocations = 0;
  for (const invocation of baseline.normal_work_happy_path.invocations) {
    minimumInvocations += invocation.count;
    fixedWords += invocation.count * invocation.loaded_paths.reduce(
      (total, path) => total + wordsByPath.get(path),
      0,
    );
  }
  if (minimumInvocations !== baseline.normal_work_happy_path.minimum_invocations) {
    fail('stored baseline minimum invocation count does not recompute');
  }
  if (fixedWords !== baseline.normal_work_happy_path.fixed_words) {
    fail('stored baseline fixed word count does not recompute');
  }
  return {
    source,
    word_count: baseline.word_count,
    audited_paths: audited,
    normal_work_happy_path: {
      required_artifacts: baseline.normal_work_happy_path.required_artifacts,
      minimum_invocations: minimumInvocations,
      fixed_words: fixedWords,
    },
    verified: true,
  };
}

async function measureCurrent(root) {
  const version = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  const observedOperations = OPERATIONS.map(({ name }) => name);
  if (!isDeepStrictEqual(observedOperations, EXPECTED_OPERATIONS)) {
    fail('current canonical operation inventory differs from the five Baton operations');
  }

  const rendered = await renderGenerated({ bundleRoot: root });
  await checkGenerated({
    bundleRoot: root,
    outputRoot: join(root, 'adapters', 'generated'),
  });
  const checkedManifest = JSON.parse(
    await readFile(join(root, 'adapters', 'generated', 'generated-manifest.json'), 'utf8'),
  );
  if (!isDeepStrictEqual(checkedManifest, rendered.manifest)) {
    fail('checked-in generated manifest differs from regenerated data');
  }
  if (rendered.manifest.package_version !== version) {
    fail('generated package version differs from VERSION');
  }

  const operationResults = [];
  const operationBytes = new Map();
  const forbidden = [];
  for (const operation of OPERATIONS) {
    const bytes = await readFile(join(root, operation.source));
    const text = UTF8.decode(bytes);
    const digest = sha256(bytes);
    const manifestEntry = rendered.manifest.operations.find(({ name }) => name === operation.name);
    if (!manifestEntry || manifestEntry.digest !== digest) {
      fail(`generated operation digest differs for ${operation.name}`);
    }
    if (/\b(?:providers?|models?)\b/iu.test(text) || /\bdefault[-_\s]+model\b/iu.test(text)) {
      forbidden.push(operation.name);
    }
    operationBytes.set(operation.name, bytes);
    operationResults.push({
      name: operation.name,
      path: operation.source,
      bytes: bytes.byteLength,
      words: countWords(bytes),
      digest,
    });
  }

  const adapterResults = [];
  const maxWordsByOperation = new Map();
  for (const host of ['claude', 'codex']) {
    for (const operation of OPERATIONS) {
      const path = `${host}/skills/${operation.name}/SKILL.md`;
      const bytes = rendered.files.get(path);
      if (!bytes) fail(`rendered adapter is missing ${path}`);
      const canonical = extractCanonicalRegion(bytes, operation.name);
      if (!canonical.equals(operationBytes.get(operation.name))) {
        fail(`canonical adapter region differs for ${path}`);
      }
      const digest = sha256(bytes);
      const record = rendered.manifest.adapters.find((entry) => (
        entry.host === host && entry.operation === operation.name
      ));
      if (
        !record
        || record.path !== path
        || record.digest !== digest
        || record.canonical_digest !== sha256(canonical)
      ) {
        fail(`generated adapter manifest binding differs for ${path}`);
      }
      const words = countWords(bytes);
      maxWordsByOperation.set(
        operation.name,
        Math.max(maxWordsByOperation.get(operation.name) ?? 0, words),
      );
      adapterResults.push({
        host,
        operation: operation.name,
        path: `adapters/generated/${path}`,
        bytes: bytes.byteLength,
        words,
        digest,
        canonical_digest: record.canonical_digest,
      });
    }
  }

  const packageParity = (
    rendered.manifest.packages?.claude?.digest === rendered.manifest.package_digest
    && rendered.manifest.packages?.codex?.digest === rendered.manifest.package_digest
  );
  const schemas = (await readdir(join(root, 'schemas')))
    .filter((path) => path.endsWith('.json'))
    .sort();
  const invocations = NORMAL_WORK_INVOCATIONS.map((invocation) => ({
    ...invocation,
    fixed_words: maxWordsByOperation.get(invocation.operation),
  }));
  const fixedWords = invocations.reduce((total, invocation) => total + invocation.fixed_words, 0);

  return {
    version,
    authored_schemas: schemas,
    logical_handoffs: LOGICAL_HANDOFFS,
    operations: operationResults,
    adapters: adapterResults,
    generated_package: {
      digest: rendered.manifest.package_digest,
      claude_digest: rendered.manifest.packages.claude.digest,
      codex_digest: rendered.manifest.packages.codex.digest,
      parity: packageParity,
    },
    normal_work_happy_path: {
      minimum_invocations: invocations.length,
      invocations,
      fixed_words: fixedWords,
    },
    provider_or_model_mentions: forbidden,
  };
}

function budget(name, actual, limit, pass) {
  return { name, actual, limit, pass };
}

export async function measureOverhead({
  root = DEFAULT_ROOT,
  baselinePath = DEFAULT_BASELINE,
} = {}) {
  const exactRoot = resolve(repositoryRoot(resolve(root)));
  const baseline = await measureBaseline(exactRoot, resolve(baselinePath));
  const current = await measureCurrent(exactRoot);
  const operationWords = current.operations.map(({ name, words }) => ({ name, words }));
  const operationTotal = operationWords.reduce((total, entry) => total + entry.words, 0);
  const invocationMaximum = Math.max(...current.adapters.map(({ words }) => words));
  const ratio = Number((
    current.normal_work_happy_path.fixed_words
    / baseline.normal_work_happy_path.fixed_words
  ).toFixed(6));
  const canonicalParity = EXPECTED_OPERATIONS.every((name) => {
    const canonical = new Set(
      current.adapters
        .filter((entry) => entry.operation === name)
        .map((entry) => entry.canonical_digest),
    );
    return canonical.size === 1
      && canonical.has(current.operations.find((entry) => entry.name === name).digest);
  });

  const budgets = [
    budget(
      'at most one authored JSON Schema',
      current.authored_schemas.length,
      1,
      current.authored_schemas.length <= 1,
    ),
    budget(
      'two required protocol artefacts per normal slice',
      current.logical_handoffs.length,
      2,
      current.logical_handoffs.length === 2,
    ),
    budget(
      'each canonical operation words',
      operationWords,
      350,
      operationWords.every(({ words }) => words <= 350),
    ),
    budget(
      'all canonical operation words',
      operationTotal,
      1700,
      operationTotal <= 1700,
    ),
    budget(
      'effective fixed words in one invocation',
      invocationMaximum,
      450,
      invocationMaximum <= 450,
    ),
    budget(
      'happy-path fixed word ratio to v0.16.0',
      ratio,
      0.2,
      ratio <= 0.2,
    ),
    budget(
      'canonical operation provider or model mentions',
      current.provider_or_model_mentions,
      0,
      current.provider_or_model_mentions.length === 0,
    ),
    budget(
      'Claude and Codex canonical digest parity',
      canonicalParity,
      true,
      canonicalParity,
    ),
    budget(
      'Claude and Codex package digest parity',
      current.generated_package.parity,
      true,
      current.generated_package.parity,
    ),
  ];

  return {
    schema_version: 'baton.overhead-report/v1',
    baseline,
    current,
    comparison: {
      baseline_fixed_words: baseline.normal_work_happy_path.fixed_words,
      current_fixed_words: current.normal_work_happy_path.fixed_words,
      fixed_word_ratio: ratio,
      baseline_required_artifacts:
        baseline.normal_work_happy_path.required_artifacts.length,
      current_logical_handoffs: current.logical_handoffs.length,
      baseline_minimum_invocations:
        baseline.normal_work_happy_path.minimum_invocations,
      current_minimum_invocations:
        current.normal_work_happy_path.minimum_invocations,
    },
    budgets,
    pass: budgets.every((entry) => entry.pass),
  };
}

function parseArguments(argv) {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === '--check') return { check: true };
  fail('usage: node scripts/measure-overhead.mjs [--check]');
}

async function main() {
  const { check } = parseArguments(process.argv.slice(2));
  const result = await measureOverhead();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (check && !result.pass) {
    const failed = result.budgets.filter((entry) => !entry.pass).map((entry) => entry.name);
    process.stderr.write(`overhead budgets failed: ${failed.join(', ')}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
