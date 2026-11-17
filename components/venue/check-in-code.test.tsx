// P6 check-in QR, the venue's side (spec 05 section 12, item 7): the code
// from get_match_check_in_code as a large QR holding
// futtyapp://check-in?match=<id>&code=<code>, the code printed underneath in
// fours for typing, and the window it's open in Cyprus time (decision 1a.4).
import { render, screen } from '@testing-library/react-native';

import { CheckInCode } from '@/components/venue/check-in-code';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const mockQr = jest.fn();
jest.mock('react-native-qrcode-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return function QRCodeMock(props: { value: string; size: number }) {
    mockQr(props);
    return React.createElement(View, { testID: 'check-in-qr' });
  };
});

const MATCH = '6f1c2a9e-1b2c-4d3e-8f90-0a1b2c3d4e5f';
const CODE = '3f9a1c0e5b7d2a4c6e8f0a1b2c3d4e5f';

beforeEach(() => mockQr.mockReset());

async function show() {
  // A 20:00–21:00 Cyprus game (UTC+2 in November).
  await render(
    <CheckInCode
      matchId={MATCH}
      code={CODE}
      kickoffAt="2026-11-20T18:00:00+00:00"
      endsAt="2026-11-20T19:00:00+00:00"
    />,
  );
}

describe('CheckInCode', () => {
  it('draws the agreed link as a large QR', async () => {
    await show();
    expect(screen.getByTestId('check-in-qr')).toBeTruthy();
    const props = mockQr.mock.calls[0][0];
    expect(props.value).toBe(`futtyapp://check-in?match=${MATCH}&code=${CODE}`);
    expect(props.size).toBeGreaterThanOrEqual(200);
  });

  it('prints the code in fours underneath, for typing', async () => {
    await show();
    expect(screen.getByTestId('check-in-code')).toHaveTextContent('3f9a 1c0e 5b7d 2a4c 6e8f 0a1b 2c3d 4e5f');
  });

  it('says when players can check in, in Cyprus time', async () => {
    await show();
    expect(screen.getByText('Players can check in from 19:00 to 22:00.')).toBeTruthy();
  });
});
