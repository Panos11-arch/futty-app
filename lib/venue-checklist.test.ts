import { fetchSetupStatus, setupSteps } from './venue-checklist';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

beforeEach(() => mockRpc.mockReset());

const status = {
  photos: true,
  amenities: false,
  menu: true,
  hours: true,
  contact: false,
  pitches: true,
  prices: false,
  complete: false,
};

describe('setupSteps', () => {
  it('the seven parts in order, each with its screen and a tick from the server', () => {
    expect(setupSteps(status)).toEqual([
      { key: 'photos', label: 'Photos', pathname: '/venue-photos', done: true },
      { key: 'amenities', label: 'Amenities', pathname: '/venue-amenities', done: false },
      { key: 'menu', label: 'Food & drink', pathname: '/venue-menu', done: true },
      { key: 'hours', label: 'Opening hours', pathname: '/venue-hours', done: true },
      { key: 'contact', label: 'Phone and website', pathname: '/venue-contact', done: false },
      { key: 'pitches', label: 'Pitches', pathname: '/venue-pitches', done: true },
      { key: 'prices', label: 'Prices', pathname: '/venue-prices', done: false },
    ]);
  });
});

describe('fetchSetupStatus', () => {
  it('asks the server for the venue\'s checklist', async () => {
    mockRpc.mockResolvedValue({ data: status, error: null });
    expect(await fetchSetupStatus('v1')).toEqual(status);
    expect(mockRpc).toHaveBeenCalledWith('venue_setup_status', { p_venue_id: 'v1' });
  });

  it('a refusal is an error in words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not_venue_staff' } });
    await expect(fetchSetupStatus('v1')).rejects.toThrow('Could not load your venue. Try again.');
  });
});
