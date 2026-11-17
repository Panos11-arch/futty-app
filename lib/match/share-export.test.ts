// A6: a card is exported as a 1080 x 1920 PNG, written to the cache and
// handed to the share sheet as a file path.
import { shareCardPng } from '@/lib/match/share-export';

const mockWrites: { uri: string; content: string; options: unknown }[] = [];
const mockWriteError: { current: Error | null } = { current: null };
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
    }
    create() {}
    write(content: string, options: unknown) {
      if (mockWriteError.current) throw mockWriteError.current;
      mockWrites.push({ uri: this.uri, content, options });
    }
  },
}));
const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockAvailable = jest.fn(() => Promise.resolve(true));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

const svg = (base64 = 'iVBORw0KGgo=') => ({
  toDataURL: jest.fn((cb: (b: string) => void, _options?: object) => cb(base64)),
});

beforeEach(() => {
  mockWrites.length = 0;
  mockWriteError.current = null;
  mockShare.mockClear();
  mockAvailable.mockReset().mockResolvedValue(true);
});

describe('shareCardPng', () => {
  it('writes the PNG at story size and shares its file path', async () => {
    const card = svg();
    await expect(shareCardPng(card, 'futty-result-m1.png', 'Result card')).resolves.toEqual({ status: 'shared' });
    expect(card.toDataURL.mock.calls[0][1]).toEqual({ width: 1080, height: 1920 });
    expect(mockWrites).toEqual([
      { uri: 'file:///cache/futty-result-m1.png', content: 'iVBORw0KGgo=', options: { encoding: 'base64' } },
    ]);
    expect(mockShare).toHaveBeenCalledWith('file:///cache/futty-result-m1.png', {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Result card',
    });
  });

  it("says so when sharing isn't available", async () => {
    mockAvailable.mockResolvedValue(false);
    await expect(shareCardPng(svg(), 'a.png', 'Result card')).resolves.toEqual({
      status: 'error',
      message: "Sharing isn't available on this phone.",
    });
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('fails in plain words when the card cannot be drawn', async () => {
    const card = { toDataURL: jest.fn(() => { throw new Error('native'); }) };
    await expect(shareCardPng(card, 'a.png', 'Result card')).resolves.toEqual({
      status: 'error',
      message: "The card couldn't be shared. Try again.",
    });
  });

  it('fails in plain words when the file cannot be written', async () => {
    mockWriteError.current = new Error('disk');
    await expect(shareCardPng(svg(), 'a.png', 'Result card')).resolves.toMatchObject({ status: 'error' });
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('fails when the share sheet fails', async () => {
    mockShare.mockRejectedValueOnce(new Error('share'));
    await expect(shareCardPng(svg(), 'a.png', 'Result card')).resolves.toMatchObject({ status: 'error' });
  });
});
