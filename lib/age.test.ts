import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

// eslint-disable-next-line import/first
import {
  AGE_ERROR_FALLBACK,
  DOB_INVALID_MESSAGE,
  DOB_LOCKED_MESSAGE,
  TOO_YOUNG_MESSAGE,
  describeAgeError,
  isDateOfBirthAllowed,
  markAgeStatus,
  saveDateOfBirth,
  useAgeStatus,
} from '@/lib/age';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('describeAgeError', () => {
  it('maps every server code to one line', () => {
    expect(describeAgeError('too_young')).toBe(TOO_YOUNG_MESSAGE);
    expect(TOO_YOUNG_MESSAGE).toBe('You must be 14 or older to use Futty.');
    expect(describeAgeError('invalid_date')).toBe(DOB_INVALID_MESSAGE);
    expect(describeAgeError('date_of_birth_locked')).toBe(DOB_LOCKED_MESSAGE);
    expect(describeAgeError('something else')).toBe(AGE_ERROR_FALLBACK);
    expect(describeAgeError(undefined)).toBe(AGE_ERROR_FALLBACK);
  });

  it('every line is one line of at most 10 words', () => {
    for (const line of [TOO_YOUNG_MESSAGE, DOB_INVALID_MESSAGE, DOB_LOCKED_MESSAGE, AGE_ERROR_FALLBACK]) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(10);
      expect(line).not.toContain('\n');
    }
  });
});

describe('isDateOfBirthAllowed', () => {
  it('asks the server', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await expect(isDateOfBirthAllowed('2010-01-01')).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('date_of_birth_allowed', { p_dob: '2010-01-01' });
  });

  it('false when the server says no', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    await expect(isDateOfBirthAllowed('2020-01-01')).resolves.toBe(false);
  });

  it('throws on a server error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(isDateOfBirthAllowed('2010-01-01')).rejects.toBeTruthy();
  });
});

describe('saveDateOfBirth', () => {
  it('returns the new status and tells the gate', async () => {
    mockRpc.mockResolvedValue({ data: 'ok', error: null });
    await expect(saveDateOfBirth('2000-01-01')).resolves.toEqual({ status: 'ok' });
    expect(mockRpc).toHaveBeenCalledWith('set_date_of_birth', { p_dob: '2000-01-01' });
  });

  it('under 14: too_young (the gate locks)', async () => {
    mockRpc.mockResolvedValue({ data: 'too_young', error: null });
    await expect(saveDateOfBirth('2015-01-01')).resolves.toEqual({ status: 'too_young' });
  });

  it('a server refusal: the one-line error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid_date' } });
    await expect(saveDateOfBirth('2999-01-01')).resolves.toEqual({ error: DOB_INVALID_MESSAGE });
  });

  it('a network failure: the fallback', async () => {
    mockRpc.mockRejectedValue(new Error('network'));
    await expect(saveDateOfBirth('2000-01-01')).resolves.toEqual({ error: AGE_ERROR_FALLBACK });
  });
});

describe('useAgeStatus', () => {
  it('null when signed out, and no read', async () => {
    const { result } = await renderHook(() => useAgeStatus(null));
    expect(result.current).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(['needs_dob', 'too_young', 'ok'] as const)('the server says %s', async (status) => {
    mockRpc.mockResolvedValue({ data: status, error: null });
    const { result } = await renderHook(() => useAgeStatus('u1'));
    await waitFor(() => expect(result.current).toBe(status));
    expect(mockRpc).toHaveBeenCalledWith('my_age_status');
  });

  it('loading until the server answers', async () => {
    mockRpc.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useAgeStatus('u1'));
    expect(result.current).toBe('loading');
  });

  it('stays loading and retries while the read fails', async () => {
    jest.useFakeTimers();
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: 'needs_dob', error: null });
    const { result } = await renderHook(() => useAgeStatus('u1'));
    await act(async () => {});
    expect(result.current).toBe('loading');
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(result.current).toBe('needs_dob');
    expect(mockRpc).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('a player this device has seen as ok gets in at once offline', async () => {
    await AsyncStorage.setItem('futty.age_ok.u1', 'true');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const { result } = await renderHook(() => useAgeStatus('u1'));
    await waitFor(() => expect(result.current).toBe('ok'));
  });

  it('the server wins over the stored flag', async () => {
    await AsyncStorage.setItem('futty.age_ok.u1', 'true');
    mockRpc.mockResolvedValue({ data: 'too_young', error: null });
    const { result } = await renderHook(() => useAgeStatus('u1'));
    await waitFor(() => expect(result.current).toBe('too_young'));
    expect(await AsyncStorage.getItem('futty.age_ok.u1')).toBeNull();
  });

  it('ok is remembered on this device', async () => {
    mockRpc.mockResolvedValue({ data: 'ok', error: null });
    await renderHook(() => useAgeStatus('u1'));
    await waitFor(async () => expect(await AsyncStorage.getItem('futty.age_ok.u1')).toBe('true'));
  });

  it('a saved date of birth updates the gate without another read', async () => {
    mockRpc.mockResolvedValue({ data: 'needs_dob', error: null });
    const { result } = await renderHook(() => useAgeStatus('u1'));
    await waitFor(() => expect(result.current).toBe('needs_dob'));
    await act(async () => markAgeStatus('ok'));
    expect(result.current).toBe('ok');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
