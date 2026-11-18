import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { WhatsAppSection } from '@/components/notifications/whatsapp-section';
import type { WhatsAppState } from '@/lib/whatsapp';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

let mockState: WhatsAppState | null;
const mockSetNumber = jest.fn();
const mockStop = jest.fn();
const mockSetChannel = jest.fn();
jest.mock('@/lib/whatsapp', () => ({
  ...jest.requireActual('@/lib/whatsapp'),
  getWhatsAppState: () => Promise.resolve(mockState ? { state: mockState, error: null } : { state: null, error: { message: 'x' } }),
  setWhatsAppNumber: (...a: unknown[]) => mockSetNumber(...a),
  stopWhatsApp: (...a: unknown[]) => mockStop(...a),
  setNotificationChannel: (...a: unknown[]) => mockSetChannel(...a),
}));

const types = ['match_reminder_24h', 'match_reminder_2h', 'match_after_game'];

beforeEach(() => {
  mockSetNumber.mockReset().mockResolvedValue({ phone: '+35799123456', error: null });
  mockStop.mockReset().mockResolvedValue({ error: null });
  mockSetChannel.mockReset().mockResolvedValue({ error: null });
});

describe('WhatsAppSection', () => {
  it('shows nothing while WhatsApp is switched off', async () => {
    mockState = { enabled: false, phone: null, types, channels: {} };
    await render(<WhatsAppSection />);
    await waitFor(() => expect(screen.queryByTestId('whatsapp-skeleton')).toBeNull());
    expect(screen.queryByTestId('whatsapp-section')).toBeNull();
  });

  it('no number yet: add one', async () => {
    mockState = { enabled: true, phone: null, types, channels: {} };
    await render(<WhatsAppSection />);
    await waitFor(() => expect(screen.getByTestId('whatsapp-section')).toBeTruthy());
    expect(screen.getByText('Reply STOP on WhatsApp at any time to stop them.', { exact: false })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('WhatsApp number'), '99 123 456');
    await fireEvent.press(screen.getByText('Turn on WhatsApp reminders'));
    expect(mockSetNumber).toHaveBeenCalledWith('99 123 456');
  });

  it('a refused number shows why', async () => {
    mockState = { enabled: true, phone: null, types, channels: {} };
    mockSetNumber.mockResolvedValue({ phone: null, error: { message: 'phone_in_use' } });
    await render(<WhatsAppSection />);
    await waitFor(() => expect(screen.getByTestId('whatsapp-section')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('WhatsApp number'), '+35799123456');
    await fireEvent.press(screen.getByText('Turn on WhatsApp reminders'));
    await waitFor(() => expect(screen.getByText('That number is already used for WhatsApp by another Futty account.')).toBeTruthy());
  });

  it('with a number: a channel per reminder, push by default; and stop', async () => {
    mockState = { enabled: true, phone: '+35799123456', types, channels: { match_reminder_2h: 'both' } };
    await render(<WhatsAppSection />);
    await waitFor(() => expect(screen.getByText('+35799123456')).toBeTruthy());
    expect(screen.getByTestId('whatsapp-channel-match_reminder_24h')).toBeTruthy();
    expect(screen.getByText('2 hours before a game')).toBeTruthy();
    await fireEvent.press(screen.getAllByText('WhatsApp')[0]);
    expect(mockSetChannel).toHaveBeenCalledWith('match_reminder_24h', 'whatsapp');
    await fireEvent.press(screen.getByText('Stop'));
    expect(mockStop).toHaveBeenCalled();
  });

  it('an error loading shows a retry', async () => {
    mockState = null;
    await render(<WhatsAppSection />);
    await waitFor(() => expect(screen.getByText('Couldn’t load your WhatsApp settings.')).toBeTruthy());
  });
});
