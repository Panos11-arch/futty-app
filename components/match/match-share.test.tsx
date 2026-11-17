// A6 "Share" on the match page: confirmed matches with a score only; each
// card is exported as a PNG and its file path handed to the share sheet; a
// failed export says so inline, with "Try again".
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MatchShare } from '@/components/match/match-share';
import { mockMatchPage, mockPagePlayer } from '@/lib/match/mock';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));

// The card's <Svg> as a view whose ref can export, like the native one.
const mockToDataURL = jest.fn((cb: (base64: string) => void, _options?: object) => cb('iVBORw0KGgo='));
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const actual = jest.requireActual<typeof import('react-native-svg')>('react-native-svg');
  class MockSvg extends React.Component<object> {
    toDataURL(cb: (base64: string) => void, options?: object) {
      return mockToDataURL(cb, options);
    }
    render() {
      return React.createElement(View, this.props);
    }
  }
  return { ...actual, __esModule: true, default: MockSvg };
});

const mockWrites: { uri: string; options: unknown }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
    }
    create() {}
    write(_content: string, options: unknown) {
      mockWrites.push({ uri: this.uri, options });
    }
  },
}));
const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

beforeEach(() => {
  mockToDataURL.mockClear();
  mockShare.mockClear();
  mockWrites.length = 0;
});

const decided = () => mockMatchPage({ motm: [{ ...mockPagePlayer('p-booker'), votes: 2 }] });

async function openSheet(page = mockMatchPage()) {
  await render(<MatchShare page={page} />);
  await fireEvent.press(screen.getByTestId('match-share'));
}

describe('MatchShare', () => {
  it.each(['scheduled', 'played', 'disputed', 'no_result', 'void'] as const)(
    'shows nothing for a %s match',
    async (status) => {
      await render(<MatchShare page={mockMatchPage({ status })} />);
      expect(screen.queryByTestId('match-share')).toBeNull();
    },
  );

  it('shows nothing for a forfeit, which has no score', async () => {
    await render(<MatchShare page={mockMatchPage({ forfeit: { side: 'a', reason: 'pulled_out' } })} />);
    expect(screen.queryByTestId('match-share')).toBeNull();
  });

  it('shows Share once the match is confirmed', async () => {
    await render(<MatchShare page={mockMatchPage()} />);
    expect(screen.getByText('Share')).toBeTruthy();
  });

  it('shares the result card as a PNG file path', async () => {
    await openSheet();
    await fireEvent.press(screen.getByTestId('share-result'));
    expect(mockToDataURL.mock.calls[0][1]).toEqual({ width: 1080, height: 1920 });
    expect(mockWrites).toEqual([{ uri: 'file:///cache/futty-result-m1.png', options: { encoding: 'base64' } }]);
    expect(mockShare).toHaveBeenCalledTimes(1);
    const [path, options] = mockShare.mock.calls[0] as [string, { mimeType: string }];
    expect(path).toMatch(/^file:\/\/.*\.png$/);
    expect(options.mimeType).toBe('image/png');
  });

  it('offers the man-of-the-match card only once it is decided', async () => {
    await openSheet();
    expect(screen.queryByTestId('share-motm')).toBeNull();
  });

  it('shares the man-of-the-match card when decided', async () => {
    await openSheet(decided());
    await fireEvent.press(screen.getByTestId('share-motm'));
    expect(mockShare.mock.calls[0][0]).toBe('file:///cache/futty-motm-m1.png');
  });

  it('a failed export shows an inline error, and Try again shares', async () => {
    mockToDataURL.mockImplementationOnce(() => {
      throw new Error('native');
    });
    await openSheet();
    await fireEvent.press(screen.getByTestId('share-result'));
    expect(screen.getByText("The card couldn't be shared. Try again.")).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Try again'));
    expect(mockShare).toHaveBeenCalledWith('file:///cache/futty-result-m1.png', expect.objectContaining({ mimeType: 'image/png' }));
    expect(screen.queryByText("The card couldn't be shared. Try again.")).toBeNull();
  });
});
