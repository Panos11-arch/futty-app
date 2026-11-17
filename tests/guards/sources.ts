// The files the U8 guards read (docs/specs/17-ui-prompts.md). Not a test:
// shared by tokens-only, copy and accessibility.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.join(__dirname, '..', '..');

/** Tests and fixtures may quote what a screen must never show. The dev
 *  gallery (app/dev/) only exists when __DEV__ is true and never ships. */
const SKIPPED = [/\.test\.tsx?$/, /\.fixtures\.ts$/, /\/__snapshots__\//, /^app\/dev\//];

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !SKIPPED.some((re) => re.test(rel))) out.push(rel);
  }
  return out;
}

const read = (files: string[]) =>
  files.sort().map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')] as [string, string]);

/** Every source file under app/ and components/. */
export const ALL_SOURCES = read([...walk('app', []), ...walk('components', [])]);

/** The same, without components/ui (which owns the tokens). */
export const NON_UI_SOURCES = ALL_SOURCES.filter(([f]) => !f.startsWith('components/ui/'));
