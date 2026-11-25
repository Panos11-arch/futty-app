// U8 (docs/specs/17-ui-prompts.md, and the rules for every prompt): the app's
// words never say "authorize", "capture" or "void", never "Submit", and
// never shout. This checks every string a file in app/, components/ or lib/
// can put on screen or in a share message: JSX text and every literal that
// reads like prose (on-screen-strings.ts). Single lower-case tokens such as
// 'authorized' or 'void' are status keys, not words anyone reads.
import fs from 'node:fs';
import path from 'node:path';

import { screenStrings } from './on-screen-strings';
import { ALL_SOURCES, ROOT } from './sources';

const SKIPPED = [/\.test\.tsx?$/, /\.fixtures\.ts$/];

function libSources(dir = 'lib', out: [string, string][] = []): [string, string][] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) libSources(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !SKIPPED.some((re) => re.test(rel))) {
      out.push([rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')]);
    }
  }
  return out;
}

const SOURCES = [...ALL_SOURCES, ...libSources()];

const RULES = {
  /** Money words from section 3 of 15: "held", "charged", "released". */
  'a payment word players never see': /(?<!\w)(authori[sz]|captur|void)[a-z]*(?!\w)/i,
  'the word Submit': /\bSubmit\b/,
  // A ! that ends a sentence or the string. A ! followed by a letter is a
  // Supabase join hint (teams!fixtures_home_team_id_fkey), never shown.
  'an exclamation mark': /!(?=$|[\s"'’)\].,])/,
} as const;

type Rule = keyof typeof RULES;

const offences = (rule: Rule, file: string, text: string) =>
  screenStrings(file, text)
    .filter((s) => RULES[rule].test(s.text))
    .map((s) => `${file}:${s.line}: ${s.text}`);

describe('the copy check', () => {
  it('reads app/, components/ (with components/ui) and lib/', () => {
    expect(SOURCES.map(([f]) => f)).toEqual(
      expect.arrayContaining([
        'app/(tabs)/index.tsx',
        'components/ui/button.tsx',
        'components/match/log-score-card.tsx',
        'lib/booking-errors.ts',
        'lib/invite.ts',
      ]),
    );
  });

  it.each([
    ['a payment word players never see', '<Text>We authorize the card</Text>'],
    ['a payment word players never see', "const m = 'Payment authorised';"],
    ['a payment word players never see', "<Button label='Capture now' />"],
    ['a payment word players never see', 'const m = `The booking was voided for ${name}`;'],
    ['the word Submit', '<Button label="Submit" />'],
    ['the word Submit', "<Button label='Submit score' />"],
    ['an exclamation mark', '<Text>Great game!</Text>'],
    ['an exclamation mark', 'const m = `Welcome, ${name}!`;'],
    ['an exclamation mark', "return 'Done! See you there.';"],
  ] as const)('catches %s in `%s`', (rule, sample) => {
    expect(offences(rule, 'planted.tsx', sample)).not.toEqual([]);
  });

  it.each([
    "if (status === 'authorized') return null;",
    "switch (s) { case 'void': return 'Cancelled'; }",
    "type S = 'captured' | 'void';",
    "const q = supabase.from('payments').select('id, captured_at, authorized_at');",
    'if (!ready && a !== b) return null;',
    "import { submitReport } from '@/lib/moderation';",
    "<Text>Report submitted, thanks.</Text>",
    "<Text>Avoid the queue</Text>",
    "select('id, home_team:teams!league_fixtures_home_team_id_fkey(id, name)')",
  ])('lets code through: `%s`', (sample) => {
    for (const rule of Object.keys(RULES) as Rule[]) {
      expect(offences(rule, 'planted.tsx', sample)).toEqual([]);
    }
  });
});

describe.each(SOURCES)('%s', (file, text) => {
  it.each(Object.keys(RULES) as Rule[])('never shows %s', (rule) => {
    expect(offences(rule, file, text)).toEqual([]);
  });
});
