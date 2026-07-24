#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const behavior = process.argv[2];

if (behavior === 'crash') {
  process.stderr.write('fixture process exited before producing a result\n');
  process.exitCode = 17;
} else if (behavior === 'missing-result') {
  process.exitCode = 0;
} else if (behavior === 'stderr-noise') {
  process.stderr.write('fixture transport diagnostic\n');
  process.stdout.write(readFileSync(
    new URL('./valid-completed-result.json', import.meta.url),
  ));
} else {
  process.stderr.write('unknown fixture behavior\n');
  process.exitCode = 64;
}
