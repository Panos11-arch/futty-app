// S19: Share on the player card: an image of the card (react-native-view-shot)
// with the link, through the phone's share menu (Instagram, WhatsApp,
// AirDrop...).
import { Platform, Share } from 'react-native';

import { SHARE_FAILED, shareMyCard } from '@/lib/player-card-share';

const mockCapture = jest.fn();
jest.mock('react-native-view-shot', () => ({ captureRef: (...args: unknown[]) => mockCapture(...args) }));

const mockShareAsync = jest.fn();
const mockAvailable = jest.fn();
jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
  isAvailableAsync: () => mockAvailable(),
}));

const view = { current: {} } as never;
const LINK = 'https://futty.app/p/dimi';
const URI = 'file:///cache/card.png';
const realOS = Platform.OS;

function setOS(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

let shareSpy: jest.SpyInstance;
beforeEach(() => {
  mockCapture.mockReset().mockResolvedValue(URI);
  mockShareAsync.mockReset().mockResolvedValue(undefined);
  mockAvailable.mockReset().mockResolvedValue(true);
  shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});
afterEach(() => {
  shareSpy.mockRestore();
  setOS(realOS as 'ios' | 'android');
});

describe('shareMyCard', () => {
  it('captures the card as a PNG file', async () => {
    setOS('ios');
    await shareMyCard(view, LINK);
    expect(mockCapture).toHaveBeenCalledWith(view, { format: 'png', quality: 1, result: 'tmpfile' });
  });

  it('on iPhone shares the image and the link together', async () => {
    setOS('ios');
    await expect(shareMyCard(view, LINK)).resolves.toEqual({ status: 'shared' });
    expect(shareSpy).toHaveBeenCalledWith({ url: URI, message: LINK });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('on Android shares the image file (its QR holds the link)', async () => {
    setOS('android');
    await expect(shareMyCard(view, LINK)).resolves.toEqual({ status: 'shared' });
    expect(mockShareAsync).toHaveBeenCalledWith(URI, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Share my card',
    });
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('on Android without a share menu, shares the link as text', async () => {
    setOS('android');
    mockAvailable.mockResolvedValue(false);
    await expect(shareMyCard(view, LINK)).resolves.toEqual({ status: 'shared' });
    expect(shareSpy).toHaveBeenCalledWith({ message: LINK });
  });

  it('closing the share menu is not an error', async () => {
    setOS('ios');
    shareSpy.mockResolvedValue({ action: Share.dismissedAction });
    await expect(shareMyCard(view, LINK)).resolves.toEqual({ status: 'shared' });
  });

  it('a failed capture or share gives one line to show', async () => {
    setOS('ios');
    mockCapture.mockRejectedValue(new Error('no view'));
    await expect(shareMyCard(view, LINK)).resolves.toEqual({ status: 'error', message: SHARE_FAILED });

    mockCapture.mockResolvedValue(URI);
    shareSpy.mockRejectedValue(new Error('denied'));
    await expect(shareMyCard(view, LINK)).resolves.toEqual({ status: 'error', message: SHARE_FAILED });
  });

  it('the error line follows the words rules', () => {
    expect(SHARE_FAILED).toBe("Your card couldn't be shared. Try again.");
    expect(SHARE_FAILED.split(/\s+/).length).toBeLessThanOrEqual(10);
  });
});
