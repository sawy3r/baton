export const PACKAGE_VERSION_FILE = 'VERSION';
export const OPERATION_VERSION = 'baton.operation/v2';
export const GENERATOR_VERSION = 'baton.skill-generator/v1';
export const PAYLOAD_MANIFEST_VERSION = 'baton.skills-payload/v1';

export const OPERATIONS = Object.freeze([
  Object.freeze({
    name: 'baton-plan',
    source: 'operations/baton-plan.md',
    description:
      'Plan small, checkable work for someone else to approve.',
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
      'Explain an approach or build approved work.',
    resources: Object.freeze([]),
  }),
  Object.freeze({
    name: 'baton-design-review',
    source: 'operations/baton-design-review.md',
    description:
      'Check an approach before implementation starts.',
    resources: Object.freeze([]),
  }),
  Object.freeze({
    name: 'baton-verify',
    source: 'operations/baton-verify.md',
    description:
      'Independently check finished work from a fresh, read-only context.',
    resources: Object.freeze([]),
  }),
  Object.freeze({
    name: 'baton-merge',
    source: 'operations/baton-merge.md',
    description:
      'Combine passed work and merge exactly what the Verifier approved.',
    resources: Object.freeze([]),
  }),
]);

export const GENERATED_BEGIN = '<!-- BATON_CANONICAL_BEGIN';
export const GENERATED_END = '<!-- BATON_CANONICAL_END';
