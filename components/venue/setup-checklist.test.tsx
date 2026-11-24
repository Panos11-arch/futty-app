import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { SetupChecklistView } from '@/components/venue/setup-checklist';
import type { SetupStatus } from '@/lib/venue-checklist';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const status: SetupStatus = {
  photos: true,
  amenities: false,
  menu: false,
  hours: true,
  contact: false,
  pitches: true,
  prices: true,
  complete: false,
};

describe('SetupChecklistView (S5A: Set up your venue)', () => {
  it('the seven parts with a tick when done; each opens its screen', async () => {
    const onOpen = jest.fn();
    await render(<SetupChecklistView state={{ status: 'ready', data: status }} onOpen={onOpen} onRetry={jest.fn()} />);
    const card = within(screen.getByTestId('venue-setup-checklist'));
    expect(card.getByText('Set up your venue')).toBeTruthy();
    expect(screen.getByTestId('venue-setup-step-photos').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('venue-setup-step-amenities').props.accessibilityState).toMatchObject({ checked: false });
    expect(card.getByText('Phone and website')).toBeTruthy();
    expect(card.getAllByTestId('icon-checkmark.circle.fill')).toHaveLength(4);
    await fireEvent.press(screen.getByTestId('venue-setup-step-contact'));
    expect(onOpen).toHaveBeenCalledWith('/venue-contact');
    await fireEvent.press(screen.getByTestId('venue-setup-step-menu'));
    expect(onOpen).toHaveBeenCalledWith('/venue-menu');
  });

  it('hidden once complete, and while loading', async () => {
    await render(
      <SetupChecklistView state={{ status: 'ready', data: { ...status, complete: true } }} onOpen={jest.fn()} onRetry={jest.fn()} />,
    );
    expect(screen.queryByTestId('venue-setup-checklist')).toBeNull();
    await render(<SetupChecklistView state={{ status: 'loading' }} onOpen={jest.fn()} onRetry={jest.fn()} />);
    expect(screen.queryByTestId('venue-setup-checklist')).toBeNull();
  });

  it('an error is one line with Try again', async () => {
    const onRetry = jest.fn();
    await render(<SetupChecklistView state={{ status: 'error', message: 'Could not load your venue. Try again.' }} onOpen={jest.fn()} onRetry={onRetry} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
