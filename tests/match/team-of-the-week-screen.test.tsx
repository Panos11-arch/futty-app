// S15: /match/team-of-the-week (Home's Team of the Week card, the
// team_of_the_week notification) opens Rankings → Team of the Week, on the
// team it names.
import { render } from '@testing-library/react-native';

import TeamOfTheWeekRedirect from '@/app/match/team-of-the-week';

let mockParams: { teamId?: string | string[] } = {};
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (props: { href: unknown }) => {
    mockRedirect(props.href);
    return null;
  },
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  mockParams = {};
  mockRedirect.mockClear();
});

describe('Team of the Week route', () => {
  it('without a team: Rankings on Team of the Week', async () => {
    await render(<TeamOfTheWeekRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith({ pathname: '/rankings', params: { view: 'totw' } });
  });

  it('with a team (a notification): Rankings on that team', async () => {
    mockParams = { teamId: 't9' };
    await render(<TeamOfTheWeekRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith({ pathname: '/rankings', params: { view: 'totw', teamId: 't9' } });
  });

  it('a repeated param: the first', async () => {
    mockParams = { teamId: ['t1', 't2'] };
    await render(<TeamOfTheWeekRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith({ pathname: '/rankings', params: { view: 'totw', teamId: 't1' } });
  });
});
