// A6: exports a share card (a react-native-svg <Svg>) as a 1080 x 1920 PNG
// (Instagram story size, 05-product section 6), writes it to the cache with
// expo-file-system and opens the share sheet with expo-sharing. Same shape
// as lib/revenue-export.ts.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export const STORY_SIZE = { width: 1080, height: 1920 } as const;

/** The part of a react-native-svg <Svg> ref the export needs. */
export type CardSvg = { toDataURL: (callback: (base64: string) => void, options?: object) => void };

export type ShareCardResult = { status: 'shared' } | { status: 'error'; message: string };

const FAILED = "The card couldn't be shared. Try again.";

function pngBase64(svg: CardSvg): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      svg.toDataURL((base64) => (base64 ? resolve(base64) : reject(new Error('empty'))), { ...STORY_SIZE });
    } catch (e) {
      reject(e);
    }
  });
}

export async function shareCardPng(svg: CardSvg, fileName: string, dialogTitle: string): Promise<ShareCardResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { status: 'error', message: "Sharing isn't available on this phone." };
    }
    const base64 = await pngBase64(svg);
    const file = new File(Paths.cache, fileName);
    file.create({ overwrite: true });
    file.write(base64, { encoding: 'base64' });
    await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
  } catch {
    return { status: 'error', message: FAILED };
  }
  return { status: 'shared' };
}
