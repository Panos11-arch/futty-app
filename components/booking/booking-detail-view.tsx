// Booking detail (spec 15 section 5; spec 13 "Booking screens" and
// "Cancellations and refunds"). Everything is booking_detail's and
// cancellation_quote's, shown as it is: names and paid state for everyone,
// amounts only for the booker (or your own), the server's next cutoff as a
// countdown, and a cancel that shows exactly what happens to the money
// before a second tap confirms it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

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
import { NoOpponentPanel } from '@/components/booking/no-opponent-panel';
import { SwitchFormat } from '@/components/booking/switch-format';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { CancellationQuote } from '@/lib/booking-actions';
import {
  acceptedVenuePlayers,
  cancelOptions,
  countdownLabel,
  cutoffPassed,
  describeQuote,
  noticeUnderCancelledTitle,
  openVenueOffers,
  paymentDeadlineLabel,
  rosterRow,
  spotsTaken,
  VENUE_NOT_TAKING_PLAYERS,
  type BookingDetailData,
  type ConfirmResult,
  type DetailCancelScope,
  type QuoteResult,
} from '@/lib/booking-detail';
import { rosterBySide, sideRow } from '@/lib/booking-opposition';
import { slotLabel, useNow, type LoadState, type RosterEntry } from '@/lib/booking-search';
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
  /** A cancelled booking: what happened to the caller's money, in words,
   *  from the server (my_cancellation_outcome; QA 24 November, T4). */
  cancelledMoney?: string[];
  /** Gipedo Pano (P8): pull out, and the no-opponent choice. Each resolves
   *  to an error message, or null when it went through. */
  onGipedoPullOut?: () => Promise<string | null>;
  onGipedoChoose?: (choice: 'play_normal' | 'cancel') => Promise<string | null>;
  /** The booker's Need players / Need opposition panel. */
  squadNeed?: ReactNode;
  /** P12: switches 5 v 5 / 6 v 6; resolves to an error message, or null
   *  once switched. */
  onSwitch?: (to: 5 | 6) => Promise<string | null>;
  /** The weather strip for the game's hours (P11). Shown while the game is
   *  still to come; nothing renders until one is passed in. */
  weather?: ReactNode;
  /** P6 check-in QR: the game's check-in panel. Shown unless cancelled; it
   *  hides itself outside the check-in window. */
  checkIn?: ReactNode;
  /** P6e: the booker accepts or declines a venue's offered player, or
   *  removes an accepted one. Each resolves to an error message, or null. */
  onAnswerVenuePlayer?: (offerId: string, accept: boolean) => Promise<string | null>;
  onRemoveVenuePlayer?: (offerId: string) => Promise<string | null>;
  /** B3 (Booking v2, a half pitch): side A's captain opens Invite opposition. */
  onInviteOpposition?: () => void;
  /** B3: the no-opponent choice. Each resolves to an error message, or null. */
  onPayWhole?: () => Promise<string | null>;
  onCancelFree?: () => Promise<string | null>;
  /** B1d (Losers pay, decided 23 and 24 November): a player leaves, or a
   *  captain pulls his side out, on its own screen with the server's amounts. */
  onLosersPay?: (action: 'leave' | 'pull_out') => void;
  /** For tests; the screen uses the clock. */
  now?: Date;
};

const PILL_FOR_BOOKING: Record<string, 'confirmed' | 'pending'> = {
  confirmed: 'confirmed',
  pending_payment: 'pending',
};

export function BookingDetailView(props: BookingDetailViewProps) {
  const styles = useStyles();
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
  cancelledMoney,
  squadNeed,
  onGipedoPullOut,
  onGipedoChoose,
  onSwitch,
  weather,
  checkIn,
  onAnswerVenuePlayer,
  onRemoveVenuePlayer,
  onInviteOpposition,
  onPayWhole,
  onCancelFree,
  onLosersPay,
  now: nowOverride,
}: Omit<BookingDetailViewProps, 'state' | 'onRetry'> & { detail: BookingDetailData }) {
  const styles = useStyles();
  const clock = useNow(15_000);
  const now = nowOverride ?? clock;
  const { booking, venue, me, roster, is_booker: isBooker } = detail;

  const cancelled = booking.status === 'cancelled';
  const underTitle = noticeUnderCancelledTitle(notice);
  const meActive = me !== null && me.status !== 'cancelled' && me.status !== 'refunded';
  const started = now.getTime() >= Date.parse(booking.kickoff_at);
  const live = !cancelled && !started;
  const legacy = booking.payment_mode === null;
  const canCancel = cancelOptions(detail);

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

  // ---- Venue players (P6e) ---------------------------------------------
  const [venueBusy, setVenueBusy] = useState<string | null>(null);
  const [venueError, setVenueError] = useState<{ id: string; message: string } | null>(null);
  const offers = isBooker ? openVenueOffers(detail) : [];
  const venuePlayers = acceptedVenuePlayers(detail);

  async function venueAction(id: string, key: string, work: (() => Promise<string | null>) | undefined) {
    if (!work || venueBusy) return;
    setVenueBusy(key);
    setVenueError(null);
    const error = await work();
    setVenueBusy(null);
    if (error) setVenueError({ id, message: error });
  }

  const sheetTitle = asking?.scope === 'whole_team' ? 'Cancel the whole team?' : 'Cancel my spot?';
  const confirmLabel = asking?.scope === 'whole_team' ? 'Confirm: cancel the whole team' : 'Confirm: cancel my spot';
  const keepLabel = asking?.scope === 'whole_team' ? 'Keep the booking' : 'Keep my spot';
  const bookingPill = PILL_FOR_BOOKING[booking.status];
  const pending = meActive && me.status === 'pending';
  const gipedo = detail.gipedo ?? null;
  // B3: a Booking v2 booking's pitch, sides and no-opponent choice.
  const v2 = detail.v2 ?? null;
  const losersPay = v2?.losers_pay === true;
  const groups = v2?.kind === 'half' ? rosterBySide(roster, v2.roster_sides) : null;
  const rosterRows = (entries: RosterEntry[]) =>
    entries.map((entry) => {
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
    });
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
          {v2?.pitch_label ? (
            <View testID="booking-detail-pitch">
              <Text variant="body" tone="inkMuted">
                {v2.pitch_label}
              </Text>
            </View>
          ) : null}
          {bookingPill ? (
            // The status as a testID for the Maestro tests.
            <View testID={`booking-detail-status-${booking.status}`}>
              <StatusPill status={bookingPill} />
            </View>
          ) : null}
        </View>

        {cancelled ? (
          // QA 24 November (T4, S5): one banner. Just after cancelling it
          // carries the screen's notice too, said once (QA 27 November): the
          // title only, or the title and any charge sentence. Then what
          // happened to the money.
          <View testID="booking-detail-cancelled" style={styles.list}>
            {notice ? (
              <View testID="booking-detail-notice">
                {underTitle ? (
                  <Banner tone="info" title="This booking was cancelled." message={underTitle} />
                ) : (
                  <Banner tone="info" message="This booking was cancelled." />
                )}
              </View>
            ) : (
              <Banner tone="info" message="This booking was cancelled." />
            )}
            {cancelledMoney && cancelledMoney.length > 0 ? (
              <View testID="booking-detail-cancelled-money" style={styles.list}>
                {cancelledMoney.map((line) => (
                  <Text key={line} variant="body" tabular>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        {!cancelled && !meActive && !isBooker ? <Banner tone="info" message="You're no longer in this game." /> : null}
        {!cancelled && notice ? (
          <View testID="booking-detail-notice">
            <Banner tone="info" message={notice} />
          </View>
        ) : null}

        {countdown ? <ListRow title={countdown} leading={{ icon: 'clock.fill' }} /> : null}

        {deadline ? <Banner tone="warning" message={deadline} /> : null}

        {!cancelled && checkIn ? <View testID="booking-check-in">{checkIn}</View> : null}

        {live && weather ? <View testID="booking-weather">{weather}</View> : null}

        {gipedo && (gipedo.my_side || gipedo.choice_due || gipedo.settlement) ? (
          <GipedoPanel
            gipedo={gipedo}
            live={live}
            onPullOut={onGipedoPullOut ?? (async () => null)}
            onChoose={onGipedoChoose ?? (async () => null)}
          />
        ) : null}

        {live && v2?.no_opponent?.due && onPayWhole && onCancelFree ? (
          <NoOpponentPanel testID="booking-detail-no-opponent" info={v2.no_opponent} onPayWhole={onPayWhole} onCancelFree={onCancelFree} />
        ) : null}

        {v2?.kind === 'half' && v2.sides.length > 0 ? (
          <View style={styles.section} testID="booking-detail-sides">
            <SectionHeader title="Sides" />
            <View style={styles.list}>
              {v2.sides.map((side) => {
                const row = sideRow(side);
                return (
                  <ListRow
                    key={side.side}
                    testID={`booking-detail-side-${side.side}`}
                    title={row.title}
                    subtitle={row.subtitle}
                    trailing={row.pill ? <StatusPill status={row.pill} /> : undefined}
                  />
                );
              })}
            </View>
            {live && v2.captain_of === 'a' && v2.opposition?.open && onInviteOpposition ? (
              <Button
                testID="booking-detail-invite-opposition"
                label="Invite opposition"
                variant="secondary"
                onPress={onInviteOpposition}
                fullWidth
              />
            ) : null}
          </View>
        ) : null}

        {pending ? (
          <Button label={payLabel} onPress={onPayShare} fullWidth />
        ) : null}

        {offers.map((offer) => (
          <View key={offer.id} testID={`venue-offer-${offer.id}`} style={styles.section}>
            <Banner
              tone="info"
              title={`The venue offered a player: ${offer.name}`}
              message={`${offer.name} plays free; the team's amounts don't change.`}
            />
            <View style={styles.row}>
              <Button
                label={`Accept ${offer.name}`}
                loading={venueBusy === `accept-${offer.id}`}
                disabled={venueBusy !== null}
                onPress={() => venueAction(offer.id!, `accept-${offer.id}`, onAnswerVenuePlayer && (() => onAnswerVenuePlayer(offer.id!, true)))}
              />
              <Button
                label={`Decline ${offer.name}`}
                variant="secondary"
                loading={venueBusy === `decline-${offer.id}`}
                disabled={venueBusy !== null}
                onPress={() => venueAction(offer.id!, `decline-${offer.id}`, onAnswerVenuePlayer && (() => onAnswerVenuePlayer(offer.id!, false)))}
              />
            </View>
            {venueError && venueError.id === offer.id ? <Banner tone="danger" message={venueError.message} /> : null}
          </View>
        ))}

        {/* QA 24 November, T4: a cancelled game lists nobody as paying. */}
        {!cancelled ? (
          <View style={styles.section}>
            <SectionHeader title="Who's playing" />
            <Text variant="callout" tone="inkMuted" tabular>
              {`${spotsTaken(detail)} of ${booking.capacity} spots taken`}
            </Text>
            <View style={styles.list}>
              {groups ? (
                <>
                  <View testID="booking-detail-roster-a" style={styles.list}>
                    <Text variant="callout" tone="inkMuted">
                      Side A
                    </Text>
                    {rosterRows(groups.a)}
                  </View>
                  {groups.b.length > 0 ? (
                    <View testID="booking-detail-roster-b" style={styles.list}>
                      <Text variant="callout" tone="inkMuted">
                        Side B
                      </Text>
                      {rosterRows(groups.b)}
                    </View>
                  ) : null}
                </>
              ) : (
                rosterRows(roster)
              )}
              {venuePlayers.map((player) => (
                <View key={player.id ?? player.name} testID={`venue-player-${player.id ?? player.name}`}>
                  <ListRow
                    title={player.name}
                    subtitle="Venue player · Plays free"
                    leading={{ avatar: { name: player.name } }}
                    trailing={
                      isBooker && live && player.can_remove && player.id ? (
                        <Button
                          label={`Remove ${player.name}`}
                          variant="plain"
                          loading={venueBusy === `remove-${player.id}`}
                          disabled={venueBusy !== null}
                          onPress={() =>
                            venueAction(player.id!, `remove-${player.id}`, onRemoveVenuePlayer && (() => onRemoveVenuePlayer(player.id!)))
                          }
                        />
                      ) : undefined
                    }
                  />
                  {player.id && venueError && venueError.id === player.id ? <Banner tone="danger" message={venueError.message} /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {isBooker && live && detail.venueTakingPlayers === false ? (
          <View style={styles.section}>
            <Text variant="body" tone="inkMuted">
              {VENUE_NOT_TAKING_PLAYERS}
            </Text>
          </View>
        ) : null}

        {isBooker && live && detail.venueTakingPlayers !== false ? (
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

        {onSwitch ? (
          <SwitchFormat
            info={detail.switch}
            isBooker={isBooker}
            live={live}
            inGame={meActive}
            playersPerSide={booking.players_per_side}
            venueName={venue.name}
            onSwitch={onSwitch}
          />
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

        {live && losersPay && onLosersPay ? (
          // A Losers pay game has its own ways out (the usual cancellation doesn't apply).
          <View style={styles.section}>
            {v2?.captain_of ? (
              <Button
                testID="booking-detail-losers-pull-out"
                label="Pull your team out"
                variant="destructive"
                onPress={() => onLosersPay('pull_out')}
                fullWidth
              />
            ) : me && ['pending', 'authorized', 'covered'].includes(me.status) ? (
              <Button
                testID="booking-detail-losers-leave"
                label="Leave this game"
                variant="destructive"
                onPress={() => onLosersPay('leave')}
                fullWidth
              />
            ) : null}
            <Text variant="caption" tone="inkMuted">
              You see exactly what happens to the money before anything changes.
            </Text>
          </View>
        ) : null}

        {live && !losersPay && (canCancel.mySpot || canCancel.wholeTeam) ? (
          <View style={styles.section}>
            {canCancel.mySpot ? (
              <Button
                testID="booking-detail-cancel-my-spot"
                label="Cancel my spot"
                variant="destructive"
                onPress={() => startCancel('my_spot')}
                fullWidth
              />
            ) : null}
            {canCancel.wholeTeam ? (
              <Button
                testID="booking-detail-cancel-whole-team"
                label="Cancel whole team"
                variant="destructive"
                onPress={() => startCancel('whole_team')}
                fullWidth
              />
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
          asking?.step === 'quote'
            ? { label: confirmLabel, onPress: confirm, loading: confirming, testID: 'cancel-confirm' }
            : undefined
        }
        secondaryAction={{ label: keepLabel, disabled: confirming, testID: 'cancel-keep' }}>
        {asking?.step === 'loading' ? <SkeletonText lines={3} variant="body" /> : null}
        {asking?.step === 'error' ? <Banner tone="danger" message={asking.message} /> : null}
        {asking?.step === 'quote' && asking.changed ? (
          <Banner tone="warning" message="What happens to the money has changed. Check it again before you confirm." />
        ) : null}
        {asking?.step === 'quote' && asking.quote ? (
          <View testID="cancel-quote" style={styles.quoteLines}>
            {describeQuote(asking.quote, venue.name).map((line, i) => (
              <Text key={line} testID={`cancel-quote-line-${i}`} variant="body">
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {asking?.step === 'quote' && !asking.quote ? (
          <Text variant="body">{OLD_RULES_WORDS}</Text>
        ) : null}
        {confirmError ? (
          <View testID="cancel-error">
            <Banner tone="danger" message={confirmError} />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  list: { gap: space.xs },
  trailing: { alignItems: 'flex-end', gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // The quote's lines share one View (for its testID), spaced as the sheet
  // spaces its content (components/ui/sheet.tsx, content).
  quoteLines: { gap: space.md },
}));
