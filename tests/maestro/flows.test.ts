// Keeps the Maestro flows (.maestro, docs/testing/maestro.md) honest
// without a device:
// - every file is valid YAML with the app's id;
// - every id a flow taps or checks is a testID the app really has;
// - the words and amounts the flows expect are what the app shows for the
//   seeded booking (spec 13's €60 5-a-side, the booker paying for everyone).
import fs from 'node:fs';
import path from 'node:path';

import { loadAll } from 'js-yaml';

import { payLabel } from '@/components/booking/checkout-parts';
import { cancelledMessage, describeQuote } from '@/lib/booking-detail';
import type { CancellationQuote } from '@/lib/booking-actions';

import { E2E_PRICE_CENTS, E2E_VENUE } from '../../scripts/e2e-seed/config';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/calendar', () => ({ addBookingToCalendar: jest.fn(), syncBookingInCalendar: jest.fn() }));
jest.mock('@/lib/auth-storage', () => ({ authStorage: undefined }));

const root = path.join(__dirname, '..', '..');
const maestroDir = path.join(root, '.maestro');

function filesUnder(dir: string, test: (f: string) => boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? (e.name === 'node_modules' ? [] : filesUnder(p, test)) : test(p) ? [p] : [];
  });
}

const flowFiles = filesUnder(maestroDir, (f) => f.endsWith('.yaml') && path.basename(f) !== 'config.yaml');
const read = (f: string) => fs.readFileSync(f, 'utf8');

/** Every id: the flows use, as written (with ${VARS} and regex). */
function flowIds(): { file: string; id: string }[] {
  return flowFiles.flatMap((file) =>
    [...read(file).matchAll(/^\s*(?:-\s*)?id:\s*'?([^'\n]+?)'?\s*$/gm)].map((m) => ({ file: path.relative(root, file), id: m[1] })),
  );
}

/** One concrete id for a flow's id, with sample values for its variables. */
function sample(id: string): string {
  return id
    .replace('${DAY}', '2026-11-23')
    .replace('${START}', '1900')
    .replace('${VENUE_ID}', E2E_VENUE.id)
    .replace('${TAB}', 'profile')
    .replace('[0-9a-f-]{36}', 'b6c2c1b8-6f0d-4e8e-9a43-2a4d7c1f0b11')
    .replace('.*', 'confirmed');
}

/** Every testID in the app's source, as a regular expression. */
function appTestIds(): RegExp[] {
  const sources = [...filesUnder(path.join(root, 'app'), (f) => f.endsWith('.tsx')), ...filesUnder(path.join(root, 'components'), (f) => f.endsWith('.tsx'))]
    .filter((f) => !/\.test\.tsx$/.test(f))
    .map(read)
    .join('\n');
  const literal = [...sources.matchAll(/(?:testID|actionTestID|tabBarButtonTestID)[=:]\s*\{?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const templates = [...sources.matchAll(/(?:testID|actionTestID)[=:]\s*\{?\s*`([^`]+)`/g)].map((m) => m[1]);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    ...literal.map((s) => new RegExp(`^${escape(s)}$`)),
    // A template that starts with a variable (`${testPrefix}-${t}`) gets its
    // prefix from its caller, so on its own it would match almost anything.
    ...templates
      .filter((t) => !t.startsWith('${'))
      .map((t) => new RegExp(`^${t.split(/\$\{[^}]+\}/).map(escape).join('.+')}$`)),
  ];
}

describe('.maestro', () => {
  it('has the three journeys and their subflows', () => {
    const names = flowFiles.map((f) => path.relative(maestroDir, f).replace(/\\/g, '/')).sort();
    expect(names).toEqual([
      'flows/book-and-pay.yaml',
      'flows/cancel.yaml',
      'flows/sign-in.yaml',
      'subflows/open-my-booking.yaml',
      'subflows/open-tab.yaml',
      'subflows/sign-in.yaml',
      'subflows/stripe-test-card.yaml',
    ]);
  });

  it.each(flowFiles.map((f) => [path.relative(root, f), f]))('%s is valid YAML for the app', (_name, file) => {
    // Throws on invalid YAML.
    const docs = loadAll(read(file)) as [{ appId?: string }, unknown];
    expect(docs).toHaveLength(2);
    expect(docs[0].appId).toBe('com.panosalepis.futtyapp');
    expect(Array.isArray(docs[1])).toBe(true);
  });

  it('each journey ends with a screenshot', () => {
    for (const name of ['sign-in', 'book-and-pay', 'cancel']) {
      const steps = loadAll(read(path.join(maestroDir, 'flows', `${name}.yaml`)))[1] as unknown[];
      expect(steps[steps.length - 1]).toEqual({ takeScreenshot: `${name}-\${PLATFORM}` });
    }
  });

  it('every id a flow uses is a testID the app has', () => {
    const ids = appTestIds();
    // The starting-level skip is Anghelo's (components/match), already there.
    const missing = flowIds().filter(({ id }) => !ids.some((re) => re.test(sample(id))));
    expect(missing).toEqual([]);
  });
});

describe('what the flows expect is what the app shows', () => {
  const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
  const expected = (file: string, pattern: RegExp) =>
    [...read(path.join(maestroDir, file)).matchAll(pattern)].map((m) => unescape(m[1]));

  it('book-and-pay: Pay €65.50, spec 13’s €60 5-a-side with the booker paying for everyone', () => {
    expect(E2E_PRICE_CENTS).toBe(6000);
    // Spec 13 "Prices and fees": 5 v 5, booker pays all, €65.50 in one payment.
    expect(payLabel(6550)).toBe('Pay €65.50');
    expect(expected('flows/book-and-pay.yaml', /text: '(Pay [^']+)'/g)).toEqual(['Pay €65.50']);
    expect(expected('flows/book-and-pay.yaml', /PAY_LABEL: '([^']+)'/g)).toEqual(['Pay €65.50']);
  });

  it('cancel: the free-hour quote for a booker who paid for everyone, as the server sends it', () => {
    // cancellation_quote(booking, 'whole_team') on the local database for a
    // €60 pay-all booking paid 2 minutes before (ids shortened).
    const quote = {
      lines: [
        {
          action: 'release',
          window: 'free',
          share_id: 's1',
          fee_cents: 550,
          is_booker: true,
          cash_cents: 0,
          kept_cents: 0,
          paid_cents: 6550,
          profile_id: 'p1',
          value_cents: 6550,
          credit_cents: 0,
          guarantee_id: null,
          refund_cents: 6550,
          needs_capture: false,
          cash_back_cents: 0,
          stripe_intent_id: 'pi_1',
          cash_credit_cents: 0,
          credit_used_cents: 0,
        },
      ],
      quote: 'q',
      scope: 'whole_team',
      booker_fee: null,
      booking_id: 'b1',
      kickoff_at: '2026-11-23T19:00:00+02:00',
      payment_mode: 'pay_all',
      cancels_booking: true,
      refunds_stop_at: '2026-11-23T13:00:00+02:00',
    } as unknown as CancellationQuote;

    const lines = describeQuote(quote, E2E_VENUE.name);
    expect(lines).toEqual(['The booking is cancelled and the pitch is released.', 'You get €65.50 back. The hold on your card is released.']);
    expect(expected('flows/cancel.yaml', /id: cancel-quote-line-\d+\n\s+text: '([^']+)'/g)).toEqual(lines);
    expect(read(path.join(maestroDir, 'flows/cancel.yaml'))).toContain(`id: cancel-quote-line-${lines.length}`);

    const notice = cancelledMessage('whole_team', { cancelled: true, fee: null });
    expect(notice).toBe('The booking is cancelled.');
    expect(expected('flows/cancel.yaml', /- text: '(The booking is cancelled\\\.)'/g)).toEqual([notice]);
  });
});
