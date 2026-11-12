import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { FollowButton } from '@/components/match/follow-button';

const mockFollow = jest.fn();
const mockUnfollow = jest.fn();
let mockRows: { target_type: string; target_id: string }[] = [];

const mockAuth = { user: { id: 'me' } };
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/community', () => ({
  follow: (...a: unknown[]) => mockFollow(...a),
  unfollow: (...a: unknown[]) => mockUnfollow(...a),
}));
jest.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve: (r: unknown) => unknown) => resolve({ data: mockRows, error: null }),
  };
  return { supabase: { from: () => query } };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => {
  mockRows = [];
  mockFollow.mockReset().mockResolvedValue({ error: null });
  mockUnfollow.mockReset().mockResolvedValue({ error: null });
});

describe('FollowButton', () => {
  it('follows, then unfollows, the team', async () => {
    await render(<FollowButton targetType="team" targetId="t1" name="Lions" />);
    await waitFor(() => expect(screen.getByText('Follow')).toBeTruthy());

    await fireEvent.press(screen.getByText('Follow'));
    expect(mockFollow).toHaveBeenCalledWith('me', 'team', 't1');
    expect(screen.getByText('Following')).toBeTruthy();

    await fireEvent.press(screen.getByText('Following'));
    expect(mockUnfollow).toHaveBeenCalledWith('me', 'team', 't1');
    expect(screen.getByText('Follow')).toBeTruthy();
  });

  it('shows Following for a team already followed', async () => {
    mockRows = [{ target_type: 'team', target_id: 't1' }];
    await render(<FollowButton targetType="team" targetId="t1" name="Lions" />);
    await waitFor(() => expect(screen.getByText('Following')).toBeTruthy());
  });

  it('goes back to Follow when the write fails', async () => {
    mockFollow.mockResolvedValue({ error: { message: 'boom' } });
    await render(<FollowButton targetType="team" targetId="t1" name="Lions" />);
    await waitFor(() => expect(screen.getByText('Follow')).toBeTruthy());
    await fireEvent.press(screen.getByText('Follow'));
    expect(screen.getByText('Follow')).toBeTruthy();
  });
});
