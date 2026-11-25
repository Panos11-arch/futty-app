// A6: each card shows get_match_page's data unchanged (05-product section 6).
import { render, screen } from '@testing-library/react-native';

import { MotmCard, ResultCard } from '@/components/match/share-card';
import { colors } from '@/constants/futty-theme';
import { mockMatchPage, mockPagePlayer } from '@/lib/match/mock';
import { shareCardData, type ShareCardData } from '@/lib/match/share-card';

// The card's <Svg> and <Text> as plain views that keep the props they were
// drawn with, so the test reads the words and fills as the card set them.
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  const actual = jest.requireActual<typeof import('react-native-svg')>('react-native-svg');
  return {
    ...actual,
    __esModule: true,
    default: (props: object) => React.createElement(View, props),
    Text: (props: object) => React.createElement(Text, props),
  };
});

const booker = mockPagePlayer('p-booker').name!;
const nikos = mockPagePlayer('p-nikos').name!;

function data(overrides: Parameters<typeof mockMatchPage>[0] = {}): ShareCardData {
  return shareCardData(
    mockMatchPage({
      sides: [
        { side: 'a', label: 'Limassol Lions', teamId: 't1', score: 3 },
        { side: 'b', label: 'Nicosia Nomads', teamId: 't2', score: 1 },
      ],
      goals: [
        { side: 'a', scorer: mockPagePlayer('p-booker'), assist: null },
        { side: 'b', scorer: mockPagePlayer('p-nikos'), assist: null },
        { side: 'a', scorer: null, assist: null },
        { side: 'a', scorer: mockPagePlayer('p-booker'), assist: null },
      ],
      motm: [{ ...mockPagePlayer('p-booker'), votes: 4 }],
      ...overrides,
    }),
  )!;
}

/** The card's text elements with this testID, as drawn (their own props, not the native ones). */
const lines = (id: string) => screen.queryAllByTestId(id);
const texts = (id: string) => lines(id).map((n) => n.props.children as string);
const text = (id: string) => texts(id)[0];

describe('ResultCard', () => {
  it("shows the server's score, sides, scorers, man of the match, venue and date unchanged", async () => {
    await render(<ResultCard data={data()} width={360} />);
    expect(text('card-wordmark')).toBe('Futty');
    expect(text('card-when')).toBe('Sat 14 Nov · 19:00 · Nuevo Campo');
    expect(text('card-side-a')).toBe('Limassol Lions');
    expect(text('card-score')).toBe('3–1');
    expect(text('card-side-b')).toBe('Nicosia Nomads');
    expect(texts('card-scorer-a')).toEqual([booker, 'Own goal', booker]);
    expect(texts('card-scorer-b')).toEqual([nikos]);
    expect(text('card-motm')).toBe(booker);
  });

  it('draws the wordmark in ink, not brand', async () => {
    await render(<ResultCard data={data()} width={360} />);
    expect(lines('card-wordmark')[0].props.fill).toBe(colors.ink);
  });

  it('has no man of the match line before the vote is decided, and no scorers when none were entered', async () => {
    await render(<ResultCard data={data({ motm: [], goals: [] })} width={360} />);
    expect(lines('card-motm')).toEqual([]);
    expect(lines('card-scorer-a')).toEqual([]);
    expect(screen.queryByText('Man of the match')).toBeNull();
  });

  it('is story-shaped at any width', async () => {
    await render(<ResultCard data={data()} width={180} />);
    expect(screen.getByTestId('result-card').props).toMatchObject({ width: 180, height: 320, viewBox: '0 0 360 640' });
  });
});

describe('MotmCard', () => {
  it('shows every tied winner, the match, venue and date', async () => {
    await render(
      <MotmCard
        data={data({ motm: [{ ...mockPagePlayer('p-booker'), votes: 3 }, { ...mockPagePlayer('p-nikos'), votes: 3 }] })}
        width={360}
      />,
    );
    expect(text('card-wordmark')).toBe('Futty');
    expect(texts('card-motm')).toEqual([booker, nikos]);
    expect(text('card-match')).toBe('Limassol Lions 3–1 Nicosia Nomads');
    expect(text('card-when')).toBe('Sat 14 Nov · 19:00 · Nuevo Campo');
  });
});
