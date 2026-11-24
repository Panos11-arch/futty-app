import { fireEvent, render, screen } from '@testing-library/react-native';

import { PublishGames } from '@/components/booking/publish-games';
import type { PublishableBooking } from '@/lib/booking-posts';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function game(over: Partial<PublishableBooking> = {}): PublishableBooking {
  return {
    booking_id: 'b1',
    venue_name: 'Arena',
    booking_day: '2027-01-08',
    start_time: '12:00:00',
    end_time: '13:00:00',
    format: '5-a-side',
    pitch_label: 'Pitch 1',
    kind: 'half',
    side: 'a',
    open_spots: 4,
    players_post_id: null,
    opposition_post_id: null,
    can_publish_players: true,
    can_publish_opposition: true,
    ...over,
  };
}

describe('PublishGames (spec 13 "Publish game")', () => {
  it('my games with open spots: Publish', async () => {
    const onPublish = jest.fn();
    await render(
      <PublishGames kind="players" games={[game()]} busyId={null} error={null} onPublish={onPublish} onUnpublish={jest.fn()} />,
    );
    expect(screen.getByText('Your games')).toBeTruthy();
    expect(screen.getByText('Arena')).toBeTruthy();
    expect(screen.getByText('Fri 8 Jan · 12:00–13:00 · Pitch 1 · 4 open spots')).toBeTruthy();
    expect(screen.getByTestId('publish-game-b1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('publish-game-button-b1'));
    expect(onPublish).toHaveBeenCalledWith('b1');
  });

  it('a published game: Unpublish its post', async () => {
    const onUnpublish = jest.fn();
    await render(
      <PublishGames
        kind="opposition"
        games={[game({ opposition_post_id: 'p7' })]}
        busyId={null}
        error={null}
        onPublish={jest.fn()}
        onUnpublish={onUnpublish}
      />,
    );
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeTruthy();
    fireEvent.press(screen.getByTestId('publish-game-button-b1'));
    expect(onUnpublish).toHaveBeenCalledWith('p7');
  });

  it('nothing to publish: no section', async () => {
    await render(
      <PublishGames
        kind="opposition"
        games={[game({ kind: 'whole', side: null, can_publish_opposition: false })]}
        busyId={null}
        error={null}
        onPublish={jest.fn()}
        onUnpublish={jest.fn()}
      />,
    );
    expect(screen.queryByText('Your games')).toBeNull();
  });

  it('the opposition list explains what publishing does', async () => {
    await render(<PublishGames kind="opposition" games={[game()]} busyId={null} error={null} onPublish={jest.fn()} onUnpublish={jest.fn()} />);
    expect(screen.getByText('Any team can take your game on. The slot stays booked.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });

  it('shows the server\'s error', async () => {
    await render(
      <PublishGames kind="players" games={[game()]} busyId={null} error="This game is full." onPublish={jest.fn()} onUnpublish={jest.fn()} />,
    );
    expect(screen.getByText('This game is full.')).toBeTruthy();
  });
});
