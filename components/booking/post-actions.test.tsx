import { fireEvent, render, screen } from '@testing-library/react-native';

import { PostActions } from '@/components/booking/post-actions';
import type { BookingPostQuote } from '@/lib/booking-posts';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function quote(over: Partial<BookingPostQuote> = {}): BookingPostQuote {
  return {
    post_id: 'p1',
    kind: 'players',
    side: null,
    mine: false,
    open: true,
    closes_at: '2027-01-08T08:00:00Z',
    join_cents: 480,
    join_pitch_cents: 400,
    join_fee_cents: 80,
    pay_all_cents: null,
    each_pays_cents: null,
    guarantee_cents: null,
    ...over,
  };
}

const handlers = () => ({ onUnpublish: jest.fn(), onJoin: jest.fn(), onAccept: jest.fn(), onView: jest.fn() });

describe('PostActions (spec 13 "Publish game")', () => {
  it('Join, with the server\'s price for the side', async () => {
    const h = handlers();
    await render(<PostActions kind="players" quote={quote()} joinedByMe={false} busy={false} error={null} {...h} />);
    expect(screen.getByText('€4.80 each')).toBeTruthy();
    fireEvent.press(screen.getByTestId('post-join'));
    expect(h.onJoin).toHaveBeenCalled();
  });

  it('nothing to pay when the side paid for everyone', async () => {
    await render(
      <PostActions kind="players" quote={quote({ join_cents: 0 })} joinedByMe={false} busy={false} error={null} {...handlers()} />,
    );
    expect(screen.getByText('Paid by the captain')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('Accept as opponent, with side B\'s price and when it closes (24 hours before kickoff)', async () => {
    const h = handlers();
    await render(
      <PostActions
        kind="opposition"
        quote={quote({ kind: 'opposition', side: 'b', join_cents: null, pay_all_cents: 2275, each_pays_cents: 480, guarantee_cents: 2000 })}
        joinedByMe={false}
        busy={false}
        error={null}
        {...h}
      />,
    );
    expect(screen.getByText('€22.75 for your side, or €4.80 each')).toBeTruthy();
    expect(screen.getByText('Accept by Fri 8 Jan, 10:00')).toBeTruthy();
    fireEvent.press(screen.getByTestId('post-accept-opponent'));
    expect(h.onAccept).toHaveBeenCalled();
  });

  it('my own post: Unpublish', async () => {
    const h = handlers();
    await render(<PostActions kind="players" quote={quote({ mine: true })} joinedByMe={false} busy={false} error={null} {...h} />);
    fireEvent.press(screen.getByTestId('post-unpublish'));
    expect(h.onUnpublish).toHaveBeenCalled();
    expect(screen.queryByTestId('post-join')).toBeNull();
  });

  it('a game I joined: View booking', async () => {
    const h = handlers();
    await render(<PostActions kind="players" quote={quote({ open: false })} joinedByMe busy={false} error={null} {...h} />);
    fireEvent.press(screen.getByTestId('post-view-booking'));
    expect(h.onView).toHaveBeenCalled();
  });

  it('closed: says so, with no button', async () => {
    await render(
      <PostActions kind="opposition" quote={quote({ kind: 'opposition', open: false })} joinedByMe={false} busy={false} error={null} {...handlers()} />,
    );
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the server\'s error', async () => {
    await render(<PostActions kind="players" quote={quote({ mine: true })} joinedByMe={false} busy={false} error="Not your post." {...handlers()} />);
    expect(screen.getByText('Not your post.')).toBeTruthy();
  });
});
