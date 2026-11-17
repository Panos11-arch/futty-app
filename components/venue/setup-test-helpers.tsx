// Shared Jest set-up for the P6e setup screens' tests (not used by the app):
// a supabase.rpc stand-in that answers venue_setup (and venue_media) from a fixture and every
// write with success, unless a test says otherwise.
import { venueMedia } from '@/lib/venue-media.fixtures';
import type { VenueMedia } from '@/lib/venue-media';
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

/** Calls other than the venue_setup and venue_media reads. */
export function writes(): string[] {
  return rpc.mock.calls.map(([name]) => name).filter((name) => name !== 'venue_setup' && name !== 'venue_media');
}

export function resetRpc(setup: VenueSetup = venueSetup()) {
  rpc.mockClear();
  for (const key of Object.keys(rpcReplies)) delete rpcReplies[key];
  rpcReplies.venue_setup = () => ({ data: setup, error: null });
}

export function refuse(fn: string, code: string) {
  rpcReplies[fn] = () => ({ data: null, error: { message: code } });
}

// ---- P6e photos, amenities and menu --------------------------------------

/** A supabase.storage.from(...) stand-in: every path signs, every upload and removal works. */
export const storage = {
  createSignedUrls: jest.fn((paths: string[], _seconds: number) =>
    Promise.resolve({ data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` })), error: null }),
  ),
  upload: jest.fn((_path: string, _bytes: unknown, _options: unknown) => Promise.resolve({ data: {}, error: null })),
  remove: jest.fn((_paths: string[]) => Promise.resolve({ data: [], error: null })),
};

/** Resets the stand-ins, answering venue_media from a fixture. */
export function resetMedia(media: VenueMedia = venueMedia()) {
  resetRpc();
  rpcReplies.venue_media = () => ({ data: media, error: null });
  storage.createSignedUrls.mockClear();
  storage.upload.mockClear();
  storage.remove.mockClear();
}
