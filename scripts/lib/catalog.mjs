export const PACKAGE_VERSION_FILE = 'VERSION';
export const OPERATION_VERSION = 'baton.operation/v2';
export const GENERATOR_VERSION = 'baton.adapter-generator/v1';
export const GENERATED_MANIFEST_VERSION = 'baton.generated-adapters/v1';
export const INSTALL_MANIFEST_VERSION = 'baton.install/v1';
export const TRANSACTION_VERSION = 'baton.transaction/v1';

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
  'reference/driver/contract.md',
  'reference/driver/fake-driver.mjs',
]);

export const SUPPORT_FILES = Object.freeze([
  'VERSION',
  'baton/CORE.md',
  'baton/PROTOCOL.md',
  'baton/ASSURANCE.md',
  'baton/CONFORMANCE.md',
  'baton/RATIONALE.md',
  'baton/README.md',
  'reference/records/README.md',
  'reference/records/actions.mjs',
  'reference/records/git.mjs',
  'reference/records/records.mjs',
  'reference/records/transition.mjs',
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
