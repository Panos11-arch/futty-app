// S2: the Card button, the Futty logo and the Premium screen all ask the same
// question, "is this player on Premium?", and only the server answers it
// (profiles.is_premium). Team Premium doesn't make a player Premium.
import { isPremiumPlayer } from '@/lib/premium';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('isPremiumPlayer', () => {
  it('is true when the server says is_premium', () => {
    expect(isPremiumPlayer({ status: 'ready', profile: { is_premium: true } })).toBe(true);
  });

  it('is false when the server says not', () => {
    expect(isPremiumPlayer({ status: 'ready', profile: { is_premium: false } })).toBe(false);
  });

  it('is false for anything that is not exactly true', () => {
    expect(isPremiumPlayer({ status: 'ready', profile: {} })).toBe(false);
    expect(isPremiumPlayer({ status: 'ready', profile: { is_premium: null } })).toBe(false);
  });

  it('is unknown (null) while loading, missing or failed: callers show Basic', () => {
    expect(isPremiumPlayer({ status: 'loading' })).toBeNull();
    expect(isPremiumPlayer({ status: 'missing' })).toBeNull();
    expect(isPremiumPlayer({ status: 'error' })).toBeNull();
  });
});
