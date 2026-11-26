import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { CommunityBand } from '@/components/community/community-band';
import { followErrorLine, FollowToggle } from '@/components/community/follow-toggle';
import { MatchResultCard } from '@/components/community/match-result-card';
import { SquadPostCard } from '@/components/community/squad-post-card';
import { inCommonLabel, SuggestionCard } from '@/components/community/suggestion-card';
import { haptic } from '@/lib/haptics';

import { follows, post, result, suggestion } from './fixtures';

const mockOpenFriend = jest.fn();
jest.mock('@/lib/messages', () => ({
  ...jest.requireActual('@/lib/messages'),
  openFriendConversation: (...a: unknown[]) => mockOpenFriend(...a),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommunityBand', () => {
  const props = { tab: 'for_you' as const, onTab: jest.fn(), onSearch: jest.fn(), onMessages: jest.fn() };

  it('three tabs, the current one selected', async () => {
    await render(<CommunityBand {...props} unread={0} />);
    expect(screen.getByRole('tab', { name: 'For you' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('tab', { name: 'Following' }).props.accessibilityState).toEqual({ selected: false });
    await fireEvent.press(screen.getByRole('tab', { name: 'Find players' }));
    expect(props.onTab).toHaveBeenCalledWith('find_players');
  });

  it('Search and Messages, with the unread count', async () => {
    await render(<CommunityBand {...props} unread={3} />);
    await fireEvent.press(screen.getByLabelText('Search players and teams'));
    expect(props.onSearch).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Messages, 3 unread' }));
    expect(props.onMessages).toHaveBeenCalled();
    expect(screen.getByTestId('community-messages-badge', { includeHiddenElements: true })).toBeTruthy();
  });

  it('no badge at 0', async () => {
    await render(<CommunityBand {...props} unread={0} />);
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
    expect(screen.queryByTestId('community-messages-badge', { includeHiddenElements: true })).toBeNull();
  });
});

describe('SquadPostCard', () => {
  it('image 18: name, what they want, spots, the post line, Join squad', async () => {
    await render(<SquadPostCard item={post()} />);
    expect(screen.getByText('Anna')).toBeTruthy();
    expect(screen.getByText('Looking for players · 4 h')).toBeTruthy();
    expect(screen.getByText('2 spots')).toBeTruthy();
    expect(screen.getByText(/^Need 2 for 5-a-side .* at Nuevo Campo\.$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Join squad' }));
    expect(haptic.tap).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/join-squad-post', params: { postId: 'p1' } });
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
  });

  it('the poster opens their profile', async () => {
    await render(<SquadPostCard item={post()} />);
    await fireEvent.press(screen.getByTestId('feed-actor-p1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'u-anna' } });
  });

  it('a team opposition post opens the team and accepts as opponent', async () => {
    await render(
      <SquadPostCard
        item={post({ post_type: 'opposition', actor_kind: 'team', actor_id: 't1', actor_name: 'Lions', spots: null, v2: true })}
      />,
    );
    expect(screen.queryByText(/spots?$/)).toBeNull();
    await fireEvent.press(screen.getByTestId('feed-actor-p1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 't1' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Accept as opponent' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/opposition-invite', params: { postId: 'p1' } });
  });

  it('my own post opens the posts list', async () => {
    await render(<SquadPostCard item={post({ mine: true, can_message: true })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open post' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/squad-posts', params: { view: 'players' } });
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
  });

  it('a closed post that is not mine has no buttons', async () => {
    await render(<SquadPostCard item={post({ post_status: 'cancelled', spots: null })} />);
    expect(screen.queryByRole('button', { name: 'Join squad' })).toBeNull();
  });

  it('Message, when the server allows it, opens the chat', async () => {
    mockOpenFriend.mockResolvedValue({ conversationId: 'c1', error: null });
    await render(<SquadPostCard item={post({ can_message: true })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Message' }));
    expect(mockOpenFriend).toHaveBeenCalledWith('u-anna');
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'c1' } }),
    );
  });

  it('a refused chat says why in one line', async () => {
    mockOpenFriend.mockResolvedValue({ conversationId: null, error: { message: 'not_friends' } });
    await render(<SquadPostCard item={post({ can_message: true })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Message' }));
    expect(await screen.findByText('Add them as a friend to message them.')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('MatchResultCard', () => {
  it('image 18: team, Match result, League, the score panel', async () => {
    await render(<MatchResultCard item={result()} />);
    expect(screen.getByText('Match result · 2 h')).toBeTruthy();
    expect(screen.getByText('League')).toBeTruthy();
    expect(screen.getByText('3 : 2')).toBeTruthy();
    expect(screen.getByLabelText('Kato United 3, Limassol Lions 2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('feed-result-team-t-lions'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 't-lions' } });
    await fireEvent.press(screen.getByTestId('feed-actor-m1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 't-kato' } });
  });

  it('a pickup through a followed player: no league pill, sides not tappable', async () => {
    await render(
      <MatchResultCard
        item={result({
          league: false,
          actor_kind: 'player',
          actor_id: 'u1',
          actor_name: 'Fanis',
          side_a_label: 'Bibs',
          side_a_team_id: null,
          side_b_label: 'Non-bibs',
          side_b_team_id: null,
        })}
      />,
    );
    expect(screen.queryByText('League')).toBeNull();
    expect(screen.queryByTestId(/feed-result-team-/)).toBeNull();
    await fireEvent.press(screen.getByTestId('feed-actor-m1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'u1' } });
  });

  it('a forfeit', async () => {
    await render(<MatchResultCard item={result({ forfeit_side: 'b', side_a_score: null, side_b_score: null })} />);
    expect(screen.getByText('Forfeit')).toBeTruthy();
    expect(screen.getByLabelText('Kato United won by forfeit')).toBeTruthy();
  });
});

describe('SuggestionCard', () => {
  it('avatar, name, matches in common, Follow, dismiss, profile', async () => {
    const f = follows();
    const onDismiss = jest.fn();
    await render(<SuggestionCard suggestion={suggestion()} follows={f} onDismiss={onDismiss} />);
    expect(screen.getByText('3 matches in common')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
    expect(f.toggle).toHaveBeenCalledWith('player', 'u-nikos');
    expect(haptic.tap).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss Nikos' }));
    expect(onDismiss).toHaveBeenCalledWith('u-nikos');
    await fireEvent.press(screen.getByRole('button', { name: 'Nikos, 3 matches in common' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'u-nikos' } });
  });

  it('one match', () => {
    expect(inCommonLabel(1)).toBe('1 match in common');
    expect(inCommonLabel(4)).toBe('4 matches in common');
  });
});

describe('FollowToggle', () => {
  it('Following unfollows without a haptic', async () => {
    const f = follows(['t1']);
    await render(<FollowToggle targetType="team" targetId="t1" name="Lions" follows={f} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Following' }));
    expect(f.toggle).toHaveBeenCalledWith('team', 't1');
    expect(haptic.tap).not.toHaveBeenCalled();
  });

  it('a refused follow says so in one line', async () => {
    const f = follows([], jest.fn().mockResolvedValue({ error: { message: 'age_pair_refused' } }));
    await render(<FollowToggle targetType="player" targetId="u1" name="Maria" follows={f} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
    expect(await screen.findByText("You can't follow this player.")).toBeTruthy();
  });

  it('error lines', () => {
    expect(followErrorLine(null)).toBeNull();
    expect(followErrorLine({ message: 'new row violates: age_pair_refused' })).toBe("You can't follow this player.");
    expect(followErrorLine({ message: 'offline' })).toBe("Couldn't follow. Try again.");
  });
});
