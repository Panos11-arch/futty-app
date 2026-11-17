// P10: spec 13's numbers live once, in public.app_rules. This scans the app
// and the Edge Functions for copies: the old constants, the old wrong facts,
// and spec 13 durations or fees written into code. A rule's number belongs in
// app_rules, read through lib/rules.ts (app) or _shared/rules.ts (Edge
// Functions). Tests, fixtures and the dev component gallery are skipped; the
// database is checked by supabase/tests/pay-app-rules-3-no-literals.test.sql.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const SCANNED = ['app', 'lib', 'components', 'hooks', 'constants', 'supabase/functions'];
const SKIPPED = [/\.test\.tsx?$/, /\.fixtures\.ts$/, /^app\/dev\//, /\/_scripts\//, /node_modules/];

function sources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name) && !SKIPPED.some((re) => re.test(rel))) {
        out.push([rel, fs.readFileSync(path.join(root, rel), 'utf8')]);
      }
    }
  };
  for (const dir of SCANNED) if (fs.existsSync(path.join(root, dir))) walk(dir);
  return out;
}

/** Code without comments, line by line (so line numbers stay right):
 *  explanations may still name the rules. */
function code(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
      return line.replace(/\s\/\/ .*$/, '');
    })
    .join('\n');
}

/** Phrases that look like a spec 13 rule but aren't one, each with why.
 *  `file: '*'` matches every file. Keep this list short and specific. */
const ALLOWED: { file: string; text: string; why: string }[] = [
  {
    file: '*',
    text: "=== 1 ? '1 ",
    why: 'A wording helper\'s singular ("1 hour" when the number it is given is 1), not a rule.',
  },
  {
    file: 'supabase/functions/futty-ai-chat/handler.ts',
    text: 'Defaults to 1 hour if not specified.',
    why: "The AI tool's default game length for a search, not a spec 13 rule.",
  },
  {
    file: 'supabase/functions/futty-ai-chat/prompt.ts',
    text: 'Example only: on a €60 pitch, €6.00 a player becomes €5.00, so €1.00 each.',
    why:
      "Spec 13's worked example for switching 5 v 5 to 6 v 6 (decided 16 November to keep it in the prompt): " +
      'a pitch-price difference on a €60 pitch, not the cancellation fee. The prompt says so, and the fee next to it is built from app_rules.',
  },
  {
    file: 'supabase/functions/futty-ai-chat/prompt.ts',
    text: '(on the same €60 example, €1.00 each)',
    why: 'The same worked example, for switching 6 v 6 to 5 v 5.',
  },
  {
    file: 'lib/notifications.ts',
    text: "match_reminder_2h: '2 hours before a game'",
    why: 'A match reminder setting (match record, docs/specs/match-record.md), not a spec 13 rule.',
  },
];

function hits(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const [file, text] of sources()) {
    code(text)
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(pattern)) {
          if (ALLOWED.some((a) => (a.file === '*' || a.file === file) && line.includes(a.text))) continue;
          found.push(`${file}:${i + 1}: ${m[0]}`);
        }
      });
  }
  return found;
}

describe('no copies of spec 13 rules outside app_rules', () => {
  it('scans the app and the Edge Functions', () => {
    const files = sources().map(([f]) => f);
    expect(files).toEqual(expect.arrayContaining(['lib/rules.ts', 'lib/booking-errors.ts', 'supabase/functions/futty-ai-chat/prompt.ts']));
  });

  it('the old constants are gone', () => {
    expect(
      hits(
        /\b(SERVICE_FEE_CENTS|STANDARD_ADVANCE_DAYS|PREMIUM_ADVANCE_DAYS|PERSONAL_PREMIUM_PRICE_LABEL|isDayLocked|FEE_EACH_PAYS_CENTS|FEE_PAY_ALL_CENTS|CANCEL_KEEP_PER_PLAYER_CENTS|service_fee_cents\(\))\b/g,
      ),
    ).toEqual([]);
  });

  it('the old wrong facts are gone, and the Premium price is only in app_rules', () => {
    expect(hits(/€4\.99|€3\.99|21 days|30 minutes before kickoff|just 2\b/g)).toEqual([]);
  });

  it('no spec 13 duration is written into code', () => {
    expect(hits(/\b\d+ (hours?|minutes?|days?|months?)\b/g)).toEqual([]);
  });

  it('no spec 13 fee is written into code', () => {
    expect(hits(/€0\.80|€0\.55|€1\.00\b|\b(80|55)\b(?= ?(cents|per player))/g)).toEqual([]);
  });
});
