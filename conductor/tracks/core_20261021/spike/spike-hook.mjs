// Spike SessionStart hook: proves MM_* env from --settings reaches hooks.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const seen = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('MM_')));
writeFileSync(join(import.meta.dirname, 'spike-hook-env.json'), JSON.stringify(seen, null, 2));
process.stdout.write(`SessionStart hook saw: ${JSON.stringify(seen)}`);
