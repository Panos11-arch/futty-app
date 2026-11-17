// P6 check-in QR, the player's side: a "Check in" panel on the booking detail
// and the match page. It says when check-in opens, then scans the venue's QR
// (or takes the typed code) inside the window (decision 1a.4), and is gone
// once the window closes. The server decides; the app words its answer.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { CheckInPanel, CheckInSection } from '@/components/booking/check-in-panel';
import { checkInLink, type CheckInMatch } from '@/lib/check-in';

const MATCH = '6f1c2a9e-1b2c-4d3e-8f90-0a1b2c3d4e5f';
const OTHER = '0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
const CODE = '3f9a1c0e5b7d2a4c6e8f0a1b2c3d4e5f';

type Permission = { granted: boolean; status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean };
let mockPermission: Permission | null = { granted: true, status: 'granted', canAskAgain: true };
const mockRequestPermission = jest.fn();
let mockCameraProps: { onBarcodeScanned?: (r: { data: string; type: string }) => void; barcodeScannerSettings?: unknown } = {};

jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    CameraView: (props: typeof mockCameraProps) => {
      mockCameraProps = props;
      return React.createElement(View, { testID: 'camera' });
    },
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const mockFetchCheckInMatch = jest.fn();
const mockFetchMyCheckIn = jest.fn();
const mockCheckInToMatch = jest.fn();
jest.mock('@/lib/check-in', () => ({
  ...jest.requireActual('@/lib/check-in'),
  fetchCheckInMatch: (...args: unknown[]) => mockFetchCheckInMatch(...args),
  fetchMyCheckIn: (...args: unknown[]) => mockFetchMyCheckIn(...args),
  checkInToMatch: (...args: unknown[]) => mockCheckInToMatch(...args),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

// A 20:00–21:00 Cyprus game (UTC+2 in November): check-in 19:00 to 22:00.
const match: CheckInMatch = {
  id: MATCH,
  kickoff_at: '2026-11-20T18:00:00+00:00',
  ends_at: '2026-11-20T19:00:00+00:00',
  status: 'scheduled',
  venue_name: 'Pitch Club',
};
const BEFORE = new Date('2026-11-20T16:59:00Z');
const OPEN = new Date('2026-11-20T18:30:00Z');
const CLOSED = new Date('2026-11-20T20:00:00Z');

beforeEach(() => {
  mockPermission = { granted: true, status: 'granted', canAskAgain: true };
  mockRequestPermission.mockReset().mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true });
  mockCameraProps = {};
  mockFetchCheckInMatch.mockReset().mockResolvedValue({ data: match, error: null });
  mockFetchMyCheckIn.mockReset().mockResolvedValue({ data: false, error: null });
  mockCheckInToMatch.mockReset().mockResolvedValue({ data: null, error: null });
});

async function panel(over: { now?: Date; checkedIn?: boolean; onCheckIn?: jest.Mock } = {}) {
  const onCheckIn = over.onCheckIn ?? jest.fn(async () => null);
  await render(
    <CheckInPanel match={match} checkedIn={over.checkedIn ?? false} now={over.now ?? OPEN} onCheckIn={onCheckIn} />,
  );
  return onCheckIn;
}

async function scan(data: string) {
  await act(async () => {
    mockCameraProps.onBarcodeScanned?.({ data, type: 'qr' });
  });
}

describe('CheckInPanel: the window', () => {
  it('before the window, says when check-in opens in Cyprus time', async () => {
    await panel({ now: BEFORE });
    expect(screen.getByText('Check-in opens at 19:00')).toBeTruthy();
    expect(screen.queryByText('Check in')).toBeNull();
  });

  it('inside the window, offers Check in', async () => {
    await panel();
    expect(screen.getByText('Check in')).toBeTruthy();
    expect(screen.queryByText(/Check-in opens/)).toBeNull();
  });

  it('after the window, shows nothing', async () => {
    await panel({ now: CLOSED });
    expect(screen.toJSON()).toBeNull();
  });

  it('shows nothing for a void match', async () => {
    await render(<CheckInPanel match={{ ...match, status: 'void' }} checkedIn={false} now={OPEN} onCheckIn={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('already checked in: says so instead of the button', async () => {
    await panel({ checkedIn: true });
    expect(screen.getByText("You're checked in.")).toBeTruthy();
    expect(screen.queryByText('Check in')).toBeNull();
  });
});

describe('CheckInPanel: scanning', () => {
  it('scans QR codes only and checks in with this match’s code', async () => {
    const onCheckIn = await panel();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    expect(screen.getByTestId('camera')).toBeTruthy();
    expect(mockCameraProps.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
    await scan(checkInLink(MATCH, CODE));
    expect(onCheckIn).toHaveBeenCalledWith(CODE);
    expect(screen.getByText("You're checked in.")).toBeTruthy();
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('handles one scan at a time', async () => {
    let finish: (v: string | null) => void = () => {};
    const onCheckIn = jest.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    await panel({ onCheckIn });
    await act(() => fireEvent.press(screen.getByText('Check in')));
    const first = mockCameraProps.onBarcodeScanned;
    await act(async () => {
      first?.({ data: checkInLink(MATCH, CODE), type: 'qr' });
      first?.({ data: checkInLink(MATCH, CODE), type: 'qr' });
    });
    expect(onCheckIn).toHaveBeenCalledTimes(1);
    expect(mockCameraProps.onBarcodeScanned).toBeUndefined();
    await act(async () => finish(null));
  });

  it('refuses another game’s QR without calling the server, and can scan again', async () => {
    const onCheckIn = await panel();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    await scan(checkInLink(OTHER, CODE));
    expect(onCheckIn).not.toHaveBeenCalled();
    expect(screen.getByText('That code is for a different game.')).toBeTruthy();
    expect(mockCameraProps.onBarcodeScanned).toBeUndefined();
    await act(() => fireEvent.press(screen.getByText('Scan again')));
    expect(screen.queryByText('That code is for a different game.')).toBeNull();
    await scan(checkInLink(MATCH, CODE));
    expect(onCheckIn).toHaveBeenCalledWith(CODE);
  });

  it('words a QR that is not Futty’s, and a broken one', async () => {
    const onCheckIn = await panel();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    await scan('https://example.com');
    expect(screen.getByText("That's not a Futty check-in code. Scan the QR the venue shows you.")).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('Scan again')));
    await scan(`futtyapp://check-in?match=${MATCH}`);
    expect(screen.getByText("That check-in code can't be read. Scan it again, or type the code.")).toBeTruthy();
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal in plain words', async () => {
    await panel({ onCheckIn: jest.fn(async () => "That code doesn't match this game. Check it with the venue.") });
    await act(() => fireEvent.press(screen.getByText('Check in')));
    await scan(checkInLink(MATCH, CODE));
    expect(screen.getByText("That code doesn't match this game. Check it with the venue.")).toBeTruthy();
    expect(screen.getByText('Scan again')).toBeTruthy();
  });

  it('can be closed', async () => {
    await panel();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    await act(() => fireEvent.press(screen.getByText('Cancel')));
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.getByText('Check in')).toBeTruthy();
  });
});

describe('CheckInPanel: camera permission', () => {
  it('asks for the camera when it has not been asked yet', async () => {
    mockPermission = { granted: false, status: 'undetermined', canAskAgain: true };
    await panel();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    expect(screen.queryByTestId('camera')).toBeNull();
    await act(() => fireEvent.press(screen.getByText('Allow camera')));
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  it('denied: says so clearly, offers Settings and typing the code', async () => {
    mockPermission = { granted: false, status: 'denied', canAskAgain: false };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const onCheckIn = await panel();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(
      screen.getByText("Futty can't use your camera. You can allow it in Settings, or type the code instead."),
    ).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('Open settings')));
    expect(openSettings).toHaveBeenCalled();
    await act(() => fireEvent.press(screen.getByText('Type the code')));
    await act(() => fireEvent.changeText(screen.getByLabelText('Check-in code'), '3F9A 1C0E-5b7d'));
    await act(() => fireEvent.press(screen.getByText('Check in with this code')));
    expect(onCheckIn).toHaveBeenCalledWith('3f9a1c0e5b7d');
    expect(screen.getByText("You're checked in.")).toBeTruthy();
  });

  it('denied but askable: offers to ask again', async () => {
    mockPermission = { granted: false, status: 'denied', canAskAgain: true };
    await panel();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    expect(screen.queryByText('Open settings')).toBeNull();
    await act(() => fireEvent.press(screen.getByText('Allow camera')));
    expect(mockRequestPermission).toHaveBeenCalled();
  });
});

describe('CheckInPanel: typing the code', () => {
  it('needs something typed, and shows a refusal', async () => {
    const onCheckIn = await panel({ onCheckIn: jest.fn(async () => 'Nope.') });
    await act(() => fireEvent.press(screen.getByText('Check in')));
    await act(() => fireEvent.press(screen.getByText('Type the code instead')));
    expect(screen.getByLabelText('Check in with this code')).toBeDisabled();
    await act(() => fireEvent.changeText(screen.getByLabelText('Check-in code'), ' - '));
    expect(screen.getByLabelText('Check in with this code')).toBeDisabled();
    await act(() => fireEvent.changeText(screen.getByLabelText('Check-in code'), CODE));
    await act(() => fireEvent.press(screen.getByText('Check in with this code')));
    expect(onCheckIn).toHaveBeenCalledWith(CODE);
    expect(screen.getByText('Nope.')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('Use the camera')));
    expect(screen.getByTestId('camera')).toBeTruthy();
  });
});

describe('CheckInSection (connected)', () => {
  it('loads the booking’s match and the player’s check-in, then checks in on the server', async () => {
    await render(<CheckInSection bookingId="b1" now={OPEN} />);
    expect(mockFetchCheckInMatch).toHaveBeenCalledWith({ bookingId: 'b1' });
    expect(mockFetchMyCheckIn).toHaveBeenCalledWith(MATCH, 'me');
    await act(() => fireEvent.press(screen.getByText('Check in')));
    await scan(checkInLink(MATCH, CODE));
    expect(mockCheckInToMatch).toHaveBeenCalledWith(MATCH, CODE);
    expect(screen.getByText("You're checked in.")).toBeTruthy();
  });

  it('loads by match id on the match page', async () => {
    await render(<CheckInSection matchId={MATCH} now={OPEN} />);
    expect(mockFetchCheckInMatch).toHaveBeenCalledWith({ matchId: MATCH });
    expect(screen.getByText('Check in')).toBeTruthy();
  });

  it('shows the player is already checked in', async () => {
    mockFetchMyCheckIn.mockResolvedValue({ data: true, error: null });
    await render(<CheckInSection bookingId="b1" now={OPEN} />);
    expect(screen.getByText("You're checked in.")).toBeTruthy();
  });

  it('words each server refusal', async () => {
    for (const [code, words] of [
      ['invalid_code', "That code doesn't match this game. Check it with the venue."],
      ['check_in_closed', 'Check-in for this game is closed. It opens an hour before kickoff and closes an hour after the end.'],
      ['not_in_match', "You're not in this game, so you can't check in to it."],
      ['match_not_found', "We couldn't find this game."],
    ]) {
      mockCheckInToMatch.mockResolvedValue({ data: null, error: { message: code } });
      const view = await render(<CheckInSection bookingId="b1" now={OPEN} />);
      await act(() => fireEvent.press(screen.getByText('Check in')));
      await scan(checkInLink(MATCH, CODE));
      expect(screen.getByText(words)).toBeTruthy();
      await view.unmount();
    }
  });

  it('shows nothing without a match, or when it cannot load', async () => {
    mockFetchCheckInMatch.mockResolvedValue({ data: null, error: null });
    const view = await render(<CheckInSection bookingId="b1" now={OPEN} />);
    expect(view.toJSON()).toBeNull();
    await view.unmount();
    mockFetchCheckInMatch.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await render(<CheckInSection bookingId="b1" now={OPEN} />);
    expect(screen.toJSON()).toBeNull();
  });
});
