// S19: Share on the player card. The card is captured as a PNG
// (react-native-view-shot) and handed to the phone's share menu, so the
// player picks Instagram, WhatsApp, AirDrop or anything else. On iPhone the
// link goes with the image; Android's share menu takes a file or text, not
// both, so it gets the image (whose QR holds the link), or the link as text
// when there's no share menu for files.
import type { RefObject } from 'react';
import { Platform, Share, type View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

export const SHARE_FAILED = "Your card couldn't be shared. Try again.";

export type ShareResult = { status: 'shared' } | { status: 'error'; message: string };

export async function shareMyCard(card: RefObject<View | null>, link: string): Promise<ShareResult> {
  try {
    const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });
    if (Platform.OS === 'ios') {
      // A dismissed menu resolves too: not an error.
      await Share.share({ url: uri, message: link });
    } else if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share my card' });
    } else {
      await Share.share({ message: link });
    }
    return { status: 'shared' };
  } catch {
    return { status: 'error', message: SHARE_FAILED };
  }
}
