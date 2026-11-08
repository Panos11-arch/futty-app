// Fails unless every money file under supabase/functions/_shared/ (a file or
// folder named money*) has 100% line coverage. CI runs it after
// `deno test --coverage` + `deno coverage --lcov`:
//
//   deno run --allow-read supabase/functions/_scripts/check-money-coverage.ts coverage/deno.lcov
//
// A file no test imports is absent from the lcov report rather than at 0%,
// so files are listed from disk and a missing one fails too.
import { join, relative, resolve } from 'node:path';

const sharedDir = resolve(import.meta.dirname!, '..', '_shared');
const lcovPath = Deno.args[0];
if (!lcovPath) {
  console.error('usage: check-money-coverage.ts <lcov file>');
  Deno.exit(2);
}

function* walk(dir: string): Generator<string> {
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* walk(path);
    else if (entry.isFile) yield path;
  }
}

const key = (path: string) => resolve(path).replaceAll('\\', '/').toLowerCase();

const moneyFiles = [...walk(sharedDir)].filter((path) => {
  const rel = relative(sharedDir, path).replaceAll('\\', '/');
  return rel.startsWith('money') && rel.endsWith('.ts') && !rel.endsWith('.test.ts');
});

if (moneyFiles.length === 0) {
  console.log('No money files under supabase/functions/_shared/ yet; nothing to check.');
  Deno.exit(0);
}

// lcov: one record per file, "SF:<path>" ... "LF:<lines found>" "LH:<lines hit>" ... "end_of_record".
const coverage = new Map<string, { found: number; hit: number }>();
let current = '';
for (const line of Deno.readTextFileSync(lcovPath).split(/\r?\n/)) {
  if (line.startsWith('SF:')) {
    let path = line.slice(3);
    if (path.startsWith('file://')) path = decodeURIComponent(new URL(path).pathname).replace(/^\/([A-Za-z]:)/, '$1');
    current = key(path);
    coverage.set(current, { found: 0, hit: 0 });
  } else if (line.startsWith('LF:')) coverage.get(current)!.found = Number(line.slice(3));
  else if (line.startsWith('LH:')) coverage.get(current)!.hit = Number(line.slice(3));
}

let failed = false;
for (const file of moneyFiles) {
  const name = relative(resolve(sharedDir, '..', '..', '..'), file).replaceAll('\\', '/');
  const lines = coverage.get(key(file));
  if (!lines) {
    console.error(`FAIL ${name}: not covered by any test`);
    failed = true;
  } else if (lines.hit < lines.found) {
    const percent = ((100 * lines.hit) / lines.found).toFixed(1);
    console.error(`FAIL ${name}: ${lines.hit}/${lines.found} lines (${percent}%), needs 100%`);
    failed = true;
  } else {
    console.log(`ok   ${name}: ${lines.hit}/${lines.found} lines`);
  }
}
Deno.exit(failed ? 1 : 0);
