import {
  describeWhatsAppError,
  getWhatsAppState,
  normalisePhone,
  setNotificationChannel,
  setWhatsAppNumber,
  stopWhatsApp,
} from '@/lib/whatsapp';

let mockCalls: unknown[][] = [];
let mockResults: Record<string, { data: unknown; error: unknown }> = {};

jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    const query: Record<string, unknown> = {
      select: (...a: unknown[]) => {
        mockCalls.push(['select', name, ...a]);
        return query;
      },
      maybeSingle: () => query,
      then: (resolve: (r: unknown) => unknown) => resolve(mockResults[name] ?? { data: null, error: null }),
    };
    return query;
  };
  return {
    supabase: {
      from: (name: string) => table(name),
      rpc: (fn: string, args?: unknown) => {
        mockCalls.push(['rpc', fn, args]);
        return Promise.resolve(mockResults[fn] ?? { data: null, error: null });
      },
    },
  };
});

beforeEach(() => {
  mockCalls = [];
  mockResults = {};
});

describe('getWhatsAppState', () => {
  it('on, with an active number, the types in reminder order and the choices', async () => {
    mockResults = {
      whatsapp_enabled: { data: true, error: null },
      whatsapp_contacts: { data: { phone_e164: '+35799123456', opted_out_at: null }, error: null },
      whatsapp_notification_types: {
        data: [{ type: 'match_after_game' }, { type: 'match_reminder_2h' }, { type: 'match_reminder_24h' }],
        error: null,
      },
      notification_channels: { data: [{ type: 'match_reminder_2h', channel: 'both' }], error: null },
    };
    const { state } = await getWhatsAppState();
    expect(state).toEqual({
      enabled: true,
      phone: '+35799123456',
      types: ['match_reminder_24h', 'match_reminder_2h', 'match_after_game'],
      channels: { match_reminder_2h: 'both' },
    });
  });

  it('an opted-out number is no number; off is off', async () => {
    mockResults = {
      whatsapp_enabled: { data: false, error: null },
      whatsapp_contacts: { data: { phone_e164: '+35799123456', opted_out_at: '2026-11-18T10:00:00Z' }, error: null },
    };
    const { state } = await getWhatsAppState();
    expect(state).toMatchObject({ enabled: false, phone: null, types: [], channels: {} });
  });

  it('an error is passed on', async () => {
    mockResults = { whatsapp_contacts: { data: null, error: { message: 'boom' } } };
    expect(await getWhatsAppState()).toEqual({ state: null, error: { message: 'boom' } });
  });
});

describe('normalisePhone', () => {
  it.each([
    ['99 123 456', '+35799123456'],
    ['22-123456', '+35722123456'],
    ['0035799123456', '+35799123456'],
    ['+44 7700 900123', '+44 7700 900123'],
    ['123', '123'],
  ])('%s → %s', (input, out) => {
    expect(normalisePhone(input)).toBe(out);
  });
});

describe('writes go through the server functions', () => {
  it('number, stop and channel', async () => {
    mockResults = { set_whatsapp_number: { data: { phone: '+35799123456', active: true }, error: null } };
    expect(await setWhatsAppNumber('99 123 456')).toEqual({ phone: '+35799123456', error: null });
    await stopWhatsApp();
    await setNotificationChannel('match_reminder_2h', 'whatsapp');
    expect(mockCalls).toEqual([
      ['rpc', 'set_whatsapp_number', { p_phone: '+35799123456' }],
      ['rpc', 'stop_whatsapp', undefined],
      ['rpc', 'set_notification_channel', { p_type: 'match_reminder_2h', p_channel: 'whatsapp' }],
    ]);
  });

  it('server errors in plain words', () => {
    expect(describeWhatsAppError('phone_in_use')).toBe('That number is already used for WhatsApp by another Futty account.');
    expect(describeWhatsAppError('invalid_phone')).toContain('country code');
    expect(describeWhatsAppError('whatsapp_unavailable')).toBe('WhatsApp reminders aren’t available yet.');
    expect(describeWhatsAppError('nope')).toBe('Something went wrong. Try again.');
  });
});
