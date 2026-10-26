import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const f of files) {
    const r = spawnSync(process.execPath, [path.join(root, 'tests', f)], { stdio: 'inherit', cwd: root });
    if (r.status !== 0) { failed += 1; console.error('FAILED: ' + f); }
}
console.log(failed ? `\n${failed} of ${files.length} test files failed` : `\nAll ${files.length} test files passed.`);
process.exit(failed ? 1 : 0);
