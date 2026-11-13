// Booking detail (spec 15 section 5; spec 13 "Booking screens" and
// "Cancellations and refunds"). Everything is booking_detail's and
// cancellation_quote's, shown as it is: names and paid state for everyone,
// amounts only for the booker (or your own), the server's next cutoff as a
// countdown, and a cancel that shows exactly what happens to the money
// before a second tap confirms it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  EmptyState,
  ListRow,
  SectionHeader,
  Sheet,
  SkeletonBlock,
  SkeletonText,
  StatusPill,
  Text,
  TextField,
} from '@/components/ui';
import { GipedoPanel } from '@/components/booking/gipedo-panel';
import { colors, space } from '@/constants/futty-theme';
import type { CancellationQuote } from '@/lib/booking-actions';
import {
  countdownLabel,
  cutoffPassed,
  describeQuote,
  paymentDeadlineLabel,
  rosterRow,
  type BookingDetailData,
  type ConfirmResult,
  type DetailCancelScope,
  type QuoteResult,
} from '@/lib/booking-detail';
import { slotLabel, useNow, type LoadState } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';

export type { ConfirmResult, DetailCancelScope, QuoteResult };

/** Bookings made before P4a have no quote: the old rules apply. Panos to
 *  confirm this wording. */
export const OLD_RULES_WORDS = 'This booking was made under the old rules. Cancelling follows those rules.';

export type BookingDetailViewProps = {
  state: LoadState<BookingDetailData>;
  onRetry: () => void;
  /** The server's cutoff has passed: load the booking again for the next one. */
  onRefresh: () => void;
  /** cancellation_quote for this scope. Nothing changes yet. */
  onQuote: (scope: DetailCancelScope) => Promise<QuoteResult>;
  /** The second tap: cancels exactly the quote shown (null for a booking made before P4a). */
  onConfirmCancel: (confirmed: { scope: DetailCancelScope; quote: string | null }) => Promise<ConfirmResult>;
  /** Sends an invite; resolves to an error message, or null when sent. */
  onInvite: (username: string) => Promise<string | null>;
  onShare: () => void;
  onAddToCalendar: () => void;
  inCalendar: boolean;
  onDirections: () => void;
  onPayShare: () => void;
  /** A message from the screen (calendar, cancellation done). */
  notice: string | null;
  /** Gipedo Pano (P8): pull out, and the no-opponent choice. Each resolves
   *  to an error message, or null when it went through. */
  onGipedoPullOut?: () => Promise<string | null>;
  onGipedoChoose?: (choice: 'play_normal' | 'cancel') => Promise<string | null>;
  /** The booker's Need players / Need opposition panel. */
  squadNeed?: ReactNode;
  /** For tests; the screen uses the clock. */
  now?: Date;
};

const PILL_FOR_BOOKING: Record<string, 'confirmed' | 'pending'> = {
  confirmed: 'confirmed',
  pending_payment: 'pending',
};

export function BookingDetailView(props: BookingDetailViewProps) {
  const { state } = props;
  if (state.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={2} variant="headline" />
          <SkeletonBlock width="100%" height={48} rounded="control" />
          <SkeletonBlock width="100%" height={200} />
        </View>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="exclamationmark.circle.fill" message={state.message} action={{ label: 'Try again', onPress: props.onRetry }} />
      </View>
    );
  }
  return <BookingDetailReady {...props} detail={state.data} />;
}

type Asking =
  | { scope: DetailCancelScope; step: 'loading' }
  | { scope: DetailCancelScope; step: 'quote'; quote: CancellationQuote | null; changed: boolean }
  | { scope: DetailCancelScope; step: 'error'; message: string };

function BookingDetailReady({
  detail,
  onRefresh,
  onQuote,
  onConfirmCancel,
  onInvite,
  onShare,
  onAddToCalendar,
  inCalendar,
  onDirections,
  onPayShare,
  notice,
  squadNeed,
  onGipedoPullOut,
  onGipedoChoose,
  now: nowOverride,
}: Omit<BookingDetailViewProps, 'state' | 'onRetry'> & { detail: BookingDetailData }) {
  const clock = useNow(15_000);
  const now = nowOverride ?? clock;
  const { booking, venue, me, roster, is_booker: isBooker } = detail;

  const cancelled = booking.status === 'cancelled';
  const meActive = me !== null && me.status !== 'cancelled' && me.status !== 'refunded';
  const started = now.getTime() >= Date.parse(booking.kickoff_at);
  const live = !cancelled && !started;
  const legacy = booking.payment_mode === null;

  // The server picks the next cutoff; ask once each time one passes.
  const refreshedFor = useRef<string | null>(null);
  const passed = live && cutoffPassed(detail.next_cutoff, now);
  useEffect(() => {
    if (!passed || !detail.next_cutoff) return;
    if (refreshedFor.current === detail.next_cutoff.at) return;
    refreshedFor.current = detail.next_cutoff.at;
    onRefresh();
  }, [passed, detail.next_cutoff, onRefresh]);
  const countdown = live ? countdownLabel(detail, now) : null;
  const deadline = live ? paymentDeadlineLabel(detail) : null;

  // ---- Cancel: quote first, confirm second -----------------------------
  const [asking, setAsking] = useState<Asking | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Bumped each time the sheet opens or closes, so a quote that arrives after
  // the player closed the sheet doesn't open it again.
  const askRef = useRef(0);

  async function startCancel(scope: DetailCancelScope) {
    const ask = ++askRef.current;
    setConfirmError(null);
    if (legacy) {
      setAsking({ scope, step: 'quote', quote: null, changed: false });
      return;
    }
    setAsking({ scope, step: 'loading' });
    const result = await onQuote(scope);
    if (askRef.current !== ask) return;
    setAsking('quote' in result ? { scope, step: 'quote', quote: result.quote, changed: false } : { scope, step: 'error', message: result.error });
  }

  function closeSheet() {
    if (confirming) return;
    askRef.current += 1;
    setAsking(null);
  }

  async function confirm() {
    if (!asking || asking.step !== 'quote' || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await onConfirmCancel({ scope: asking.scope, quote: asking.quote?.quote ?? null });
    setConfirming(false);
    if (result.status === 'cancelled') setAsking(null);
    else if (result.status === 'changed') setAsking({ scope: asking.scope, step: 'quote', quote: result.quote, changed: true });
    else setConfirmError(result.message);
  }

  // ---- Invite ------------------------------------------------------------
  const [username, setUsername] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  async function invite() {
    const name = username.trim();
    if (!name || inviting) return;
    setInviting(true);
    setInviteError(null);
    setInvited(null);
    const error = await onInvite(name);
    setInviting(false);
    if (error) setInviteError(error);
    else {
      setInvited(name);
      setUsername('');
    }
  }

  const sheetTitle = asking?.scope === 'whole_team' ? 'Cancel the whole team?' : 'Cancel my spot?';
  const confirmLabel = asking?.scope === 'whole_team' ? 'Confirm: cancel the whole team' : 'Confirm: cancel my spot';
  const keepLabel = asking?.scope === 'whole_team' ? 'Keep the booking' : 'Keep my spot';
  const bookingPill = PILL_FOR_BOOKING[booking.status];
  const pending = meActive && me.status === 'pending';
  const gipedo = detail.gipedo ?? null;
  const payLabel = gipedo?.my_side ? `Hold my card: ${formatEuros(me?.amount_cents ?? 0)}` : `Pay my share: ${formatEuros(me?.amount_cents ?? 0)}`;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            {venue.name}
          </Text>
          <Text variant="body" tone="inkMuted" tabular>
            {slotLabel(booking.booking_day, booking.start_time, booking.end_time)}
          </Text>
          <Text variant="body" tone="inkMuted">
            {`${booking.format} · ${booking.players_per_side} v ${booking.players_per_side}`}
          </Text>
          {bookingPill ? <StatusPill status={bookingPill} /> : null}
        </View>

        {cancelled ? <Banner tone="info" message="This booking was cancelled." /> : null}
        {!cancelled && !meActive && !isBooker ? <Banner tone="info" message="You're no longer in this game." /> : null}
        {notice ? <Banner tone="info" message={notice} /> : null}

        {countdown ? <ListRow title={countdown} leading={{ icon: 'clock.fill' }} /> : null}

        {deadline ? <Banner tone="warning" message={deadline} /> : null}

        {gipedo && (gipedo.my_side || gipedo.choice_due || gipedo.settlement) ? (
          <GipedoPanel
            gipedo={gipedo}
            feePerPlayerCents={detail.cancellation.fee_cents}
            live={live}
            onPullOut={onGipedoPullOut ?? (async () => null)}
            onChoose={onGipedoChoose ?? (async () => null)}
          />
        ) : null}

        {pending ? (
          <Button label={payLabel} onPress={onPayShare} fullWidth />
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Who's playing" />
          <Text variant="callout" tone="inkMuted" tabular>
            {`${roster.length} of ${booking.capacity} spots taken`}
          </Text>
          <View style={styles.list}>
            {roster.map((entry) => {
              const row = rosterRow(entry, isBooker, Boolean(gipedo));
              return (
                <ListRow
                  key={entry.share_id}
                  testID={`roster-${entry.share_id}`}
                  title={row.title}
                  subtitle={row.subtitle}
                  leading={{ avatar: { name: entry.name ?? entry.username ?? row.title } }}
                  trailing={
                    <View style={styles.trailing}>
                      {row.amount ? (
                        <Text variant="callout" tabular>
                          {row.amount}
                        </Text>
                      ) : null}
                      <StatusPill status={row.pill} />
                    </View>
                  }
                />
              );
            })}
          </View>
        </View>

        {isBooker && live ? (
          <View style={styles.section}>
            <SectionHeader title="Invite a player" />
            <TextField
              label="Username"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                setInviteError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              error={inviteError ?? undefined}
              helper={invited ? `Invite sent to ${invited}. They'll show up here once they accept.` : undefined}
              editable={!inviting}
            />
            <Button label="Invite" variant="secondary" onPress={invite} loading={inviting} disabled={!username.trim()} />
            {squadNeed}
          </View>
        ) : null}

        <View style={styles.section}>
          <Button label="Share" variant="secondary" onPress={onShare} fullWidth />
          {!cancelled ? (
            <Button
              label={inCalendar ? 'Update calendar event' : 'Add to calendar'}
              variant="secondary"
              onPress={onAddToCalendar}
              fullWidth
            />
          ) : null}
          <Button label="Directions" variant="secondary" onPress={onDirections} fullWidth />
        </View>

        {live && (detail.can_cancel.my_spot || detail.can_cancel.whole_team) ? (
          <View style={styles.section}>
            {detail.can_cancel.my_spot && !legacy ? (
              <Button label="Cancel my spot" variant="destructive" onPress={() => startCancel('my_spot')} fullWidth />
            ) : null}
            {detail.can_cancel.whole_team ? (
              <Button label="Cancel whole team" variant="destructive" onPress={() => startCancel('whole_team')} fullWidth />
            ) : null}
            {legacy ? null : (
              <Text variant="caption" tone="inkMuted">
                You see exactly what happens to the money before anything is cancelled.
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={asking !== null}
        onClose={closeSheet}
        title={sheetTitle}
        primaryAction={
          asking?.step === 'quote' ? { label: confirmLabel, onPress: confirm, loading: confirming } : undefined
        }
        secondaryAction={{ label: keepLabel, disabled: confirming }}>
        {asking?.step === 'loading' ? <SkeletonText lines={3} variant="body" /> : null}
        {asking?.step === 'error' ? <Banner tone="danger" message={asking.message} /> : null}
        {asking?.step === 'quote' && asking.changed ? (
          <Banner tone="warning" message="What happens to the money has changed. Check it again before you confirm." />
        ) : null}
        {asking?.step === 'quote' && asking.quote
          ? describeQuote(asking.quote, venue.name).map((line) => (
              <Text key={line} variant="body">
                {line}
              </Text>
            ))
          : null}
        {asking?.step === 'quote' && !asking.quote ? (
          <Text variant="body">{OLD_RULES_WORDS}</Text>
        ) : null}
        {confirmError ? <Banner tone="danger" message={confirmError} /> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  list: { gap: space.xs },
  trailing: { alignItems: 'flex-end', gap: space.xs },
});
