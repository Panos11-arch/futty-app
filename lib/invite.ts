import { Share } from 'react-native';

// Unset until the app has a real App Store / Play Store listing — there is no
// download link to share yet. Set EXPO_PUBLIC_APP_DOWNLOAD_URL once one exists;
// the message below degrades gracefully without it rather than link to nothing.
const DOWNLOAD_URL = process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL;

/** Opens the OS share sheet (Messages, WhatsApp, Messenger, copy link, etc. —
 *  whichever the device has installed) with an invite message for someone who
 *  doesn't have the app yet. */
export async function shareTeamInvite(params: { teamName: string; inviterUsername: string | null }) {
  const lines = [`Come play for "${params.teamName}" on Futty!`];

  lines.push(
    DOWNLOAD_URL
      ? `Download it here: ${DOWNLOAD_URL}`
      : "It's not on the app store yet — ask me how to get it."
  );

  if (params.inviterUsername) {
    lines.push(`Once you've signed up, send me your username (I'm @${params.inviterUsername}) so I can add you to the team.`);
  }

  return Share.share({ message: lines.join('\n\n') });
}

/** Same share sheet, for the Community > Contacts tab's per-contact "Invite"
 *  button — no team context, just "come play on Futty". */
export async function shareContactInvite(contactName: string) {
  const lines = [`Hey ${contactName}, join me on Futty!`];

  lines.push(
    DOWNLOAD_URL
      ? `Download it here: ${DOWNLOAD_URL}`
      : "It's not on the app store yet — I'll let you know when it's out."
  );

  return Share.share({ message: lines.join('\n\n') });
}
