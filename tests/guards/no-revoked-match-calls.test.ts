// S13B revokes the old score and 1-10 rating functions from the app's role
// (they are service_role only). Nothing in the app may call them: an
// installed build that still did would fail.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const REVOKED = ['submit_match_result', 'respond_to_match_result', 'set_match_goals', 'rate_match_player', 'get_match_ratings'];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

const SOURCES = ['app', 'components', 'lib', 'supabase/functions'].flatMap((d) => files(path.join(ROOT, d)));

describe('no app code calls a function S13B revoked', () => {
  it('reads the app and the Edge Functions', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  it.each(REVOKED)('%s is never called with rpc()', (fn) => {
    const hits = SOURCES.filter((f) => new RegExp(`rpc\\(\\s*['"\`]${fn}['"\`]`).test(fs.readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
