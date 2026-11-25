// S13A: photos sent to Futty AI. Up to 3 per message, JPEG only (the phone
// resizes to 1600 px JPEG), at most 2 MB each; anything else is refused
// before the model or storage sees it.
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { MAX_PHOTO_BYTES, MAX_PHOTOS, readPhotos } from './photos.ts';

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
/** A tiny "JPEG": the start-of-image marker and a few bytes. */
export const JPEG = toBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));

Deno.test('no photos is fine', () => {
  deepStrictEqual(readPhotos(undefined), { photos: [] });
  deepStrictEqual(readPhotos([]), { photos: [] });
});

Deno.test('up to 3 JPEGs are read', () => {
  const result = readPhotos([JPEG, JPEG, JPEG]);
  ok('photos' in result);
  strictEqual(result.photos.length, MAX_PHOTOS);
  strictEqual(result.photos[0].base64, JPEG);
  deepStrictEqual([...result.photos[0].bytes.slice(0, 3)], [0xff, 0xd8, 0xff]);
});

Deno.test('a fourth photo is refused', () => {
  deepStrictEqual(readPhotos([JPEG, JPEG, JPEG, JPEG]), { error: 'too_many_photos' });
});

Deno.test('not a list, not base64, not a JPEG or too big: refused', () => {
  deepStrictEqual(readPhotos('x'), { error: 'bad_photo' });
  deepStrictEqual(readPhotos([42]), { error: 'bad_photo' });
  deepStrictEqual(readPhotos(['not base64!']), { error: 'bad_photo' });
  deepStrictEqual(readPhotos(['']), { error: 'bad_photo' });
  const png = toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]));
  deepStrictEqual(readPhotos([png]), { error: 'bad_photo' });
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  let binary = '';
  for (let i = 0; i < big.length; i += 0x8000) binary += String.fromCharCode(...big.subarray(i, i + 0x8000));
  deepStrictEqual(readPhotos([btoa(binary)]), { error: 'bad_photo' });
});

Deno.test('a data URL prefix is accepted and stripped', () => {
  const result = readPhotos([`data:image/jpeg;base64,${JPEG}`]);
  ok('photos' in result);
  strictEqual(result.photos[0].base64, JPEG);
});
