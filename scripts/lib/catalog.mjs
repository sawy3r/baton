export const PACKAGE_VERSION_FILE = 'VERSION';
export const OPERATION_VERSION = 'baton.operation/v1';
export const GENERATOR_VERSION = 'baton.adapter-generator/v1';
export const GENERATED_MANIFEST_VERSION = 'baton.generated-adapters/v1';
export const INSTALL_MANIFEST_VERSION = 'baton.install/v1';
export const TRANSACTION_VERSION = 'baton.transaction/v1';

export const OPERATIONS = Object.freeze([
  Object.freeze({
    name: 'baton-plan',
    source: 'operations/baton-plan.md',
    description:
      'Create or revise an externally approved Baton plan. Use when starting delivery or authorised replanning is required.',
  }),
  Object.freeze({
    name: 'baton-implement',
    source: 'operations/baton-implement.md',
    description:
      'Design or implement one authoritative Baton work item. Use for an Implementer handoff or repair after verification failure.',
  }),
  Object.freeze({
    name: 'baton-design-review',
    source: 'operations/baton-design-review.md',
    description:
      'Record the Captain decision over exact Baton plan and design bytes. Use when a work item is awaiting design review.',
  }),
  Object.freeze({
    name: 'baton-verify',
    source: 'operations/baton-verify.md',
    description:
      'Independently verify Baton work or assembly evidence. Use only from a fresh read-only verification context.',
  }),
  Object.freeze({
    name: 'baton-merge',
    source: 'operations/baton-merge.md',
    description:
      'Deterministically compose a Baton track, prepare assembly, or integrate a passed release. Use for an eligible Merge handoff.',
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
  'schemas/work-status-v1.json',
  'reference/records/README.md',
  'reference/records/actions.mjs',
  'reference/records/git.mjs',
  'reference/records/records.mjs',
  'reference/records/transition.mjs',
  ...PORTABLE_RUNTIME_FILES,
  ...OPERATIONS.map(({ source }) => source),
  'templates/plan.md',
  'templates/design.md',
  'templates/proof.md',
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
