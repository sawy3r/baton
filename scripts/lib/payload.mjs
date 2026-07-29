export const PACKAGE_VERSION_FILE = 'VERSION';
export const OPERATION_VERSION = 'baton.operation/v2';
export const GENERATOR_VERSION = 'baton.skill-generator/v1';
export const PAYLOAD_MANIFEST_VERSION = 'baton.skills-payload/v1';

export const OPERATIONS = Object.freeze([
  Object.freeze({
    name: 'baton-plan',
    source: 'operations/baton-plan.md',
    description:
      'Propose an externally approved Baton plan or forward-only revision with stable slice identities.',
    resources: Object.freeze([
      Object.freeze({
        source: 'templates/plan.md',
        path: 'templates/plan.md',
      }),
    ]),
  }),
  Object.freeze({
    name: 'baton-implement',
    source: 'operations/baton-implement.md',
    description:
      'Design or implement one eligible Baton slice attempt without crossing review boundaries.',
    resources: Object.freeze([]),
  }),
  Object.freeze({
    name: 'baton-design-review',
    source: 'operations/baton-design-review.md',
    description:
      'Return the Captain decision over one exact Baton plan revision, slice, and design attempt.',
    resources: Object.freeze([]),
  }),
  Object.freeze({
    name: 'baton-verify',
    source: 'operations/baton-verify.md',
    description:
      'Independently verify an exact Baton slice candidate or assembled product from fresh read-only context.',
    resources: Object.freeze([]),
  }),
  Object.freeze({
    name: 'baton-merge',
    source: 'operations/baton-merge.md',
    description:
      'Mechanically compose passed Baton candidates or integrate the exact assembled candidate that passed.',
    resources: Object.freeze([]),
  }),
]);

export const GENERATED_BEGIN = '<!-- BATON_CANONICAL_BEGIN';
export const GENERATED_END = '<!-- BATON_CANONICAL_END';
