import { renderHook, waitFor } from '@testing-library/react-native';

import { useVenues } from './use-venues';

// A stand-in for supabase.from('venues'): records the filters, then answers.
const mockEq = jest.fn();
jest.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      mockEq(...args);
      return query;
    },
    order: () => query,
    then: (resolve: (r: unknown) => unknown) => resolve({ data: [{ id: 'v1', name: 'Arena', is_live: true }], error: null }),
  };
  return { supabase: { from: () => query } };
});

beforeEach(() => mockEq.mockReset());

it('the Book list asks the server for live venues only', async () => {
  const { result } = await renderHook(() => useVenues({ liveOnly: true }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(mockEq).toHaveBeenCalledWith('is_live', true);
});

it('other screens (My bookings) get every venue the caller may see, a switched-off one with their booking included', async () => {
  const { result } = await renderHook(() => useVenues());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(mockEq).not.toHaveBeenCalled();
});
