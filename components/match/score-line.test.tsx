import { render, screen } from '@testing-library/react-native';

import { ScoreLine } from '@/components/match/score-line';
import { flatStyle } from '@/components/ui/test-utils';
import { type } from '@/constants/futty-theme';
import {
  mockDisputed,
  mockDraw,
  mockForfeitNoShow,
  mockForfeitPulledOut,
  mockMatchItems,
  mockNoResult,
  mockPlayed,
  mockSideAWon,
  mockSideBWon,
  mockUpcoming,
  mockVoid,
} from '@/lib/match/mock';
import type { MatchListItem } from '@/lib/match/types';

const tabular = (text: string) => flatStyle(screen.getByText(text)).fontVariant;

describe('ScoreLine', () => {
  it.each([
    ['side a won', mockSideAWon, '3 – 1', 'Home FC 3, Away FC 1', 'Home FC', 'Away FC'],
    ['side b won', mockSideBWon, '0 – 2', 'Home FC 0, Away FC 2', 'Away FC', 'Home FC'],
  ] as const)('%s: tabular score, the winner in bold', async (_, item, score, label, winner, loser) => {
    await render(<ScoreLine item={item} />);
    expect(screen.getByLabelText(label)).toBeTruthy();
    expect(tabular(score)).toEqual(['tabular-nums']);
    expect(flatStyle(screen.getByText(winner)).fontFamily).toBe(type.headline.fontFamily);
    expect(flatStyle(screen.getByText(loser)).fontFamily).toBe(type.body.fontFamily);
  });

  it('a draw: neither side in bold', async () => {
    await render(<ScoreLine item={mockDraw} />);
    expect(screen.getByLabelText('Bibs 2, Non-bibs 2')).toBeTruthy();
    expect(tabular('2 – 2')).toEqual(['tabular-nums']);
    expect(flatStyle(screen.getByText('Bibs')).fontFamily).toBe(type.body.fontFamily);
    expect(flatStyle(screen.getByText('Non-bibs')).fontFamily).toBe(type.body.fontFamily);
  });

  it.each([
    ['a pull-out', mockForfeitPulledOut, 'Away FC pulled out', 'Home FC'],
    ['a no-show', mockForfeitNoShow, "Home FC didn't show", 'Away FC'],
  ] as const)('a forfeit after %s: no score, who forfeited, the other side in bold', async (_, item, caption, winner) => {
    await render(<ScoreLine item={item} />);
    expect(screen.getByText('Forfeit')).toBeTruthy();
    expect(screen.getByText(caption)).toBeTruthy();
    expect(screen.queryByText(/\d – \d/)).toBeNull();
    expect(flatStyle(screen.getByText(winner)).fontFamily).toBe(type.headline.fontFamily);
    expect(screen.getByLabelText(`Home FC v Away FC, forfeit. ${caption}`)).toBeTruthy();
  });

  it.each([
    ['disputed', mockDisputed, 'Disputed · not in stats'],
    ['no_result', mockNoResult, 'No result entered'],
    ['played', mockPlayed, 'Waiting for the result'],
  ] as const)('%s: a dash and why', async (_, item, caption) => {
    await render(<ScoreLine item={item} />);
    expect(screen.getByText('–')).toBeTruthy();
    expect(screen.getByText(caption)).toBeTruthy();
  });

  it('scheduled: the kickoff time in Cyprus time, tabular', async () => {
    await render(<ScoreLine item={mockUpcoming} />);
    expect(tabular('19:00')).toEqual(['tabular-nums']);
    expect(screen.getByLabelText('Home FC v Away FC, kicks off at 19:00')).toBeTruthy();
  });

  it('void: shown as cancelled, with the time it would have been', async () => {
    await render(<ScoreLine item={mockVoid} />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(tabular('19:00')).toEqual(['tabular-nums']);
  });

  it.each(mockMatchItems.map((i) => [i.match.status, i] as const))(
    '%s never says "void"',
    async (_, item: MatchListItem) => {
      await render(<ScoreLine item={item} />);
      expect(JSON.stringify(screen.toJSON())).not.toMatch(/void/i);
    },
  );
});
