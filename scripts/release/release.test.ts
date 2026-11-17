import {
  DEMO_EMAIL,
  DEMO_USERNAME,
  demoUserAttributes,
  describeCheck,
  isLocalUrl,
  parseCommand,
  readDemoPassword,
} from './release';
import { USERNAME_PATTERN } from '@/lib/username';

describe('release steps', () => {
  it('knows its three commands and nothing else', () => {
    expect(parseCommand('demo-account')).toBe('demo-account');
    expect(parseCommand('unlive-unsigned')).toBe('unlive-unsigned');
    expect(parseCommand('check')).toBe('check');
    expect(parseCommand('setup_app_review')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });

  it('takes the demo password only from FUTTY_DEMO_PASSWORD', () => {
    expect(readDemoPassword({})).toEqual({ error: expect.stringContaining('FUTTY_DEMO_PASSWORD') });
    expect(readDemoPassword({ FUTTY_DEMO_PASSWORD: '' })).toHaveProperty('error');
    expect(readDemoPassword({ FUTTY_DEMO_PASSWORD: 'short-pass1' })).toEqual({
      error: 'FUTTY_DEMO_PASSWORD must be at least 12 characters.',
    });
    expect(readDemoPassword({ FUTTY_DEMO_PASSWORD: 'a-long-enough-one' })).toEqual({ password: 'a-long-enough-one' });
  });

  it('makes review@futty.app confirmed, with a valid username so it skips choose-username', () => {
    const attributes = demoUserAttributes('a-long-enough-one');
    expect(attributes).toEqual({
      email: 'review@futty.app',
      password: 'a-long-enough-one',
      email_confirm: true,
      user_metadata: { username: DEMO_USERNAME, full_name: 'App Review' },
    });
    expect(DEMO_EMAIL).toBe('review@futty.app');
    expect(USERNAME_PATTERN.test(DEMO_USERNAME)).toBe(true);
  });

  it('runs against production only when told to', () => {
    expect(isLocalUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalUrl('https://abcd.supabase.co')).toBe(false);
  });

  it('describes release_check: ready, or every problem', () => {
    expect(
      describeCheck({
        ok: true,
        problems: [],
        quote: { venue_id: 'v1', day: '2026-11-20', start_time: '18:00:00' },
      }),
    ).toEqual(['Ready: the demo account gets a quote at venue v1 on 2026-11-20 at 18:00:00.']);

    expect(
      describeCheck({
        ok: false,
        quote: null,
        problems: [
          { problem: 'unsigned_venue_live', venue_id: 'v2', name: 'Nuevo Campo' },
          { problem: 'no_signed_venue' },
          { problem: 'demo_account_missing', email: DEMO_EMAIL },
          { problem: 'demo_cannot_quote', email: DEMO_EMAIL },
        ],
      }),
    ).toEqual([
      'Live but not signed: Nuevo Campo (v2). Run unlive-unsigned, or set its signed_at.',
      'No signed venue is live, so nothing can be booked.',
      'No demo account review@futty.app. Run demo-account.',
      'review@futty.app got no checkout quote at any signed venue in the next 7 days (no free slot or no price).',
    ]);
  });
});
