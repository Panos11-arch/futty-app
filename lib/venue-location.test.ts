// S17: "Around me" and the venues map. The player's location is asked for
// only when they tap "Around me", rounded on the phone to about 1 km, used
// there to sort venues by distance, and never sent to the server or kept.
const mockRequest = jest.fn();
const mockPosition = jest.fn();
jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3 },
  requestForegroundPermissionsAsync: () => mockRequest(),
  getCurrentPositionAsync: (...args: unknown[]) => mockPosition(...args),
}));

const mockQuery = { select: jest.fn(), in: jest.fn(), not: jest.fn() };
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));

import { renderHook, waitFor } from '@testing-library/react-native';

import {
  CYPRUS_REGION,
  distanceKm,
  distanceLabel,
  fetchVenueCoordinates,
  locateMe,
  mapRegion,
  roundToKm,
  sortByDistance,
  useVenueCoordinates,
} from '@/lib/venue-location';

const NICOSIA = { latitude: 35.1856, longitude: 33.3823 };
const LIMASSOL = { latitude: 34.7071, longitude: 33.0226 };
const LARNACA = { latitude: 34.9003, longitude: 33.6232 };

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockReturnValue(mockQuery);
  mockQuery.select.mockReturnValue(mockQuery);
  mockQuery.in.mockReturnValue(mockQuery);
});

describe('roundToKm: about 1 km, before anything else sees it', () => {
  it('two decimal places', () => {
    expect(roundToKm({ latitude: 35.185649, longitude: 33.382271 })).toEqual({ latitude: 35.19, longitude: 33.38 });
    expect(roundToKm({ latitude: -0.004, longitude: 0.005 })).toEqual({ latitude: -0, longitude: 0.01 });
  });
});

describe('distanceKm and distanceLabel', () => {
  it('Nicosia to Limassol is about 63 km', () => {
    expect(distanceKm(NICOSIA, LIMASSOL)).toBeGreaterThan(60);
    expect(distanceKm(NICOSIA, LIMASSOL)).toBeLessThan(66);
    expect(distanceKm(NICOSIA, NICOSIA)).toBe(0);
  });

  it('whole kilometres, never under 1', () => {
    expect(distanceLabel(0.2)).toBe('1 km');
    expect(distanceLabel(3.4)).toBe('3 km');
    expect(distanceLabel(62.7)).toBe('63 km');
  });
});

describe('sortByDistance', () => {
  const rows = [{ venue_id: 'limassol' }, { venue_id: 'none' }, { venue_id: 'larnaca' }, { venue_id: 'nicosia' }];
  const coords = { limassol: LIMASSOL, larnaca: LARNACA, nicosia: NICOSIA };

  it('nearest first; venues without coordinates last, in the server\'s order', () => {
    expect(sortByDistance(rows, coords, NICOSIA).map((r) => r.venue_id)).toEqual(['nicosia', 'larnaca', 'limassol', 'none']);
  });

  it('does not change the list it was given', () => {
    sortByDistance(rows, coords, NICOSIA);
    expect(rows.map((r) => r.venue_id)).toEqual(['limassol', 'none', 'larnaca', 'nicosia']);
  });
});

describe('fetchVenueCoordinates', () => {
  it('reads the venues\' coordinates (RLS: venues the player can see), only those that have them', async () => {
    mockQuery.not.mockResolvedValue({
      data: [{ id: 'a', latitude: 35.1, longitude: 33.3 }, { id: 'b', latitude: null, longitude: null }],
      error: null,
    });
    await expect(fetchVenueCoordinates(['a', 'b'])).resolves.toEqual({ a: { latitude: 35.1, longitude: 33.3 } });
    expect(mockFrom).toHaveBeenCalledWith('venues');
    expect(mockQuery.select).toHaveBeenCalledWith('id, latitude, longitude');
    expect(mockQuery.in).toHaveBeenCalledWith('id', ['a', 'b']);
    expect(mockQuery.not).toHaveBeenCalledWith('latitude', 'is', null);
  });

  it('no venues: no call', async () => {
    await expect(fetchVenueCoordinates([])).resolves.toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('an error reads as no coordinates (the map and distances just leave them out)', async () => {
    mockQuery.not.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchVenueCoordinates(['a'])).resolves.toEqual({});
  });
});

describe('locateMe', () => {
  it('asks for permission, then a rough position, rounded to about 1 km', async () => {
    mockRequest.mockResolvedValue({ granted: true });
    mockPosition.mockResolvedValue({ coords: { latitude: 35.185649, longitude: 33.382271, accuracy: 900 } });
    await expect(locateMe()).resolves.toEqual({ status: 'ready', here: { latitude: 35.19, longitude: 33.38 } });
    expect(mockPosition).toHaveBeenCalledWith({ accuracy: 2 });
  });

  it('permission refused: denied, and no position asked for', async () => {
    mockRequest.mockResolvedValue({ granted: false });
    await expect(locateMe()).resolves.toEqual({ status: 'denied' });
    expect(mockPosition).not.toHaveBeenCalled();
  });

  it('no position (location services off, timeout): failed', async () => {
    mockRequest.mockResolvedValue({ granted: true });
    mockPosition.mockRejectedValue(new Error('Location services are disabled'));
    await expect(locateMe()).resolves.toEqual({ status: 'failed' });
  });
});

describe('mapRegion', () => {
  it('no pins: all of Cyprus', () => {
    expect(mapRegion([])).toEqual(CYPRUS_REGION);
  });

  it('one pin: centred on it, a few km across', () => {
    const r = mapRegion([NICOSIA]);
    expect(r.latitude).toBe(NICOSIA.latitude);
    expect(r.longitude).toBe(NICOSIA.longitude);
    expect(r.latitudeDelta).toBeGreaterThan(0);
    expect(r.latitudeDelta).toBeLessThan(0.2);
  });

  it('several pins: all of them in view', () => {
    const r = mapRegion([NICOSIA, LIMASSOL, LARNACA]);
    for (const p of [NICOSIA, LIMASSOL, LARNACA]) {
      expect(Math.abs(p.latitude - r.latitude)).toBeLessThan(r.latitudeDelta / 2);
      expect(Math.abs(p.longitude - r.longitude)).toBeLessThan(r.longitudeDelta / 2);
    }
  });
});

describe('useVenueCoordinates (the venue page Home tab\'s map)', () => {
  it('the venue\'s coordinates once read', async () => {
    mockQuery.not.mockResolvedValue({ data: [{ id: 'v1', latitude: 34.69, longitude: 33.09 }], error: null });
    const { result } = await renderHook(() => useVenueCoordinates('v1'));
    await waitFor(() => expect(result.current).toEqual({ latitude: 34.69, longitude: 33.09 }));
    expect(mockQuery.in).toHaveBeenCalledWith('id', ['v1']);
  });

  it('a venue without coordinates: null (no map)', async () => {
    mockQuery.not.mockResolvedValue({ data: [], error: null });
    const { result } = await renderHook(() => useVenueCoordinates('v1'));
    await waitFor(() => expect(mockQuery.not).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('no venue yet: nothing asked', async () => {
    const { result } = await renderHook(() => useVenueCoordinates(undefined));
    expect(result.current).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
