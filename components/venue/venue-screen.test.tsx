import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { VenueScreen } from '@/components/venue/venue-screen';

// The frame for a venue dashboard screen (P6d): the venue in the `venueId`
// route param, only if the signed-in owner owns it. No silent fallback to
// another venue; the venue's name in the header; a failed load can be
// retried; signed out goes to sign-in.

const VENUE = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

let mockParams: Record<string, string | undefined> = { venueId: VENUE };
let mockAuth: { user: { id: string } | null; initializing: boolean } = { user: { id: 'owner1' }, initializing: false };
let mockVenues: { id: string; name: string }[] = [{ id: VENUE, name: 'Nuevo Campo' }];
let mockError: { message: string } | null = null;
const mockQueries: { method: string; args: unknown[] }[][] = [];

jest.mock('expo-router', () => {
  const { Text: RNText } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    useLocalSearchParams: () => mockParams,
    Stack: { Screen: ({ options }: { options: { title: string } }) => createElement(RNText, { testID: 'header' }, options.title) },
    Redirect: ({ href }: { href: string }) => createElement(RNText, { testID: 'redirect' }, href),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const calls: { method: string; args: unknown[] }[] = [{ method: 'from', args: [table] }];
      mockQueries.push(calls);
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq']) {
        query[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return query;
        };
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(mockError ? { data: null, error: mockError } : { data: mockVenues, error: null }).then(
          resolve,
          reject,
        );
      return query;
    },
  },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => {
  mockParams = { venueId: VENUE };
  mockAuth = { user: { id: 'owner1' }, initializing: false };
  mockVenues = [{ id: VENUE, name: 'Nuevo Campo' }];
  mockError = null;
  mockQueries.length = 0;
});

function draw() {
  return render(<VenueScreen title="Money">{(venueId) => <Text testID="child">{venueId}</Text>}</VenueScreen>);
}

describe('VenueScreen', () => {
  it("asks for this venue, owned by the signed-in user, and names it in the header", async () => {
    await draw();
    expect(await screen.findByTestId('child')).toHaveTextContent(VENUE);
    expect(screen.getByTestId('header')).toHaveTextContent('Money · Nuevo Campo');
    expect(mockQueries).toEqual([
      [
        { method: 'from', args: ['venues'] },
        { method: 'select', args: ['id, name'] },
        { method: 'eq', args: ['id', VENUE] },
        { method: 'eq', args: ['owner_profile_id', 'owner1'] },
      ],
    ]);
  });

  it("a venue they don't own: an error, never another of their venues", async () => {
    mockParams = { venueId: OTHER };
    mockVenues = [];
    await draw();
    expect(await screen.findByText('This venue isn’t linked to your account.')).toBeTruthy();
    expect(screen.queryByTestId('child')).toBeNull();
    expect(screen.getByTestId('header')).toHaveTextContent('Money');
  });

  it.each([[undefined], ['not-a-venue-id']])('a missing or malformed venueId (%s): an error, nothing asked', async (id) => {
    mockParams = { venueId: id };
    await draw();
    expect(await screen.findByText('This venue isn’t linked to your account.')).toBeTruthy();
    expect(screen.queryByTestId('child')).toBeNull();
    expect(mockQueries).toEqual([]);
  });

  it('a failed load shows an error with a retry that loads again', async () => {
    mockError = { message: 'network down' };
    await draw();
    expect(await screen.findByText('Your venue couldn’t be loaded. Try again.')).toBeTruthy();
    expect(screen.queryByTestId('child')).toBeNull();

    mockError = null;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('child')).toHaveTextContent(VENUE);
    expect(mockQueries).toHaveLength(2);
  });

  it('signed out: goes to sign-in, nothing asked', async () => {
    mockAuth = { user: null, initializing: false };
    await draw();
    expect(screen.getByTestId('redirect')).toHaveTextContent('/sign-in');
    expect(mockQueries).toEqual([]);
  });

  it('while the session is read: loading, no redirect', async () => {
    mockAuth = { user: null, initializing: true };
    await draw();
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.queryByTestId('child')).toBeNull();
    expect(mockQueries).toEqual([]);
  });
});
