// Shared Jest set-up for the P6e setup screens' tests (not used by the app):
// a supabase.rpc stand-in that answers venue_setup from a fixture and every
// write with success, unless a test says otherwise.
import { venueSetup } from '@/lib/venue-setup.fixtures';
import type { VenueSetup } from '@/lib/venue-setup';

export type Reply = { data: unknown; error: { message: string } | null };

export const rpcReplies: Record<string, () => Reply> = {};
export const rpc = jest.fn((fn: string, _args: unknown) =>
  Promise.resolve(rpcReplies[fn] ? rpcReplies[fn]() : { data: null, error: null }),
);

/** The arguments of every call to one server function, in order. */
export function callsTo(fn: string): unknown[] {
  return rpc.mock.calls.filter(([name]) => name === fn).map(([, args]) => args);
}

/** Calls other than the venue_setup reads. */
export function writes(): string[] {
  return rpc.mock.calls.map(([name]) => name).filter((name) => name !== 'venue_setup');
}

export function resetRpc(setup: VenueSetup = venueSetup()) {
  rpc.mockClear();
  for (const key of Object.keys(rpcReplies)) delete rpcReplies[key];
  rpcReplies.venue_setup = () => ({ data: setup, error: null });
}

export function refuse(fn: string, code: string) {
  rpcReplies[fn] = () => ({ data: null, error: { message: code } });
}
