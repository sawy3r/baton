#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parsePlanBytes,
  parseReceiptCommitMessage,
} from '../reference/records/receipts.mjs';

const [kind, relativePath] = process.argv.slice(2);
const validators = new Map([
  ['plan', parsePlanBytes],
  ['receipt-commit', parseReceiptCommitMessage],
]);

if (!validators.has(kind) || !relativePath) {
  process.stderr.write('USAGE\n');
  process.exitCode = 2;
} else {
  try {
    const bytes = await readFile(path.resolve(process.cwd(), relativePath));
    validators.get(kind)(bytes);
  } catch (error) {
    process.stderr.write(`${error?.code ?? 'VALIDATION_ERROR'}\n`);
    process.exitCode = 1;
  }
}
