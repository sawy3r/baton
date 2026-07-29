import { createHash } from 'node:crypto';

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function digestEntries(entries) {
  const normalized = [...entries]
    .map((entry) => ({
      path: entry.path,
      digest: entry.digest,
    }))
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  return sha256(Buffer.from(`${JSON.stringify(normalized)}\n`));
}

export function stableJSON(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}
