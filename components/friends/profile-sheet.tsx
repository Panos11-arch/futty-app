// S20: another player's sheet, from Scan, a futty.app/p/<username> link or a
// friend row. The S19 card (image 20) without the QR and without Share,
// Scan and Edit; then this season's stats; then one main button for the
// friendship (Add friend / Requested / Accept / Friends) and, for a friend,
// "Message <first name>". Their favourite player (free text, S19) can be
// reported. The server decides everything shown
// (player_profile_card): nothing for a blocked player or, for an adult, a
// minor; no Add friend between an adult and a minor (A5).
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ReportSheet } from '@/components/messages/report-sheet';
import { CardSheetFrame } from '@/components/navigation/card-sheet-frame';
import { CARD_AVATAR, PlayerCardView } from '@/components/navigation/player-card-view';
import { PlayerSeasonStatsView } from '@/components/match/season-stats';
import { Button, SectionHeader, SkeletonBlock, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  describeFriendError,
  friendAction,
  messageLabel,
  sendFriendRequest,
  unfriend,
  type CardLookup,
  type ProfileCard,
} from '@/lib/friends';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { cyprusYear } from '@/lib/match/stats-api';
import { usePlayerSeasonStats } from '@/lib/match/use-stats';
import { chatHref, describeMessageError, openFriendConversation, profileHref } from '@/lib/messages';
import { reportFavouritePlayer } from '@/lib/moderation';
import { makeStyles } from '@/lib/theme';
import { useProfileCard } from '@/lib/use-friends';

export const PLAYER_NOT_FOUND = 'Player not found.';

const SHEET_IDS = {
  sheet: { testID: 'profile-sheet-sheet' },
  backdrop: { testID: 'profile-sheet-backdrop' },
  handle: { testID: 'profile-sheet-handle' },
};

export type ProfileSheetProps = {
  visible: boolean;
  /** Who to show; null shows nothing. */
  who: CardLookup | null;
  onClose: () => void;
  /** From Scan: the not-found line offers to scan again. */
  onScanAgain?: () => void;
  /** After the friendship changed here (the Friends list reloads). */
  onChanged?: () => void;
};

export function ProfileSheet({ visible, who, onClose, onScanAgain, onChanged }: ProfileSheetProps) {
  const styles = useStyles();
  const { state, reload, setCard } = useProfileCard(visible ? who : null);

  return (
    <CardSheetFrame visible={visible} onClose={onClose} ids={SHEET_IDS} closeLabel="Close player card">
      {state.status === 'loading' ? (
        <View testID="profile-sheet-skeleton" style={styles.stack}>
          <SkeletonBlock width="100%" height={CARD_AVATAR + space.xxl * 2} />
          <SkeletonBlock width="100%" height={space.xxl * 3} />
        </View>
      ) : null}
      {state.status === 'not_found' ? (
        <View testID="profile-sheet-not-found" style={styles.stack}>
          <Text accessibilityRole="alert">{PLAYER_NOT_FOUND}</Text>
          {onScanAgain ? (
            <Button testID="profile-sheet-scan-again" label="Scan again" onPress={onScanAgain} />
          ) : (
            <Button testID="profile-sheet-done" label="Done" variant="secondary" onPress={onClose} />
          )}
        </View>
      ) : null}
      {state.status === 'error' ? (
        <View testID="profile-sheet-error" style={styles.stack}>
          <Text accessibilityRole="alert">{state.message}</Text>
          <Button testID="profile-sheet-retry" label="Try again" variant="secondary" onPress={reload} />
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <Ready card={state.card} onClose={onClose} onCard={setCard} onChanged={onChanged} />
      ) : null}
    </CardSheetFrame>
  );
}

function Ready({
  card,
  onClose,
  onCard,
  onChanged,
}: {
  card: ProfileCard;
  onClose: () => void;
  onCard: (card: ProfileCard) => void;
  onChanged?: () => void;
}) {
  const styles = useStyles();
  const season = useMemo(() => ({ kind: 'year' as const, year: cyprusYear() }), []);
  const stats = usePlayerSeasonStats(card.profile_id, season);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const userId = useAuth().user?.id ?? null;
  const action = friendAction(card.friend_status);
  // S19: the favourite player is free text, so another player's can be reported.
  const canReport = !!card.favourite_player && card.friend_status !== 'self' && !!userId;

  async function sendReport(reason: string): Promise<string | null> {
    if (!userId) return null;
    const { error } = await reportFavouritePlayer(userId, card.profile_id, reason);
    return error ? 'Could not send. Try again.' : null;
  }

  type Outcome = { error: { message: string } | null; next?: Partial<ProfileCard>; success?: boolean };

  async function run(key: string, work: () => Promise<Outcome>, done?: () => void) {
    if (busy) return;
    setBusy(key);
    setProblem(null);
    const { error, next, success } = await work();
    setBusy(null);
    if (error) {
      haptic.error();
      setProblem(describeFriendError(error));
      return;
    }
    if (success) haptic.success();
    onCard({ ...card, ...next });
    onChanged?.();
    done?.();
  }

  const none = { friend_status: 'none' as const, request_id: null };
  const noRequest = { error: { message: 'request_not_found' } };

  const add = () =>
    run('add', async () => {
      const { requestId, error } = await sendFriendRequest(card.profile_id);
      return { error, next: { friend_status: 'requested', request_id: requestId }, success: true };
    });
  const cancel = () =>
    run('main', async () =>
      card.request_id ? { error: (await cancelFriendRequest(card.request_id)).error, next: none } : noRequest,
    );
  const accept = () =>
    run('main', async () =>
      card.request_id
        ? {
            error: (await acceptFriendRequest(card.request_id)).error,
            next: { friend_status: 'friends', request_id: null },
            success: true,
          }
        : noRequest,
    );
  const decline = () =>
    run('decline', async () =>
      card.request_id ? { error: (await declineFriendRequest(card.request_id)).error, next: none } : noRequest,
    );
  const remove = () =>
    run('unfriend', async () => ({ error: (await unfriend(card.profile_id)).error, next: none }), () => setConfirming(false));

  async function message() {
    if (busy) return;
    setBusy('message');
    setProblem(null);
    const { conversationId, error } = await openFriendConversation(card.profile_id);
    setBusy(null);
    if (error || !conversationId) {
      setProblem(describeMessageError(error));
      return;
    }
    onClose();
    router.push(chatHref(conversationId));
  }

  function main() {
    if (!action) return;
    if (action.kind === 'add') void add();
    else if (action.kind === 'cancel') void cancel();
    else if (action.kind === 'accept') void accept();
    else setConfirming(true);
  }

  return (
    <>
      <PlayerCardView
        card={card}
        testIDPrefix="profile-card"
        onOpenProfile={() => {
          onClose();
          router.push(profileHref(card.profile_id));
        }}
      />

      <View style={styles.stack} testID="profile-sheet-season">
        <SectionHeader title="This season" />
        <PlayerSeasonStatsView
          state={stats.status === 'ready' ? { status: 'ready', stats: stats.stats } : stats}
          pick="year"
          onRetry={stats.reload}
        />
      </View>

      {problem ? (
        <Text testID="profile-sheet-problem" tone="danger" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}

      {action && !confirming ? (
        <View style={styles.actions}>
          <View style={styles.grow}>
            <Button
              testID="profile-sheet-friend"
              label={action.label}
              variant={action.kind === 'add' || action.kind === 'accept' ? 'primary' : 'secondary'}
              onPress={main}
              loading={busy === 'add' || busy === 'main'}
              accessibilityHint={
                action.kind === 'cancel' ? 'Cancels your request' : action.kind === 'unfriend' ? 'Shows Unfriend' : undefined
              }
              fullWidth
            />
          </View>
          {action.kind === 'accept' ? (
            <View style={styles.grow}>
              <Button
                testID="profile-sheet-decline"
                label="Decline"
                variant="secondary"
                onPress={() => void decline()}
                loading={busy === 'decline'}
                fullWidth
              />
            </View>
          ) : null}
          {card.friend_status === 'friends' ? (
            <View style={styles.grow}>
              <Button
                testID="profile-sheet-message"
                label={messageLabel(card.first_name)}
                onPress={() => void message()}
                loading={busy === 'message'}
                fullWidth
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {confirming ? (
        <View style={styles.actions}>
          <View style={styles.grow}>
            <Button
              testID="profile-sheet-unfriend"
              label="Unfriend"
              variant="destructive"
              onPress={() => void remove()}
              loading={busy === 'unfriend'}
              fullWidth
            />
          </View>
          <View style={styles.grow}>
            <Button testID="profile-sheet-keep" label="Keep friend" variant="secondary" onPress={() => setConfirming(false)} fullWidth />
          </View>
        </View>
      ) : null}

      {canReport ? (
        <>
          <Button
            testID="profile-sheet-report"
            label="Report"
            variant="plain"
            accessibilityHint="Reports their favourite player"
            onPress={() => setReporting(true)}
          />
          <ReportSheet visible={reporting} onClose={() => setReporting(false)} onSend={sendReport} />
        </>
      ) : null}
    </>
  );
}

const useStyles = makeStyles(() => ({
  stack: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  grow: { flex: 1 },
}));
