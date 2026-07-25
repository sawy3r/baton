export const PACKAGE_VERSION_FILE = 'VERSION';
export const OPERATION_VERSION = 'baton.operation/v2';
export const GENERATOR_VERSION = 'baton.adapter-generator/v1';
export const GENERATED_MANIFEST_VERSION = 'baton.generated-adapters/v1';
export const INSTALL_MANIFEST_VERSION = 'baton.install/v1';
export const TRANSACTION_VERSION = 'baton.transaction/v1';

export const PRIOR_INSTALL_PACKAGES = Object.freeze([
  Object.freeze({
    package_version: '1.0.0-rc.2',
    package_digest: 'sha256:676c630c6a4ef3f752d604efaa5e51958adec0d8580b74cec7fb1e689b1d3436',
    generator_version: 'baton.adapter-generator/v1',
    operation_version: 'baton.operation/v1',
    ownership_fingerprints: Object.freeze({
      claude: 'sha256:39c59469d2ce5e06dcbff61bb25218a2c4eb2571f07ca246cd3627c0000313d3',
      codex: 'sha256:8c309008a03881660bbd88dc42e5f2cc652d08213ff5cb046ac22c471e3b8766',
    }),
  }),
  Object.freeze({
    package_version: '1.0.0-rc.3',
    package_digest: 'sha256:e5927a82f7c8a0daf3aa1196e7aa56231044449bb141cc2d7efd1cc8cca209bd',
    generator_version: 'baton.adapter-generator/v1',
    operation_version: 'baton.operation/v1',
    ownership_fingerprints: Object.freeze({
      claude: 'sha256:d9f8a6ea77aeced3b8cedb99743d1f72ad864a67dd1542fd1e4e75cd5a9f26ab',
      codex: 'sha256:1c7a4ec037f468fe64cf785a431648a0c2903904614600f2f8205250f191cc2a',
    }),
  }),
  Object.freeze({
    package_version: '1.0.0-rc.4',
    package_digest: 'sha256:9aecab587b22a275e661828329f3f4550e8299756fafd459c15b3509aa57f283',
    generator_version: 'baton.adapter-generator/v1',
    operation_version: 'baton.operation/v2',
    ownership_fingerprints: Object.freeze({
      claude: 'sha256:900d25d362d59db81c04686c8bcf841421ac685d642b65d42a4607fec0016076',
      codex: 'sha256:d219ba9421a9d1d62b4dc8f7af45c15ef1297cb0465d9ba919cbdc6451d2a64b',
    }),
  }),
]);

export const OPERATIONS = Object.freeze([
  Object.freeze({
    name: 'baton-plan',
    source: 'operations/baton-plan.md',
    description:
      'Propose an externally approved Baton plan or forward-only revision with stable slice identities.',
  }),
  Object.freeze({
    name: 'baton-implement',
    source: 'operations/baton-implement.md',
    description:
      'Design or implement one eligible Baton slice attempt without crossing review boundaries.',
  }),
  Object.freeze({
    name: 'baton-design-review',
    source: 'operations/baton-design-review.md',
    description:
      'Return the Captain decision over one exact Baton plan revision, slice, and design attempt.',
  }),
  Object.freeze({
    name: 'baton-verify',
    source: 'operations/baton-verify.md',
    description:
      'Independently verify an exact Baton slice candidate or assembled product from fresh read-only context.',
  }),
  Object.freeze({
    name: 'baton-merge',
    source: 'operations/baton-merge.md',
    description:
      'Mechanically compose passed Baton candidates or integrate the exact assembled candidate that passed.',
  }),
]);

export const PORTABLE_RUNTIME_FILES = Object.freeze([
  'reference/board/oracle.mjs',
  'reference/board/terminal.mjs',
  'reference/board/web.mjs',
  'reference/records/actions.mjs',
  'reference/records/git.mjs',
  'reference/records/receipts.mjs',
  'reference/records/state.mjs',
]);

export const SUPPORT_FILES = Object.freeze([
  'VERSION',
  'baton/CORE.md',
  'baton/PROTOCOL.md',
  'baton/ASSURANCE.md',
  'baton/CONFORMANCE.md',
  'baton/RATIONALE.md',
  'baton/README.md',
  'schemas/receipt-v1.json',
  'reference/records/README.md',
  ...PORTABLE_RUNTIME_FILES,
  ...OPERATIONS.map(({ source }) => source),
  'templates/plan.md',
]);

export const HOSTS = Object.freeze({
  claude: Object.freeze({
    name: 'claude',
    bridge:
      'Treat the free-form invocation text as the operation inputs. Resolve the Baton package root from the current Git project .claude/baton install when present and valid; otherwise use the configured Claude user directory baton install. Read package-relative files from that root.',
  }),
  codex: Object.freeze({
    name: 'codex',
    bridge:
      'Treat the free-form invocation text as the operation inputs. Resolve the Baton package root from the current Git project .codex/baton install when present and valid; otherwise use the configured Codex user directory baton install. Read package-relative files from that root.',
  }),
});

export const LEGACY_COMMANDS = Object.freeze([
  'plan-release',
  'replan-release',
  'implement-slice',
  'design-review',
  'verify-slice',
  'merge-track',
  'merge-release',
  'mark-shipped',
]);

export const GENERATED_BEGIN = '<!-- BATON_CANONICAL_BEGIN';
export const GENERATED_END = '<!-- BATON_CANONICAL_END';
