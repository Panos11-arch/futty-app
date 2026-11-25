// S13A: photos a player attaches to a Futty AI question, from the camera or
// the library. Each is resized on the phone to a JPEG 1600 px on its long
// edge (never enlarged) and sent as base64 to our function only, which
// passes it to the model and stores it privately for that chat.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from 'expo-image-picker';

/** The long edge photos are sent at (S13A), as staff photos (lib/venue-media.ts). */
export const AI_PHOTO_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.7;

function resizeFor(width: number, height: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= AI_PHOTO_LONG_EDGE) return null;
  return width >= height ? { width: AI_PHOTO_LONG_EDGE } : { height: AI_PHOTO_LONG_EDGE };
}

export type PickedPhoto = { uri: string; base64: string };

async function shrink(asset: { uri: string; width: number; height: number }): Promise<PickedPhoto> {
  let { width, height } = asset;
  if (!width || !height) {
    // The picker didn't say: read the size from the decoded photo.
    ({ width, height } = await ImageManipulator.manipulate(asset.uri).renderAsync());
  }
  const context = ImageManipulator.manipulate(asset.uri);
  const size = resizeFor(width, height);
  if (size) context.resize(size);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  return { uri: saved.uri, base64: saved.base64 ?? '' };
}

/** Up to `room` photos, resized; [] when cancelled; 'denied' when the camera isn't allowed. */
export async function pickAiPhotos(source: 'camera' | 'library', room: number): Promise<PickedPhoto[] | 'denied'> {
  if (room <= 0) return [];
  let result;
  if (source === 'camera') {
    const permission = await requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
    result = await launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  } else {
    result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 1,
    });
  }
  if (result.canceled || !result.assets?.length) return [];
  const photos: PickedPhoto[] = [];
  for (const asset of result.assets.slice(0, room)) photos.push(await shrink(asset));
  return photos.filter((p) => p.base64);
}
