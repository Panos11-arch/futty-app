// S7: Share on the feed's result card. It loads the match page and opens the
// match page's sheet: a 1080 x 1920 story card through the phone's share
// sheet (Instagram Stories, WhatsApp, save). No Meta app ID.
import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MatchResultCard } from '@/components/community/match-result-card';
import { ResultShare, SHARE_OPEN_FAILED } from '@/components/community/result-share';
import { mockMatchPage, mockPagePlayer } from '@/lib/match/mock';

import { result } from './fixtures';

const mockGetMatchPage = jest.fn();
jest.mock('@/lib/match/page-api', () => ({ getMatchPage: (...a: unknown[]) => mockGetMatchPage(...a) }));

// The card's <Svg> as a view whose ref can export, like the native one.
const mockToDataURL = jest.fn((cb: (base64: string) => void, _options?: object) => cb('iVBORw0KGgo='));
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  const actual = jest.requireActual<typeof import('react-native-svg')>('react-native-svg');
  class MockSvg extends React.Component<object> {
    toDataURL(cb: (base64: string) => void, options?: object) {
      return mockToDataURL(cb, options);
    }
    render() {
      return React.createElement(View, this.props);
    }
  }
  return {
    ...actual,
    __esModule: true,
    default: MockSvg,
    Text: (props: object) => React.createElement(Text, props),
  };
});
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
    }
    create() {}
    write() {}
  },
}));
const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

// A confirmed result with a scorer who is a minor: the server already sends
// only their first name (A5), and the card draws it as sent.
const page = () =>
  mockMatchPage({
    matchId: 'm1',
    sides: [
      { side: 'a', label: 'Kato United', teamId: 't1', score: 3 },
      { side: 'b', label: 'Limassol Lions', teamId: 't2', score: 2 },
    ],
    goals: [{ side: 'a', scorer: { ...mockPagePlayer('p-nikos'), name: 'Maria' }, assist: null }],
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Share on the feed result card', () => {
  it('the result card has Share; a forfeit has none', async () => {
    await render(<MatchResultCard item={result()} />);
    expect(screen.getByTestId('feed-result-share-m1')).toBeTruthy();
    await render(<MatchResultCard item={result({ forfeit_side: 'a', side_a_score: null, side_b_score: null })} />);
    expect(screen.queryByTestId('feed-result-share-m1')).toBeNull();
  });

  it('loads the match page and shows the story card with score, sides, scorers and futty.app', async () => {
    mockGetMatchPage.mockResolvedValue({ page: page(), error: null });
    await render(<ResultShare matchId="m1" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(mockGetMatchPage).toHaveBeenCalledWith('m1');
    expect(await screen.findByText('Share the match')).toBeTruthy();
    expect(screen.getByTestId('result-card')).toBeTruthy();
    expect(screen.getByTestId('card-score').props.children).toBe('3–2');
    expect(screen.getByTestId('card-side-a').props.children).toBe('Kato United');
    expect(screen.getByTestId('card-side-b').props.children).toBe('Limassol Lions');
    expect(screen.getByTestId('card-scorer-a').props.children).toBe('Maria');
    expect(screen.getByTestId('card-wordmark').props.children).toBe('Futty');
    expect(screen.getByTestId('card-site').props.children).toBe('futty.app');
  });

  it('shares a 1080 x 1920 PNG through the share sheet', async () => {
    mockGetMatchPage.mockResolvedValue({ page: page(), error: null });
    await render(<ResultShare matchId="m1" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result card' }));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    expect(mockToDataURL.mock.calls[0][1]).toEqual({ width: 1080, height: 1920 });
    expect(mockShare).toHaveBeenCalledWith(
      'file:///cache/futty-result-m1.png',
      expect.objectContaining({ mimeType: 'image/png' }),
    );
  });

  it('loads the page once, then reopens the sheet', async () => {
    mockGetMatchPage.mockResolvedValue({ page: page(), error: null });
    await render(<ResultShare matchId="m1" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    await screen.findByText('Share the match');
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(mockGetMatchPage).toHaveBeenCalledTimes(1);
  });

  it('a page that fails to load says so in one line', async () => {
    mockGetMatchPage.mockResolvedValue({ page: null, error: { message: 'match_not_found' } });
    await render(<ResultShare matchId="m1" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText(SHARE_OPEN_FAILED)).toBeTruthy();
    expect(screen.queryByText('Share the match')).toBeNull();
  });

  it('a match with no card (no score) says so too', async () => {
    mockGetMatchPage.mockResolvedValue({ page: mockMatchPage({ status: 'disputed' }), error: null });
    await render(<ResultShare matchId="m1" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText(SHARE_OPEN_FAILED)).toBeTruthy();
  });
});
