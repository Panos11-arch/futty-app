// S13A: photos a player attaches to a Futty AI question. The phone resizes
// each to a 1600 px JPEG before sending it as base64; here they are checked
// (at most 3, real JPEGs, at most 2 MB each, the bucket's limit) before the
// model or storage sees them.

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export type Photo = { base64: string; bytes: Uint8Array };
export type PhotoError = 'too_many_photos' | 'bad_photo';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL = /^data:image\/jpeg;base64,/;

function decode(base64: string): Uint8Array | null {
  if (!BASE64.test(base64) || base64.length % 4 !== 0) return null;
  // Too big before decoding: 4 base64 characters carry 3 bytes.
  if ((base64.length / 4) * 3 - 2 > MAX_PHOTO_BYTES) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** The request's photos, each a JPEG; or why they're refused. */
export function readPhotos(raw: unknown): { photos: Photo[] } | { error: PhotoError } {
  if (raw === undefined || raw === null) return { photos: [] };
  if (!Array.isArray(raw)) return { error: 'bad_photo' };
  if (raw.length > MAX_PHOTOS) return { error: 'too_many_photos' };
  const photos: Photo[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return { error: 'bad_photo' };
    const base64 = item.replace(DATA_URL, '');
    const bytes = decode(base64);
    // A JPEG starts FF D8 FF.
    if (!bytes || bytes.length > MAX_PHOTO_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return { error: 'bad_photo' };
    }
    photos.push({ base64, bytes });
  }
  return { photos };
}
