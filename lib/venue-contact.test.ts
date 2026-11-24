import { contactError, saveVenueContact } from './venue-contact';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

beforeEach(() => mockRpc.mockReset());

describe('saveVenueContact', () => {
  it('sends what staff typed; the server checks and returns what it saved', async () => {
    mockRpc.mockResolvedValue({ data: { phone: '+357 25 123456', website: 'https://arena.example.com' }, error: null });
    expect(await saveVenueContact('v1', '+357 25 123456', 'arena.example.com')).toEqual({
      saved: { phone: '+357 25 123456', website: 'https://arena.example.com' },
      error: null,
    });
    expect(mockRpc).toHaveBeenCalledWith('set_venue_contact', {
      p_venue_id: 'v1',
      p_phone: '+357 25 123456',
      p_website: 'arena.example.com',
    });
  });

  it('a refusal comes back in words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid_phone' } });
    expect(await saveVenueContact('v1', 'abc', '')).toEqual({ saved: null, error: 'Check the phone number and try again.' });
  });
});

describe('contactError', () => {
  it('says what happened and what to do', () => {
    expect(contactError('invalid_website')).toBe('Check the website address and try again.');
    expect(contactError('not_venue_staff')).toBe('Only this venue’s staff can change this.');
    expect(contactError('anything else')).toBe('Something went wrong. Try again.');
  });
});
