import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { DebtsView } from '@/components/venue/debts-view';
import { debtsList, LEAKED_EMAIL, LEAKED_PHONE } from '@/lib/venue-money.fixtures';

// Debts owed to the venue (P6d; spec 13 "Debt", "Venue dashboard"): open by
// default, settled on a toggle; "Mark settled" calls settle_debt only after
// the confirm tap.

// The confirm sheet is a Modal: load it with the file, not in the first test.
loadWithFile(Modal, DebtsView);

type Reply = { data: unknown; error: { message: string } | null };
let mockSettle: Reply = { data: null, error: null };
/** When set, settle_debt waits until the test calls it. */
let mockFinishSettle: (() => void) | null = null;
let mockHoldSettle = false;
const mockRpc = jest.fn((fn: string, args: unknown): Promise<Reply> => {
  if (fn === 'venue_debt_list') {
    return Promise.resolve({ data: debtsList((args as { p_include_settled: boolean }).p_include_settled), error: null });
  }
  if (mockHoldSettle) {
    return new Promise((resolve) => {
      mockFinishSettle = () => resolve(mockSettle);
    });
  }
  return Promise.resolve(mockSettle);
});
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
// The real Sheet, remembering its last props, so a test can tap the confirm
// twice before React re-renders.
let mockSheetProps: { primaryAction?: { onPress: () => void } } = {};
jest.mock('@/components/ui', () => {
  const actual = jest.requireActual<typeof import('@/components/ui')>('@/components/ui');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    Sheet: (props: Parameters<typeof actual.Sheet>[0]) => {
      mockSheetProps = props;
      return createElement(actual.Sheet, props);
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const calls = (fn: string) => mockRpc.mock.calls.filter(([name]) => name === fn).map(([, args]) => args);

beforeEach(() => {
  mockRpc.mockClear();
  mockSettle = { data: null, error: null };
  mockHoldSettle = false;
  mockFinishSettle = null;
});

async function draw() {
  await render(<DebtsView venueId="v1" />);
  await screen.findByText('Andreas');
}

describe('DebtsView: the list', () => {
  it('open debts by default, with the amount the server sent', async () => {
    await draw();
    expect(calls('venue_debt_list')).toEqual([{ p_venue_id: 'v1', p_include_settled: false }]);
    expect(screen.getByTestId('debt-d1')).toHaveTextContent(/€6\.80/);
    expect(screen.getByTestId('debt-d1')).toHaveTextContent(/Cash not paid · game on Sun 1 Nov 2026 at 19:00/);
    expect(screen.queryByText('Eleni')).toBeNull();
  });

  it('settled debts on the toggle', async () => {
    await draw();
    await fireEvent.press(screen.getByRole('tab', { name: 'Settled too' }));
    await screen.findByText('Eleni');
    expect(calls('venue_debt_list').at(-1)).toEqual({ p_venue_id: 'v1', p_include_settled: true });
    expect(screen.getByTestId('debt-d2')).toHaveTextContent(/€11\.11/);
    expect(screen.getByTestId('debt-d2')).toHaveTextContent(/Settled Fri 2 Oct 2026/);
    // A settled debt can't be settled again.
    expect(screen.getAllByRole('button', { name: /^Mark .* settled$/ })).toHaveLength(1);
  });

  it("never shows a player's email or phone", async () => {
    await draw();
    expect(screen.queryByText(new RegExp(LEAKED_EMAIL))).toBeNull();
    expect(screen.queryByText(new RegExp(LEAKED_PHONE.replace('+', '\\+')))).toBeNull();
  });

  it('nothing owed', async () => {
    mockRpc.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));
    await render(<DebtsView venueId="v1" />);
    expect(await screen.findByText('Nobody owes you anything.')).toBeTruthy();
  });
});

describe('DebtsView: Mark settled', () => {
  it('the first tap only asks; nothing is sent', async () => {
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    expect(await screen.findByText('Andreas paid you €6.80 in person? This clears their debt.')).toBeTruthy();
    expect(calls('settle_debt')).toEqual([]);
  });

  it('cancel sends nothing', async () => {
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Not yet' }));
    expect(calls('settle_debt')).toEqual([]);
  });

  it('the confirm calls settle_debt once, then reloads', async () => {
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yes, settled' }));
    await screen.findByText('Andreas');
    expect(calls('settle_debt')).toEqual([{ p_debt_id: 'd1' }]);
    expect(calls('venue_debt_list')).toHaveLength(2);
  });

  it("the server's refusal shows", async () => {
    mockSettle = { data: null, error: { message: 'debt_settled' } };
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yes, settled' }));
    expect(await screen.findByText('This debt is already settled.')).toBeTruthy();
  });

  it('while settle_debt runs, both buttons are disabled and the sheet stays open', async () => {
    mockHoldSettle = true;
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yes, settled' }));
    expect(screen.getByRole('button', { name: 'Yes, settled' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not yet' })).toBeDisabled();
    // The close button does nothing while it runs.
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Andreas paid you €6.80 in person? This clears their debt.')).toBeTruthy();

    await act(async () => mockFinishSettle?.());
    expect(screen.queryByText('Andreas paid you €6.80 in person? This clears their debt.')).toBeNull();
    expect(calls('settle_debt')).toEqual([{ p_debt_id: 'd1' }]);
  });

  it('a second tap before the screen updates is ignored', async () => {
    mockHoldSettle = true;
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    await screen.findByRole('button', { name: 'Yes, settled' });
    // Both taps land in one act, before React re-renders the disabled button.
    await act(async () => {
      const confirm = mockSheetProps.primaryAction?.onPress;
      confirm?.();
      confirm?.();
    });
    await act(async () => mockFinishSettle?.());
    expect(calls('settle_debt')).toEqual([{ p_debt_id: 'd1' }]);
  });

  it.each([
    ['debt_settled', 'This debt is already settled.'],
    ['debt_not_found', 'That debt is gone.'],
  ])('after a %s refusal the list reloads', async (code, words) => {
    mockSettle = { data: null, error: { message: code } };
    await draw();
    expect(calls('venue_debt_list')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yes, settled' }));
    expect(await screen.findByText(words)).toBeTruthy();
    expect(calls('venue_debt_list')).toHaveLength(2);
  });

  it('after any other refusal the list is not reloaded', async () => {
    mockSettle = { data: null, error: { message: 'not_venue_staff' } };
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark €6.80 settled' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yes, settled' }));
    await screen.findByText('Andreas');
    expect(calls('venue_debt_list')).toHaveLength(1);
  });
});
