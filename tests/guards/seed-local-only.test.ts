// supabase/seed.sql is local data only (made-up users with a shared
// password, fake Stripe ids). `supabase db reset` and `supabase db start`
// load it; `supabase db push` only does with --include-seed. This keeps
// that flag out of every script, workflow and doc, and checks the seed's own
// last guard: its first statement stops it on a database that has users.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'web-build', 'ios', 'android', 'coverage']);
/** The files that explain the rule name the flag on purpose. */
const EXPLAINS = new Set(['supabase/seed.sql', 'tests/guards/seed-local-only.test.ts', 'docs/app-store-screenshots.md']);

function files(dir = '', out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files(rel, out);
    } else if (/\.(ts|tsx|js|mjs|cjs|json|ya?ml|toml|sh|sql|md)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const seed = fs.readFileSync(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8');

it('nothing pushes the seed to a remote database', () => {
  const pushing = files().filter(
    (f) => !EXPLAINS.has(f) && fs.readFileSync(path.join(ROOT, f), 'utf8').includes('--include-seed'),
  );
  expect(pushing).toEqual([]);
});

it('the seed only loads through the local config', () => {
  const config = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
  expect(config).toMatch(/\[db\.seed\][\s\S]*sql_paths\s*=\s*\["\.\/seed\.sql"\]/);
});

it("the seed's first statement refuses a database that already has users", () => {
  const code = seed
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
  expect(code).toMatch(/^do \$\$\s*begin\s*if exists \(select 1 from auth\.users\) then\s*raise exception/);
});

it('the seed uses fake Stripe ids only', () => {
  expect(seed).not.toMatch(/\b(pi|pm|acct|cus)_(live|test)_\w+/);
  expect(seed).not.toMatch(/\bsk_(live|test)_/);
});
