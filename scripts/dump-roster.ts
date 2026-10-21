// Prints the whole roster as JSON for manual checks. Usage: node scripts/dump-roster.ts  (honours MM_ROSTER_DB)
import { openRoster } from '../src/roster/db.ts';

const db = openRoster();
const tables = ['projects', 'workstreams', 'sessions', 'goals', 'items', 'claims', 'spend'];
const dump = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
db.close();
console.log(JSON.stringify(dump, null, 2));
