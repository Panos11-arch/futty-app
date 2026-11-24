// QA 24 November, S4: the screen after paying is titled "Booked" and its back
// button (and an Android back press or a swipe) goes to the booking, never
// back towards the checkout of a booking that's already paid.
import { render, waitFor } from '@testing-library/react-native';

import BookingAfterPayScreen from '@/app/booking-after-pay';

type BeforeRemove = { preventDefault: () => void; data: { action: { type: string } } };
let mockBeforeRemove: ((e: BeforeRemove) => void) | null = null;
const mockReplace = jest.fn();
const mockScreenOptions = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({
    addListener: (event: string, listener: (e: BeforeRemove) => void) => {
      if (event === 'beforeRemove') mockBeforeRemove = listener;
      return () => undefined;
    },
  }),
  Stack: { Screen: ({ options }: { options: unknown }) => (mockScreenOptions(options), null) },
}));
let mockViewProps: Record<string, unknown> | null = null;
jest.mock('@/components/booking/after-pay-view', () => ({
  AfterPayView: (p: Record<string, unknown>) => ((mockViewProps = p), null),
}));
const mockFetchExtras = jest.fn();
jest.mock('@/lib/venue-extras', () => ({ fetchVenueExtras: (...a: unknown[]) => mockFetchExtras(...a) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
const mockFetchDetail = jest.fn((_id: string): Promise<unknown> => new Promise(() => undefined));
jest.mock('@/lib/booking-detail', () => ({ fetchBookingDetail: (id: string) => mockFetchDetail(id), shareText: jest.fn() }));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

function leave(type: string) {
  const preventDefault = jest.fn();
  mockBeforeRemove?.({ preventDefault, data: { action: { type } } });
  return preventDefault.mock.calls.length > 0;
}

beforeEach(() => {
  mockReplace.mockReset();
  mockScreenOptions.mockReset();
  mockBeforeRemove = null;
  mockParams = { bookingId: 'b1', from: 'pay' };
});

describe('Booked (the screen after paying)', () => {
  it('S5A: loads the venue’s food, drink and amenities for "At the venue"', async () => {
    const extras = { amenities: ['parking'], food: [], hasAfterGameOffers: false };
    mockFetchDetail.mockResolvedValueOnce({ venue: { id: 'v1' }, v2: null });
    mockFetchExtras.mockResolvedValueOnce(extras);
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(mockViewProps?.atVenue).toEqual(extras));
    expect(mockFetchExtras).toHaveBeenCalledWith('v1');
  });


  it('titles the screen and names the back button after the booking', async () => {
    await render(<BookingAfterPayScreen />);
    expect(mockScreenOptions).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Booked', headerBackTitle: 'Booking' }));
  });

  it.each(['GO_BACK', 'POP'])('going back (%s) opens the booking instead', async (type) => {
    await render(<BookingAfterPayScreen />);
    expect(leave(type)).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('opened from a booking (Invite opposition): back is the normal back', async () => {
    mockParams = { bookingId: 'b1' };
    await render(<BookingAfterPayScreen />);
    expect(leave('GO_BACK')).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Go to booking (a replace) is let through', async () => {
    await render(<BookingAfterPayScreen />);
    expect(leave('REPLACE')).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
