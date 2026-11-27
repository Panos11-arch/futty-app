// S19: what the tab bar's Card button opens (spec 15 section 0.6, image 20,
// the S19 card mockup). A bottom sheet over a dimmed screen, with a drag
// handle; it springs up, and closes on a swipe down, a tap outside or the
// back button (card-sheet-frame.tsx). It holds the player card
// (player-card-view.tsx) and, under it, round buttons:
//   Share: the card as an image, with the link (lib/player-card-share.ts);
//          only when the card has a QR, so never for a minor (A5);
//   Scan:  S20's scanner (lib/player-card.ts scanRoute);
//   Edit:  Edit profile.
// The card is read from the server each time the sheet opens, keeping the
// last one on screen while it loads.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { CardSheetFrame } from '@/components/navigation/card-sheet-frame';
import { CardQrFullScreen } from '@/components/navigation/card-qr-full-screen';
import { CARD_AVATAR, CARD_QR, PlayerCardView } from '@/components/navigation/player-card-view';
import { Button, IconSymbol, SkeletonBlock, Text, type IconSymbolName } from '@/components/ui';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { hairline, radius, space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { cardLink, fetchMyPlayerCard, scanRoute, type PlayerCard } from '@/lib/player-card';
import { shareMyCard } from '@/lib/player-card-share';
import { makeStyles, useTheme } from '@/lib/theme';

export const CARD_LOAD_FAILED = "Your card couldn't load. Try again.";

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; card: PlayerCard };

/**
 * The buttons' icons (Material Icons on Android and web) are loaded when the
 * tab bar mounts, well before the sheet first opens, so they never show as
 * empty boxes. SF Symbols on iPhone need no loading.
 */
export function usePreloadIcons() {
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    // Required here, not at the top, so iPhone never loads the Material set.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const icons = require('@expo/vector-icons/MaterialIcons') as typeof import('@expo/vector-icons/MaterialIcons');
      void icons.default.loadFont().catch(() => {});
    } catch {
      // The icons then load on first draw, as before.
    }
  }, []);
}

function RoundButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: IconSymbolName;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.round}>
      <View style={styles.circle}>
        <IconSymbol name={icon} size={ICON.regular} color={colors.ink} />
      </View>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </Pressable>
  );
}

function CardSkeleton() {
  const styles = useStyles();
  return (
    <View testID="my-card-skeleton" style={styles.skeleton}>
      <SkeletonBlock width="100%" height={CARD_AVATAR + space.xxl * 2} />
      <SkeletonBlock width="100%" height={space.xxl * 3} />
      <SkeletonBlock width="100%" height={CARD_QR + space.xxl} />
    </View>
  );
}

export function MyCardSheet({
  visible,
  onClose,
  onOpenProfile,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  usePreloadIcons();
  const styles = useStyles();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [qrOpen, setQrOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);

  async function reload() {
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    const next = await fetchMyPlayerCard();
    setLoad((prev) => (next.status === 'error' && prev.status === 'ready' ? prev : next));
  }
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (visible) {
      setShareError(null);
      void reloadRef.current();
    } else {
      setQrOpen(false);
    }
  }, [visible]);

  async function share(card: PlayerCard) {
    if (!card.username || sharing) return;
    haptic.tap();
    setSharing(true);
    setShareError(null);
    const result = await shareMyCard(cardRef, cardLink(card.username));
    setSharing(false);
    if (result.status === 'error') setShareError(result.message);
  }

  function edit() {
    onClose();
    router.push('/edit-profile');
  }

  const scan = scanRoute();
  const card = load.status === 'ready' ? load.card : null;
  const canShare = !!card?.show_qr && !!card.username;

  return (
    <CardSheetFrame
      visible={visible}
      onClose={onClose}
      ids={{
        sheet: { testID: 'my-card-sheet' },
        backdrop: { testID: 'my-card-backdrop' },
        handle: { testID: 'my-card-handle' },
      }}
      closeLabel="Close card"
      overlay={
        card?.show_qr && card.username ? (
          <CardQrFullScreen username={card.username} visible={qrOpen} onClose={() => setQrOpen(false)} />
        ) : null
      }>
      {load.status === 'loading' ? <CardSkeleton /> : null}
      {load.status === 'error' ? (
        <View testID="my-card-error" style={styles.error}>
          <Text accessibilityRole="alert">{CARD_LOAD_FAILED}</Text>
          <Button testID="my-card-retry" label="Try again" variant="secondary" onPress={() => void reload()} />
        </View>
      ) : null}
      {card ? (
        <>
          <PlayerCardView
            ref={cardRef}
            card={card}
            onOpenProfile={() => {
              onClose();
              onOpenProfile();
            }}
            onOpenQr={() => setQrOpen(true)}
          />
          <View style={styles.actions}>
            {canShare ? (
              <RoundButton
                testID="my-card-share"
                icon="square.and.arrow.up"
                label="Share"
                onPress={() => void share(card)}
              />
            ) : null}
            {scan ? (
              <RoundButton
                testID="my-card-scan"
                icon="qrcode.viewfinder"
                label="Scan"
                onPress={() => {
                  onClose();
                  router.push(scan);
                }}
              />
            ) : null}
            <RoundButton testID="my-card-edit" icon="pencil" label="Edit" onPress={edit} />
          </View>
          {shareError ? (
            <Text testID="my-card-share-error" tone="danger" accessibilityRole="alert" style={styles.center}>
              {shareError}
            </Text>
          ) : null}
        </>
      ) : null}
    </CardSheetFrame>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  skeleton: { gap: space.sm },
  error: { gap: space.md, alignItems: 'flex-start', paddingVertical: space.lg },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: space.xxl },
  round: { alignItems: 'center', gap: space.xs, minWidth: MIN_TOUCH },
  circle: {
    width: MIN_TOUCH + space.xs,
    height: MIN_TOUCH + space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
}));
