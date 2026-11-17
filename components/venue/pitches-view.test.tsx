import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { PitchesView } from '@/components/venue/pitches-view';
import { callsTo, refuse, resetRpc, rpc as mockRpc, writes } from '@/components/venue/setup-test-helpers';
import { PITCH_A, PITCH_B, PITCH_C } from '@/lib/venue-setup.fixtures';

// Pitches and combinations (P6e; spec 13 "Venue setup"): what the server
// would refuse is greyed out from venue_setup's flags (a pitch that has held
// a game can't be deleted; one with games to come keeps its size and
// formats). Closing a pitch with games to come tells their players, so it
// calls nothing until staff confirm.

loadWithFile(Modal, PitchesView);

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const CLOSE_WARNING =
  'Pitch A has games still to come. They stay on, and their players will be told you’ve closed new bookings.';

beforeEach(() => resetRpc());

async function openPitch(id: string) {
  await render(<PitchesView venueId="v1" />);
  await fireEvent.press(await screen.findByTestId(`pitch-${id}`));
}

describe('PitchesView: list', () => {
  it('lists pitches, closed ones too, and the combinations', async () => {
    await render(<PitchesView venueId="v1" />);
    expect(await screen.findByTestId(`pitch-${PITCH_A}`)).toHaveTextContent(/Pitch A.*5-a-side · 3G · Outdoor/);
    expect(screen.getByTestId(`pitch-${PITCH_B}`)).toHaveTextContent(/Pitch B.*5-a-side · Indoor/);
    expect(screen.getByTestId(`pitch-${PITCH_C}`)).toHaveTextContent(/Pitch C.*Closed/);
    expect(screen.getByText('7-a-side: Pitch A + Pitch B')).toBeTruthy();
  });
});

describe('PitchesView: editing', () => {
  it('sends every field of a pitch with no games to come', async () => {
    await openPitch(PITCH_B);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Pitch B2');
    await fireEvent.press(screen.getByTestId('size-7-a-side'));
    await fireEvent.press(screen.getByTestId('format-6-a-side'));
    await fireEvent.press(screen.getByText('Save pitch'));
    await waitFor(() => expect(callsTo('save_pitch')).toHaveLength(1));
    expect(callsTo('save_pitch')[0]).toEqual({
      p_venue_id: 'v1',
      p_pitch_id: PITCH_B,
      p_name: 'Pitch B2',
      p_size: '7-a-side',
      p_formats: ['5-a-side', '6-a-side'],
      p_surface: '',
      p_indoor: true,
      p_description: 'Under the roof',
      p_sort_order: null,
    });
  });

  it('greys out size and formats while a pitch has games to come, and keeps them (null)', async () => {
    await openPitch(PITCH_A);
    expect(screen.getByTestId('size-7-a-side')).toBeDisabled();
    expect(screen.getByTestId('format-6-a-side')).toBeDisabled();
    expect(screen.getByText('This pitch has games still to come, so its size and formats can’t change.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save pitch'));
    await waitFor(() => expect(callsTo('save_pitch')).toHaveLength(1));
    expect(callsTo('save_pitch')[0]).toMatchObject({ p_pitch_id: PITCH_A, p_size: null, p_formats: null });
  });

  it('adds a new pitch', async () => {
    await render(<PitchesView venueId="v1" />);
    await fireEvent.press(await screen.findByText('Add pitch'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Pitch D');
    await fireEvent.changeText(screen.getByLabelText('Surface'), 'Grass');
    await fireEvent.press(screen.getByText('Save pitch'));
    await waitFor(() => expect(callsTo('save_pitch')).toHaveLength(1));
    expect(callsTo('save_pitch')[0]).toEqual({
      p_venue_id: 'v1',
      p_pitch_id: null,
      p_name: 'Pitch D',
      p_size: '5-a-side',
      p_formats: ['5-a-side'],
      p_surface: 'Grass',
      p_indoor: false,
      p_description: '',
      p_sort_order: null,
    });
  });

  it("shows the server's refusal in words", async () => {
    refuse('save_pitch', 'pitch_name_taken');
    await openPitch(PITCH_B);
    await fireEvent.press(screen.getByText('Save pitch'));
    expect(await screen.findByText('Another pitch already has that name.')).toBeTruthy();
  });
});

describe('PitchesView: open, close and delete', () => {
  it('closing a pitch with games to come calls nothing until staff confirm', async () => {
    await openPitch(PITCH_A);
    await fireEvent.press(screen.getByText('Close pitch'));
    expect(await screen.findByText(CLOSE_WARNING)).toBeTruthy();
    expect(writes()).toEqual([]);
    await fireEvent.press(screen.getByText('Yes, close pitch'));
    await waitFor(() => expect(callsTo('set_pitch_open')).toEqual([{ p_pitch_id: PITCH_A, p_open: false }]));
  });

  it('closes a pitch with no games to come at once, and opens a closed one', async () => {
    await openPitch(PITCH_B);
    await fireEvent.press(screen.getByText('Close pitch'));
    await waitFor(() => expect(callsTo('set_pitch_open')).toEqual([{ p_pitch_id: PITCH_B, p_open: false }]));

    await fireEvent.press(await screen.findByTestId(`pitch-${PITCH_C}`));
    await fireEvent.press(screen.getByText('Open pitch'));
    await waitFor(() => expect(callsTo('set_pitch_open')).toHaveLength(2));
    expect(callsTo('set_pitch_open')[1]).toEqual({ p_pitch_id: PITCH_C, p_open: true });
  });

  it('greys out Delete for a pitch that has held games', async () => {
    await openPitch(PITCH_B);
    expect(screen.getByTestId('pitch-delete')).toBeDisabled();
    expect(screen.getByText('This pitch has held games, so it can only be closed.')).toBeTruthy();
  });

  it('deletes an unused pitch after one confirm', async () => {
    await openPitch(PITCH_C);
    await fireEvent.press(screen.getByTestId('pitch-delete'));
    expect(writes()).toEqual([]);
    await fireEvent.press(await screen.findByText('Yes, delete'));
    await waitFor(() => expect(callsTo('delete_pitch')).toEqual([{ p_pitch_id: PITCH_C }]));
  });
});

describe('PitchesView: combinations', () => {
  it('adds a combination once two pitches are picked', async () => {
    await render(<PitchesView venueId="v1" />);
    await fireEvent.press(await screen.findByText('Add combination'));
    await fireEvent.press(screen.getByTestId('combo-format-9-a-side'));
    await fireEvent.press(screen.getByTestId(`combo-pitch-${PITCH_B}`));
    expect(screen.getByTestId('combo-add')).toBeDisabled();
    await fireEvent.press(screen.getByTestId(`combo-pitch-${PITCH_C}`));
    await fireEvent.press(screen.getByTestId('combo-add'));
    await waitFor(() => expect(callsTo('add_pitch_combination')).toHaveLength(1));
    expect(callsTo('add_pitch_combination')[0]).toEqual({
      p_venue_id: 'v1',
      p_format: '9-a-side',
      p_pitch_ids: [PITCH_B, PITCH_C],
    });
  });

  it('removes a combination, sending only its id', async () => {
    await render(<PitchesView venueId="v1" />);
    await fireEvent.press(await screen.findByLabelText('Remove combination 7-a-side: Pitch A + Pitch B'));
    await waitFor(() => expect(callsTo('remove_pitch_combination')).toEqual([{ p_combination_id: 'k1' }]));
  });
});
