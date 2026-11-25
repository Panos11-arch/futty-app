// Patches in patches/ are applied to node_modules by patch-package on every
// install, including EAS builds, so they ship in the app. Debugging code
// must never be left in one: the expo-router patch from September only
// added "DIAG" errors (it threw on re-entrant route loads and replaced
// expo-router's own error handling), and it went unnoticed for two months.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PATCHES = join(__dirname, '..', '..', 'patches');
const patches = readdirSync(PATCHES).filter((f) => f.endsWith('.patch'));

describe('patches/', () => {
  it('has no debugging code in any patch', () => {
    for (const file of patches) {
      const added = readFileSync(join(PATCHES, file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
      expect({ file, debug: added.filter((l) => /\bDIAG\b|__diag|console\.log/.test(l)) }).toEqual({ file, debug: [] });
    }
  });

  it('does not patch expo-router (stock 55.0.17 route loading)', () => {
    expect(patches.filter((f) => f.startsWith('expo-router+'))).toEqual([]);
  });
});
