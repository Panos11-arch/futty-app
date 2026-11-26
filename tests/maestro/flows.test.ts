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

import { E2E_PRICE_CENTS, E2E_STAFF, E2E_STAFF_BOOKING, E2E_VENUE } from '../../scripts/e2e-seed/config';
import { clashTime, clashTitle, counterClashSummary, type CounterClash } from '@/lib/venue-today';

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
    [...read(file).matchAll(/^\s*(?:-\s*)?id:\s*'?([^'\r\n]+?)'?\s*$/gm)].map((m) => ({ file: path.relative(root, file), id: m[1] })),
  );
}

/** One concrete id for a flow's id, with sample values for its variables. */
function sample(id: string): string {
  return id
    .replace('${DAY}', '2026-11-23')
    .replace('${TODAY}', '2026-11-21')
    .replace('${START}', '1900')
    .replace('${VENUE_ID}', E2E_VENUE.id)
    .replace('${PITCH}', E2E_STAFF[0].pitchId)
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
  it('has the sixteen journeys and their subflows', () => {
    const names = flowFiles.map((f) => path.relative(maestroDir, f).replace(/\\/g, '/')).sort();
    expect(names).toEqual([
      'flows/appearance.yaml',
      'flows/block-clashes.yaml',
      'flows/book-and-pay.yaml',
      'flows/book-missing-venue.yaml',
      'flows/cancel.yaml',
      'flows/edit-avatar.yaml',
      'flows/find-match.yaml',
      'flows/futty-ai.yaml',
      'flows/leagues.yaml',
      'flows/log-score.yaml',
      'flows/messages.yaml',
      'flows/navigation.yaml',
      'flows/player-card.yaml',
      'flows/profile.yaml',
      'flows/sign-in.yaml',
      'flows/venue-book-and-pay.yaml',
      'subflows/open-my-booking.yaml',
      'subflows/open-tab.yaml',
      'subflows/sign-in.yaml',
      'subflows/stripe-test-card.yaml',
      'subflows/weather-settled.yaml',
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
    for (const name of ['sign-in', 'book-and-pay', 'cancel', 'appearance', 'navigation', 'messages', 'book-missing-venue', 'find-match', 'log-score', 'edit-avatar', 'player-card', 'block-clashes']) {
      const steps = loadAll(read(path.join(maestroDir, 'flows', `${name}.yaml`)))[1] as unknown[];
      expect(steps[steps.length - 1]).toEqual({ takeScreenshot: `${name}-\${PLATFORM}` });
    }
  });

  // S4: a card opens the venue page, so checkout is reached from the card's
  // seeded start time, on the seeded day only.
  it('book-and-pay books from the seeded time on the card, with only the seeded day searched', () => {
    const text = read(path.join(maestroDir, 'flows', 'book-and-pay.yaml')).replace(/\r\n/g, '\n');
    expect(text).toContain('tapOn:\n    id: book-venue-${VENUE_ID}-time-${DAY}-${START}');
    expect(text).not.toMatch(/tapOn:\n {4}id: free-venue-\$\{VENUE_ID\}\n/);
    expect(text.indexOf('id: book-day-${TODAY}')).toBeGreaterThan(text.indexOf('id: book-day-${DAY}'));
  });

  it('every id a flow uses is a testID the app has', () => {
    const ids = appTestIds();
    // The starting-level skip is Anghelo's (components/match), already there.
    const missing = flowIds().filter(({ id }) => !ids.some((re) => re.test(sample(id))));
    expect(missing).toEqual([]);
  });
});

describe('the sign-in subflow gets past iOS', () => {
  // After a password sign-in, iOS asks "Save Password?" over Home, and Maestro
  // can't see home-screen under it (preview run, 23 November).
  it('dismisses "Save Password?" before it looks for Home', () => {
    const subflow = read(path.join(maestroDir, 'subflows', 'sign-in.yaml'));
    const dismiss = subflow.indexOf("text: 'Not Now'");
    const submit = subflow.indexOf('id: sign-in-submit');
    const home = subflow.indexOf('id: home-screen');
    expect(dismiss).toBeGreaterThan(submit);
    expect(dismiss).toBeLessThan(home);
  });
});

describe('taps wait for the weather strip', () => {
  // Checkout and the booking detail show a two-line placeholder while the
  // forecast loads, then the strip (or nothing), and everything under it
  // moves. A tap aimed before that lands where the button used to be: the
  // preview run's "Pay for everyone" tap chose nothing (23 November).
  const order = (file: string, ...needles: string[]) => {
    // A Windows checkout (core.autocrlf=true) has CRLF line endings.
    const text = read(path.join(maestroDir, file)).replace(/\r\n/g, '\n');
    return needles.map((n) => text.indexOf(n));
  };

  it('weather-settled waits until the placeholder has gone', () => {
    const steps = loadAll(read(path.join(maestroDir, 'subflows', 'weather-settled.yaml')))[1];
    expect(steps).toEqual([{ extendedWaitUntil: { notVisible: { id: 'weather-strip-loading' }, timeout: 30000 } }]);
  });

  // S5: the strip sits under the venue page's pitches (Book tab); the
  // payment sheet has none.
  it.each(['flows/book-and-pay.yaml', 'flows/venue-book-and-pay.yaml'])(
    '%s: before the first tap on the pitches (the pitch, Continue, whole pitch, who pays)',
    (file) => {
      const [seen, settled, pitch, next, whole, payAll] = order(
        file,
        'id: venue-book-pitch-1',
        'weather-settled.yaml',
        'tapOn:\n    id: venue-book-pitch-1',
        'tapOn:\n    id: venue-book\n',
        'tapOn:\n    id: checkout-kind-whole',
        'tapOn:\n    id: checkout-who-pay-all',
      );
      expect(seen).toBeGreaterThan(-1);
      expect(settled).toBeGreaterThan(seen);
      expect(pitch).toBeGreaterThan(settled);
      expect(next).toBeGreaterThan(pitch);
      expect(whole).toBeGreaterThan(next);
      expect(payAll).toBeGreaterThan(whole);
    },
  );

  it('cancel: before scrolling to Cancel', () => {
    const [settled, scroll] = order('flows/cancel.yaml', 'weather-settled.yaml', 'id: booking-detail-cancel-whole-team');
    expect(settled).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(settled);
  });
});

describe("Stripe's payment sheet", () => {
  type Flow = { when?: { platform?: string; visible?: string; notVisible?: string }; commands?: Record<string, unknown>[] };
  const steps = () => loadAll(read(path.join(maestroDir, 'subflows', 'stripe-test-card.yaml')))[1] as Record<string, unknown>[];
  const branch = (platform: string) =>
    steps()
      .map((s) => s.runFlow as Flow | undefined)
      .find((f) => f?.when?.platform === platform && !f.when.visible && !f.when.notVisible)!.commands!;
  const inner = (commands: Record<string, unknown>[], key: 'visible' | 'notVisible') =>
    commands.map((c) => c.runFlow as Flow | undefined).find((f) => f?.when?.[key])!;

  // On Android the sheet lists the ways to pay (Card, Amazon Pay, Satispay)
  // and opens the card form only after "Card" (preview run, 23 November).
  it('opens the card form from the list of ways to pay, when the sheet shows one', () => {
    const list = steps()
      .map((s) => s.runFlow as Flow | undefined)
      .find((f) => f?.when?.visible === 'Card');
    expect(list?.commands).toEqual([{ tapOn: 'Card' }]);
    const names = steps().map((s) => JSON.stringify(s));
    const openCard = names.findIndex((n) => n.includes('"tapOn":"Card"'));
    const typed = names.findIndex((n) => n.includes('inputText'));
    expect(openCard).toBeGreaterThan(-1);
    expect(openCard).toBeLessThan(typed);
  });

  it('pays in a branch per platform, with no bare hideKeyboard or Pay tap outside them', () => {
    const top = steps().map((s) => Object.keys(s)[0]);
    expect(top).not.toContain('hideKeyboard');
    expect(top).not.toContain('scrollUntilVisible');
    expect(JSON.stringify(steps().filter((s) => 'tapOn' in s))).not.toContain('PAY');
  });

  // iOS's number pad has no key that closes it, so hideKeyboard fails, and
  // Maestro can't find iOS's Done over the pad. Stripe's sheet ends editing
  // on a tap anywhere that isn't a control (BottomSheetViewController.
  // didTapAnywhere), so tap its heading, then scroll to Pay (half visible is
  // enough) and tap it. This path paid on the iPhone (preview run, 23 November).
  it('iOS: taps the heading, scrolls to Pay and taps it', () => {
    const ios = branch('iOS');
    expect(ios[0]).toEqual({ tapOn: 'Card information' });
    expect(ios[1]).toEqual({
      scrollUntilVisible: { element: { text: '${PAY_LABEL}' }, direction: 'DOWN', visibilityPercentage: 50, timeout: 15000 },
    });
    expect(ios[2]).toEqual({ tapOn: { text: '${PAY_LABEL}', retryTapIfNoChange: true } });
  });

  // Android: Stripe's Pay was on screen but Maestro never matched
  // "Pay €65\.50" (preview runs, 23 November). Scroll to the end of the
  // sheet, tap a looser match on the amount, and if even that isn't found,
  // tap the button under the card-use notice that sits right above it.
  it('Android: hides the keyboard, scrolls to the end and taps Pay by its amount, else under the notice', () => {
    const android = branch('Android');
    expect(android[0]).toBe('hideKeyboard');
    const pay = '.*Pay.*${PAY_AMOUNT}.*';
    expect(inner(android, 'visible')).toEqual({
      when: { visible: pay },
      commands: [{ tapOn: { text: pay, retryTapIfNoChange: true } }],
    });
    expect(inner(android, 'notVisible')).toEqual({
      when: { notVisible: pay },
      commands: [{ tapOn: { below: '.*By providing your card information.*', retryTapIfNoChange: true } }],
    });
    const order = android.map((c) => JSON.stringify(c));
    expect(order.findIndex((c) => c.includes('scroll'))).toBeLessThan(order.findIndex((c) => c.includes('visible')));
  });

  it('book-and-pay passes the same amount as the label', () => {
    const text = read(path.join(maestroDir, 'flows', 'book-and-pay.yaml'));
    expect(text).toContain("PAY_LABEL: 'Pay €65\\.50'");
    expect(text).toContain("PAY_AMOUNT: '65\\.50'");
  });
});

describe('book-and-pay ends on the confirmed booking', () => {
  // "Cancel" sits under the players and the invite, below the first screen;
  // assertVisible doesn't scroll, so the iPhone run failed on a confirmed
  // booking (preview run, 23 November).
  it('scrolls to Cancel after the weather strip settles, instead of only asserting it', () => {
    const steps = loadAll(read(path.join(maestroDir, 'flows', 'book-and-pay.yaml')))[1] as Record<string, unknown>[];
    const confirmed = steps.findIndex((s) => 'retry' in s);
    const after = steps.slice(confirmed + 1).map((s) => JSON.stringify(s));
    expect(after.some((s) => s.includes('assertVisible') && s.includes('booking-detail-cancel-whole-team'))).toBe(false);
    const settled = after.findIndex((s) => s.includes('weather-settled.yaml'));
    const scroll = after.findIndex((s) => s.includes('scrollUntilVisible') && s.includes('booking-detail-cancel-whole-team'));
    expect(settled).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(settled);
  });
});

describe('cancel checks the words on screen', () => {
  // On the iPhone the cancelled booking showed "The booking is cancelled."
  // inside booking-detail-notice, yet containsDescendants didn't find it:
  // the text isn't a child of that view in iOS's tree (preview run,
  // 23 November). The flow checks the words themselves instead.
  const steps = () => loadAll(read(path.join(maestroDir, 'flows', 'cancel.yaml')))[1] as Record<string, unknown>[];

  it('uses no containsDescendants', () => {
    expect(JSON.stringify(steps())).not.toContain('containsDescendants');
  });

  it('asserts both cancelled messages by their text', () => {
    const texts = steps()
      .filter((s) => 'assertVisible' in s)
      .map((s) => (s.assertVisible as { text?: string }).text);
    expect(texts).toEqual(expect.arrayContaining(['The booking is cancelled\\.', 'This booking was cancelled\\.']));
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
    // \r?\n: a Windows checkout (core.autocrlf=true) has CRLF line endings.
    expect(expected('flows/cancel.yaml', /id: cancel-quote-line-\d+\r?\n\s+text: '([^']+)'/g)).toEqual(lines);
    expect(read(path.join(maestroDir, 'flows/cancel.yaml'))).toContain(`id: cancel-quote-line-${lines.length}`);

    const notice = cancelledMessage('whole_team', { cancelled: true, fee: null });
    expect(notice).toBe('The booking is cancelled.');
    expect(expected('flows/cancel.yaml', /text: '(The booking is cancelled\\\.)'/g)).toEqual([notice]);
  });
});

// Doc 28 prompt 1: block-clashes.yaml expects the clash sheet's words for the
// phone booking the seed makes, on the staff venue's own pitch.
describe('block-clashes', () => {
  const text = () => read(path.join(maestroDir, 'flows', 'block-clashes.yaml')).replace(/\r\n/g, '\n');
  const seeded: CounterClash = {
    id: 'seeded',
    kind: 'counter',
    start_time: `${E2E_STAFF_BOOKING.start}:00`,
    end_time: `${E2E_STAFF_BOOKING.end}:00`,
    format: '5-a-side',
    started: false,
    pitch_ids: [E2E_STAFF[0].pitchId],
    pitch_names: ['Pitch 1'],
    source: 'phone',
    contact_name: E2E_STAFF_BOOKING.contactName,
    phone: E2E_STAFF_BOOKING.phone,
    paid: false,
    refund_cents: 0,
  };
  // Maestro reads assertVisible text as a regular expression.
  const asPattern = (s: string) => s.replace(/[+]/g, '\\+');

  it('looks for the seeded booking as the clash sheet words it', () => {
    expect(text()).toContain(`assertVisible: '${clashTime(seeded)} · ${clashTitle(seeded)}'`);
    expect(text()).toContain(`assertVisible: '${asPattern(counterClashSummary(seeded))}'`);
    expect(text()).toContain(`assertVisible: '${asPattern(E2E_STAFF_BOOKING.phone)}'`);
  });

  it('signs in as the staff login and blocks its own venue’s pitch, per platform', () => {
    expect(text()).toContain("EMAIL: ${'e2e-' + MAESTRO_E2E_PLATFORM + '-staff@e2e.futty.app'}");
    const [ios, android] = E2E_STAFF;
    expect(ios.email).toBe('e2e-ios-staff@e2e.futty.app');
    expect(android.email).toBe('e2e-android-staff@e2e.futty.app');
    expect(text()).toContain(`'ios' ? '${ios.pitchId}' : '${android.pitchId}'`);
    // The seeded booking is tomorrow, so the flow moves one day on first.
    expect(E2E_STAFF_BOOKING.daysAhead).toBe(1);
    expect(text().match(/id: venue-dashboard-next-day\n/g)?.length).toBe(2);
  });
});
