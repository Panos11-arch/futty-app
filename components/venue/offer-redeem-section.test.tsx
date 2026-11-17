import { fireEvent, render, screen } from '@testing-library/react-native';

import { OfferRedeemSection } from '@/components/venue/offer-redeem-section';

// A8 (spec 13, "Post-match offers"): staff type a player's code, see what
// it's for, and confirm. The server decides whether it can be redeemed.

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const offer = {
  id: 'i1',
  name: 'Lunch wrap',
  description: null,
  offer_text: 'Wrap and a drink',
  price_cents: 400,
  offer_price_cents: 300,
  photo_path: null,
};
const code = { code: 'K7M2QX', expires_at: '2026-12-02T22:00:00Z', redeemed_at: null, offer };

beforeEach(() => mockRpc.mockReset());

async function typeAndCheck(text: string) {
  await render(<OfferRedeemSection venueId="v1" />);
  await fireEvent.changeText(screen.getByLabelText('Offer code'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Check code' }));
}

describe('OfferRedeemSection', () => {
  it('checks the code, shows the offer, then redeems it on confirm', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: code, error: null })
      .mockResolvedValueOnce({ data: { ...code, redeemed_at: '2026-12-02T15:00:00Z' }, error: null });
    await typeAndCheck('k7m2qx');
    expect(mockRpc).toHaveBeenCalledWith('check_offer_code', { p_venue_id: 'v1', p_code: 'k7m2qx' });
    expect(await screen.findByText('Lunch wrap')).toBeTruthy();
    expect(screen.getByText('€3.00 (normally €4.00)')).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Redeem' }));
    expect(mockRpc).toHaveBeenLastCalledWith('redeem_offer_code', { p_venue_id: 'v1', p_code: 'K7M2QX' });
    expect(await screen.findByText('Redeemed: Lunch wrap.')).toBeTruthy();
    expect(screen.getByLabelText('Offer code').props.value).toBe('');
  });

  it.each([
    ['code_already_redeemed', 'This code has already been used.'],
    ['code_not_found', 'No offer with that code at this venue.'],
    ['own_code', "You can't redeem your own code."],
    ['code_expired', 'This code has expired. Codes last until midnight on the day of the match.'],
  ])('a refused check (%s) says why and offers no Redeem', async (message, words) => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message } });
    await typeAndCheck('ABC234');
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Redeem' })).toBeNull();
  });

  it('a redeem the server refuses says why', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: code, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'code_already_redeemed' } });
    await typeAndCheck('K7M2QX');
    await fireEvent.press(await screen.findByRole('button', { name: 'Redeem' }));
    expect(await screen.findByText('This code has already been used.')).toBeTruthy();
  });

  it('Check is off until something is typed', async () => {
    await render(<OfferRedeemSection venueId="v1" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Check code' }));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
