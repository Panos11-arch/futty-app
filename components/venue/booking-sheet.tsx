// One booking on the venue dashboard (spec 13 "Cash at the venue", "Venue
// dashboard"; spec 05 section 12 items 1, 5, 6, 7 and 11a):
// - an app game: every player still in it with their payment choice and
//   state, a tick for cash paid (second tap), run collection early, the
//   check-in code, and the venue's cancel (the server's quote first, then a
//   second tap);
// - a walk-in or phone booking: its customer, the venue's price and what was
//   charged, paid by cash or card, and its cancel (second tap).
// Every amount is the server's, only formatted. Every action sends ids.
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Banner, Button, Sheet, SkeletonText, Text } from '@/components/ui';
import { CheckInCode } from '@/components/venue/check-in-code';
import { space } from '@/constants/futty-theme';
import type { CancellationQuote } from '@/lib/booking-actions';
import { formatEuros } from '@/lib/money/format';
import {
  hhmm,
  kindLabel,
  rosterStateLabel,
  venueQuoteWords,
  type AppRoster,
  type BoardBooking,
  type CounterRoster,
  type Roster,
  type RosterPlayer,
  type VenueCancelResult,
} from '@/lib/venue-today';

/** Each returns null when done, or the server's refusal in words. */
export type BookingSheetActions = {
  tickCash: (shareId: string) => Promise<string | null>;
  runCollection: (bookingId: string) => Promise<string | null>;
  checkInCode: (matchId: string) => Promise<{ code: string } | { error: string }>;
  markCounterPaid: (bookingId: string, method: 'cash' | 'card') => Promise<string | null>;
  cancelCounter: (bookingId: string) => Promise<string | null>;
  venueQuote: (bookingId: string) => Promise<{ quote: CancellationQuote } | { error: string }>;
  venueCancel: (bookingId: string, quote: string) => Promise<VenueCancelResult>;
};

export type RosterLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; roster: Roster };

export type BookingSheetProps = {
  visible: boolean;
  onClose: () => void;
  booking: BoardBooking | null;
  state: RosterLoad;
  onRetry: () => void;
  actions: BookingSheetActions;
};

export function BookingSheet({ visible, onClose, booking, state, onRetry, actions }: BookingSheetProps) {
  const { height } = useWindowDimensions();
  const title = booking ? `${kindLabel(booking)} · ${hhmm(booking.start_time)}–${hhmm(booking.end_time)}` : '';
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={styles.content}>
        {state.status === 'loading' ? <SkeletonText lines={4} /> : null}
        {state.status === 'error' ? (
          <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: onRetry }} />
        ) : null}
        {state.status === 'ready' && state.roster.kind === 'app' ? (
          <AppGame roster={state.roster} actions={actions} />
        ) : null}
        {state.status === 'ready' && state.roster.kind === 'counter' ? (
          <CounterBooking roster={state.roster} actions={actions} />
        ) : null}
        {state.status === 'ready' && state.roster.kind !== 'app' && state.roster.kind !== 'counter' ? (
          <Text tone="inkMuted">
            {state.roster.note ?? 'Training'}. Manage it under Recurring training slots.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

// ---- An app game ---------------------------------------------------------

type QuoteState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'shown'; quote: CancellationQuote; changed: boolean }
  | { status: 'cancelled' };

function AppGame({ roster, actions }: { roster: AppRoster; actions: BookingSheetActions }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteState>({ status: 'none' });

  async function run(key: string, work: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    const refusal = await work();
    setBusy(null);
    if (refusal) setError(refusal);
    return refusal;
  }

  async function tick(shareId: string) {
    const refusal = await run(`tick-${shareId}`, () => actions.tickCash(shareId));
    if (!refusal) setConfirming(null);
  }

  async function showCode(matchId: string) {
    await run('code', async () => {
      const result = await actions.checkInCode(matchId);
      if ('error' in result) return result.error;
      setCode(result.code);
      return null;
    });
  }

  async function askQuote() {
    setQuote({ status: 'loading' });
    await run('quote', async () => {
      const result = await actions.venueQuote(roster.booking_id);
      if ('error' in result) {
        setQuote({ status: 'none' });
        return result.error;
      }
      setQuote({ status: 'shown', quote: result.quote, changed: false });
      return null;
    });
  }

  async function confirmCancel(shown: CancellationQuote) {
    await run('cancel', async () => {
      const result = await actions.venueCancel(roster.booking_id, shown.quote);
      if (result.status === 'error') return result.message;
      setQuote(result.status === 'changed' ? { status: 'shown', quote: result.quote, changed: true } : { status: 'cancelled' });
      return null;
    });
  }

  if (quote.status === 'cancelled') {
    return <Banner tone="info" message="Booking cancelled. Every player has been told." />;
  }

  return (
    <>
      <Text tone="inkMuted">Booked by {roster.booker_name ?? 'a player'}</Text>
      {roster.players.length === 0 ? <Text tone="inkMuted">Nobody has joined yet.</Text> : null}
      {roster.players.map((player) => (
        <PlayerRow
          key={player.share_id}
          player={player}
          confirming={confirming === player.share_id}
          busy={busy === `tick-${player.share_id}`}
          onTick={() => setConfirming(player.share_id)}
          onConfirm={() => tick(player.share_id)}
          onBack={() => setConfirming(null)}
        />
      ))}
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {roster.collection_started ? <Text tone="inkMuted">Collection has run for this game.</Text> : null}
      {roster.can_run_collection ? (
        <Button
          label="Run collection now"
          variant="secondary"
          loading={busy === 'collection'}
          onPress={() => run('collection', () => actions.runCollection(roster.booking_id))}
        />
      ) : null}
      {roster.match_id ? (
        code ? (
          <CheckInCode code={code} />
        ) : (
          <Button
            label="Show check-in code"
            variant="secondary"
            loading={busy === 'code'}
            onPress={() => showCode(roster.match_id!)}
          />
        )
      ) : null}
      {roster.status === 'confirmed' && quote.status !== 'shown' ? (
        <Button label="Cancel booking" variant="destructive" loading={quote.status === 'loading'} onPress={askQuote} />
      ) : null}
      {quote.status === 'shown' ? (
        <View style={styles.quote}>
          {quote.changed ? <Banner tone="warning" message="What happens has changed. Check it again before cancelling." /> : null}
          {venueQuoteWords(quote.quote, roster).map((line) => (
            <Text key={line} tabular>
              {line}
            </Text>
          ))}
          <Button
            label="Cancel booking and refund players"
            variant="destructive"
            loading={busy === 'cancel'}
            onPress={() => confirmCancel(quote.quote)}
          />
          <Button label="Keep booking" variant="plain" onPress={() => setQuote({ status: 'none' })} />
        </View>
      ) : null}
    </>
  );
}

function PlayerRow({
  player,
  confirming,
  busy,
  onTick,
  onConfirm,
  onBack,
}: {
  player: RosterPlayer;
  confirming: boolean;
  busy: boolean;
  onTick: () => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { label, tone } = rosterStateLabel(player.state);
  const cash = player.cash_cents > 0 ? `${formatEuros(player.cash_cents)} ` : '';
  return (
    <View testID={`player-${player.share_id}`} style={styles.player}>
      <View style={styles.playerLine}>
        <Text style={styles.flex}>
          {player.name ?? 'A player'}
          {player.is_booker ? ' · Booker' : ''}
        </Text>
        <Text variant="callout" tone={tone}>
          {label}
        </Text>
      </View>
      {player.checked_in ? (
        <Text variant="caption" tone="inkMuted">
          Checked in
        </Text>
      ) : null}
      {player.state === 'cash' && !confirming ? (
        <Button label={`Mark ${cash}cash paid`} variant="secondary" onPress={onTick} />
      ) : null}
      {player.state === 'cash' && confirming ? (
        <View style={styles.row}>
          <Button label={`Confirm ${cash}cash received`} loading={busy} onPress={onConfirm} />
          <Button label="Not yet" variant="plain" disabled={busy} onPress={onBack} />
        </View>
      ) : null}
    </View>
  );
}

// ---- A walk-in or phone booking -------------------------------------------

function CounterBooking({ roster, actions }: { roster: CounterRoster; actions: BookingSheetActions }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const label = roster.source === 'phone' ? 'Phone' : 'Walk-in';
  const paid = roster.paid_method !== null;
  const price =
    roster.venue_price_cents !== null && roster.venue_price_cents !== roster.charged_cents
      ? `Your price ${formatEuros(roster.venue_price_cents)} · charged ${formatEuros(roster.charged_cents)}`
      : `Your price ${formatEuros(roster.charged_cents)}`;

  async function run(key: string, work: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    const refusal = await work();
    setBusy(null);
    if (refusal) setError(refusal);
  }

  return (
    <>
      <Text variant="callout" tone="inkMuted">
        {label}
      </Text>
      <Text variant="headline">{roster.contact.name}</Text>
      {roster.contact.phone ? <Text tone="inkMuted">{roster.contact.phone}</Text> : null}
      <Text tabular>{price}</Text>
      {roster.charged_cents === 0 ? (
        <Text tone="inkMuted">Free</Text>
      ) : (
        <Text tone={paid ? 'success' : 'warning'}>{paid ? `Paid ${roster.paid_method}` : 'Not paid'}</Text>
      )}
      {!paid && roster.charged_cents > 0 && roster.status === 'confirmed' ? (
        <View style={styles.row}>
          <Button
            label="Paid cash"
            loading={busy === 'cash'}
            onPress={() => run('cash', () => actions.markCounterPaid(roster.booking_id, 'cash'))}
          />
          <Button
            label="Paid card"
            variant="secondary"
            loading={busy === 'card'}
            onPress={() => run('card', () => actions.markCounterPaid(roster.booking_id, 'card'))}
          />
        </View>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {roster.status === 'confirmed' && !confirming ? (
        <Button
          label={roster.source === 'phone' ? 'Cancel phone booking' : 'Cancel walk-in'}
          variant="destructive"
          onPress={() => setConfirming(true)}
        />
      ) : null}
      {roster.status === 'confirmed' && confirming ? (
        <View style={styles.quote}>
          <Text tabular>
            {paid && roster.charged_cents > 0
              ? `${formatEuros(roster.charged_cents)} comes off your revenue. Hand it back at the counter.`
              : 'The pitch is released for new bookings.'}
          </Text>
          <Button
            label="Yes, cancel it"
            variant="destructive"
            loading={busy === 'cancel'}
            onPress={() => run('cancel', () => actions.cancelCounter(roster.booking_id))}
          />
          <Button label="Keep it" variant="plain" onPress={() => setConfirming(false)} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingBottom: space.sm },
  player: { gap: space.xs },
  playerLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  quote: { gap: space.sm },
});
