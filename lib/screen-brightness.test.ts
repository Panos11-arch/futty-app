// S19: the full-screen QR raises the screen's brightness. Until expo-brightness
// is added (its own shared PR and a new development build, decided 25
// November), raising does nothing and restoring is safe to call.
import { raiseBrightness } from '@/lib/screen-brightness';

describe('raiseBrightness', () => {
  it('resolves to a restore function that can be called more than once', async () => {
    const restore = await raiseBrightness();
    expect(typeof restore).toBe('function');
    expect(() => {
      restore();
      restore();
    }).not.toThrow();
  });
});
