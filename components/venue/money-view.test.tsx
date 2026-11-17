import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { MoneyView } from '@/components/venue/money-view';
import { revenueExport, revenueScreen, revenueScreenMatchingExport } from '@/lib/venue-money.fixtures';

// The Money screen (P6d; spec 13 "Venue dashboard", Revenue): every amount is
// the server's own field, shown unchanged; the period is a Cyprus date; the
// CSV comes from one venue_revenue_export call and matches the screen.

type Reply = { data: unknown; error: { message: string } | null };
const mockReplies: Record<string, () => Reply> = {};
const mockRpc = jest.fn((fn: string, _args: unknown) => Promise.resolve(mockReplies[fn]()));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));

const mockWrites: string[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
    }
    create() {}
    write(content: string) {
      mockWrites.push(content);
    }
  },
}));
const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const calls = (fn: string) => mockRpc.mock.calls.filter(([name]) => name === fn).map(([, args]) => args);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  mockRpc.mockClear();
  mockShare.mockClear();
  mockWrites.length = 0;
  mockReplies.venue_revenue = () => ({ data: revenueScreen(), error: null });
  mockReplies.venue_revenue_export = () => ({ data: revenueExport(), error: null });
});

afterEach(() => jest.useRealTimers());

async function draw() {
  await render(<MoneyView venueId="v1" />);
  await screen.findByTestId('revenue-total-venue');
}

describe('MoneyView: amounts', () => {
  it("shows the server's total, not the sum of the sources", async () => {
    await draw();
    // Sources add up to €52.21 venue, €0.56 Futty, €0.35 Stripe; the server says otherwise.
    expect(screen.getByTestId('revenue-total-venue')).toHaveTextContent('€999.99');
    expect(screen.getByTestId('revenue-total-futty')).toHaveTextContent('€7.77');
    expect(screen.getByTestId('revenue-total-stripe')).toHaveTextContent('€3.33');
  });

  it("shows each source's venue, Futty and Stripe figures unchanged", async () => {
    await draw();
    expect(screen.getByTestId('revenue-app_card-venue')).toHaveTextContent('€10.00');
    expect(screen.getByTestId('revenue-app_card-futty')).toHaveTextContent('€0.45');
    expect(screen.getByTestId('revenue-app_card-stripe')).toHaveTextContent('€0.35');
    expect(screen.getByTestId('revenue-app_cash-venue')).toHaveTextContent('€2.00');
    expect(screen.getByTestId('revenue-app_cash-futty')).toHaveTextContent('€0.11');
    expect(screen.getByTestId('revenue-walk_in-venue')).toHaveTextContent('€43.21');
    expect(screen.getByTestId('revenue-phone-venue')).toHaveTextContent('€0.00');
    for (const label of ['App card', 'App cash', 'Walk-in', 'Phone']) expect(screen.getByText(label)).toBeTruthy();
  });

  it("lists walk-in price overrides with the venue's price and what was charged", async () => {
    await draw();
    expect(screen.getByText('Maria Georgiou')).toBeTruthy();
    expect(screen.getByTestId('override-cb1')).toHaveTextContent(/Your price €60.00 · charged €50.00/);
    expect(screen.getByTestId('override-cb2')).toHaveTextContent(/Your price €60.00 · charged €0.00/);
  });

  it('asks for the Cyprus day', async () => {
    await draw();
    expect(calls('venue_revenue')).toEqual([{ p_venue_id: 'v1', p_period: 'day', p_day: '2026-11-17' }]);
  });

  it('an error shows inline with a retry', async () => {
    mockReplies.venue_revenue = () => ({ data: null, error: { message: 'not_venue_staff' } });
    await render(<MoneyView venueId="v1" />);
    expect(await screen.findByText("You're not staff at this venue.")).toBeTruthy();
    mockReplies.venue_revenue = () => ({ data: revenueScreen(), error: null });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('revenue-total-venue')).toBeTruthy();
  });
});

describe('MoneyView: the period stepper in Cyprus time', () => {
  it('just after midnight on New Year in Cyprus, today is 1 January', async () => {
    jest.setSystemTime(new Date('2026-12-31T22:30:00Z'));
    await draw();
    expect(calls('venue_revenue')).toEqual([{ p_venue_id: 'v1', p_period: 'day', p_day: '2027-01-01' }]);
  });

  it('steps back over the year end and not past today', async () => {
    jest.setSystemTime(new Date('2026-12-31T22:30:00Z'));
    await draw();
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous period' }));
    await screen.findByTestId('revenue-total-venue');
    expect(calls('venue_revenue').at(-1)).toEqual({ p_venue_id: 'v1', p_period: 'day', p_day: '2026-12-31' });
    expect(screen.getByRole('button', { name: 'Next period' })).not.toBeDisabled();
  });

  it('a week runs Monday to Sunday across the year end', async () => {
    jest.setSystemTime(new Date('2026-12-31T22:30:00Z'));
    mockReplies.venue_revenue = () => ({
      data: revenueScreen({ period: 'week', from: '2026-12-28', to: '2027-01-03' }),
      error: null,
    });
    await draw();
    await fireEvent.press(screen.getByRole('tab', { name: 'Week' }));
    await screen.findByText('Mon 28 Dec 2026 – Sun 3 Jan 2027');
    expect(calls('venue_revenue').at(-1)).toEqual({ p_venue_id: 'v1', p_period: 'week', p_day: '2026-12-28' });
  });

  it('a month steps back from January to December', async () => {
    jest.setSystemTime(new Date('2027-01-15T10:00:00Z'));
    await draw();
    await fireEvent.press(screen.getByRole('tab', { name: 'Month' }));
    await screen.findByTestId('revenue-total-venue');
    expect(calls('venue_revenue').at(-1)).toEqual({ p_venue_id: 'v1', p_period: 'month', p_day: '2027-01-01' });
    await fireEvent.press(screen.getByRole('button', { name: 'Previous period' }));
    await screen.findByTestId('revenue-total-venue');
    expect(calls('venue_revenue').at(-1)).toEqual({ p_venue_id: 'v1', p_period: 'month', p_day: '2026-12-01' });
  });
});

describe('MoneyView: Export CSV', () => {
  beforeEach(() => {
    mockReplies.venue_revenue = () => ({ data: revenueScreenMatchingExport(), error: null });
  });

  it('calls venue_revenue_export once and shares a file with the totals on screen', async () => {
    await draw();
    expect(screen.getByTestId('revenue-total-venue')).toHaveTextContent('€56.00');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Export CSV' }));
    });
    expect(calls('venue_revenue_export')).toEqual([{ p_venue_id: 'v1', p_period: 'day', p_day: '2026-11-17' }]);
    expect(mockShare).toHaveBeenCalledTimes(1);
    const total = mockWrites[0].split('\r\n').find((l) => l.startsWith('Total,'))!;
    expect(total).toContain(',56.00,0.45,0.35,');
  });

  it('money moved since the screen loaded: no file, a note, and the screen reloads', async () => {
    mockReplies.venue_revenue_export = () => ({
      data: revenueExport({ totals: { venue_cents: 5600, futty_cents: 45, stripe_fee_cents: 35, rows: 3 } }),
      error: null,
    });
    await draw();
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Export CSV' }));
    });
    expect(calls('venue_revenue_export')).toHaveLength(1);
    expect(mockShare).not.toHaveBeenCalled();
    expect(await screen.findByText('Revenue changed since you opened this. Check the new totals and export again.')).toBeTruthy();
    expect(calls('venue_revenue')).toHaveLength(2);
  });
});
