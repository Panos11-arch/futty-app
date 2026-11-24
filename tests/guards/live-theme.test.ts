// S1 (docs/specs/15-design.md sections 0.2 to 0.4): light and dark mode and
// the Accessibility settings only reach a screen through the live theme. A
// screen that imports a fixed palette or the fixed type scale would stay
// light, or ignore the text size, so this fails the build on it. Haptics go
// through lib/haptics.ts so the Haptics switch covers every one.
import fs from 'node:fs';
import path from 'node:path';

import { ALL_SOURCES, ROOT } from './sources';

/** Exported from constants/futty-theme.ts but fixed: screens use useTheme() or makeStyles(). */
const FIXED = ['colors', 'type', 'lightPalette', 'darkPalette', 'paletteFor'];

/**
 * The only files allowed a fixed look, each with its reason.
 * share-card draws the PNG players post on Instagram: it must look the same
 * whatever the viewer's theme or text size.
 */
const ALLOWED = new Map([['components/match/share-card.tsx', 'the exported share image is always light, at 100%']]);

function fixedImports(text: string): string[] {
  const out: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*'@\/constants\/futty-theme'/g;
  for (const m of text.matchAll(re)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      if (!name || name.startsWith('type ')) continue;
      const local = name.split(/\s+as\s+/)[0].trim();
      if (FIXED.includes(local)) out.push(local);
    }
  }
  if (/import\s*\*\s*as\s+\w+\s+from\s*'@\/constants\/futty-theme'/.test(text)) out.push('* as');
  return out;
}

describe('the live-theme scan', () => {
  it.each([
    ["import { colors, space } from '@/constants/futty-theme';", ['colors']],
    ["import { space, type } from '@/constants/futty-theme';", ['type']],
    ["import { lightPalette as p } from '@/constants/futty-theme';", ['lightPalette']],
    ["import * as theme from '@/constants/futty-theme';", ['* as']],
  ])('catches a planted fixed import: `%s`', (sample, expected) => {
    expect(fixedImports(sample)).toEqual(expected);
  });

  it.each([
    "import { radius, space, type TypeVariant } from '@/constants/futty-theme';",
    "import { hairline, tabular, kitColours } from '@/constants/futty-theme';",
  ])('lets fixed-for-every-theme tokens through: `%s`', (sample) => {
    expect(fixedImports(sample)).toEqual([]);
  });

  it('every allowed file still exists', () => {
    for (const file of ALLOWED.keys()) expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  });
});

describe.each(ALL_SOURCES.filter(([f]) => !ALLOWED.has(f)))('%s reads the live theme', (_file, text) => {
  it('imports no fixed palette or type scale', () => {
    expect(fixedImports(text)).toEqual([]);
  });

  it('calls haptics only through lib/haptics', () => {
    expect(text).not.toMatch(/from 'expo-haptics'/);
  });
});

describe('lib/', () => {
  it('only lib/haptics.ts imports expo-haptics', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/from 'expo-haptics'/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) hits.push(rel);
        }
      }
    };
    walk('lib');
    expect(hits).toEqual(['lib/haptics.ts']);
  });
});
