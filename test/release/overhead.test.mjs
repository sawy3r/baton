import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countWords,
  measureOverhead,
} from '../../scripts/measure-overhead.mjs';

const BASELINE = Object.freeze({
  tag_object: 'a9128d8993a23d49ba3d3bd5bf918b28bda6ec67',
  commit: 'aae82d1cb8c28085ab20668c720f0282048dcc09',
  tree: '8e65016101762320572857ec786c0a377eedf2a8',
  fixed_words: 56_973,
});

test('RC2 overhead is reproducible and remains below every published budget', async () => {
  const report = await measureOverhead();
  assert.equal(report.schema_version, 'baton.overhead-report/v1');
  assert.equal(report.pass, true);
  assert.deepEqual(report.baseline.source, {
    tag: 'v0.16.0',
    tag_object: BASELINE.tag_object,
    commit: BASELINE.commit,
    tree: BASELINE.tree,
  });
  assert.equal(report.baseline.normal_work_happy_path.fixed_words, BASELINE.fixed_words);
  assert.equal(report.baseline.verified, true);
  assert.equal(report.current.version, '1.0.0-rc.2');
  assert.deepEqual(report.current.authored_schemas, ['work-status-v1.json']);
  assert.equal(report.current.logical_handoffs.length, 4);
  assert.equal(report.current.operations.length, 5);
  assert.equal(report.current.adapters.length, 10);
  assert.equal(report.current.generated_package.parity, true);
  assert.equal(report.current.normal_work_happy_path.minimum_invocations, 4);
  assert.equal(report.current.normal_work_happy_path.fixed_words, 1512);
  assert.equal(report.comparison.fixed_word_ratio, 0.026539);
  assert.equal(report.budgets.every(({ pass }) => pass), true);
});

test('baseline object reads ignore inherited Git process settings', async () => {
  const keys = [
    'PATH',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_INDEX_FILE',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.PATH = '/definitely/not/the/system/path';
    process.env.GIT_DIR = '/definitely/not/the/baton/repository';
    process.env.GIT_WORK_TREE = '/definitely/not/the/baton/worktree';
    process.env.GIT_OBJECT_DIRECTORY = '/definitely/not/the/baton/objects';
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = '/definitely/not/the/baton/alternates';
    process.env.GIT_INDEX_FILE = '/definitely/not/the/baton/index';
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'core.repositoryFormatVersion';
    process.env.GIT_CONFIG_VALUE_0 = '99';
    const report = await measureOverhead();
    assert.equal(report.baseline.source.commit, BASELINE.commit);
    assert.equal(report.baseline.normal_work_happy_path.fixed_words, BASELINE.fixed_words);
    assert.equal(report.pass, true);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('word counting is byte-defined rather than locale-dependent', () => {
  assert.equal(countWords(Buffer.from('  one\ttwo\r\nthree  ', 'utf8')), 3);
  assert.equal(countWords(Buffer.from('')), 0);
  assert.throws(
    () => countWords(Buffer.from([0xff])),
    /encoded data was not valid for encoding utf-8/,
  );
});
