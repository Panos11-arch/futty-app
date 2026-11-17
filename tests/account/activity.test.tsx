import './mocks';

import { render, screen } from '@testing-library/react-native';

import ActivityScreen from '@/app/account/activity/index';
import MatchesScreen from '@/app/account/activity/matches';
import type { RecentResult } from '@/lib/use-recent-results';

import { CYPRUS_LATE_KICKOFF, onPhoneIn, restorePhoneZone, ZONES_AND_SEASONS } from '../phone-time-zone';

let mockResults: RecentResult[] = [];
jest.mock('@/lib/use-recent-results', () => ({
  useRecentResults: () => ({ status: 'ready', results: mockResults, reload: jest.fn() }),
}));

function result(playedAt: string): RecentResult {
  return {
    key: 'league:f1',
    kind: 'league',
    homeTeamName: 'Tigers',
    awayTeamName: 'Lions',
    homeScore: 3,
    awayScore: 1,
    playedAt,
  };
}

// Every date is the Cyprus date (Asia/Nicosia), whatever zone the phone is in.
describe.each(ZONES_AND_SEASONS)('Activity dates, phone on %s in %s', (zone, season) => {
  const played = CYPRUS_LATE_KICKOFF[season];
  const year = played.day.slice(0, 4);
  beforeEach(() => {
    onPhoneIn(zone);
    mockResults = [result(played.iso)];
  });
  afterEach(restorePhoneZone);

  it('Your activity: the Cyprus day the match was played', async () => {
    await render(<ActivityScreen />);
    expect(screen.getByText(`League · ${played.date}`)).toBeTruthy();
  });

  it('Matches: the Cyprus day and year the match was played', async () => {
    await render(<MatchesScreen />);
    expect(screen.getByText(`League · ${played.date} ${year}`)).toBeTruthy();
  });
});
