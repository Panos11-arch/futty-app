// One customer of the venue (P6d; docs/specs/13-payments-bookings.md "Venue
// dashboard", Customers). A player: their name, the debt and credit at this
// venue as venue_customer returned them, every booking here with its status,
// their debts here (open and settled, read only: settling is on the Debts
// list) and their credits with expiry. Never their email or phone. A walk-in
// or phone contact: the name and phone staff entered and their bookings.
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Card, EmptyState, ListRow, SectionHeader, SkeletonBlock, Text } from '@/components/ui';
import { BookingStatusMark } from '@/components/venue/bookings-list-view';
import { space } from '@/constants/futty-theme';
import { useLoad } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import {
  bookingSourceLabel,
  cyprusDateOf,
  debtReasonLabel,
  describeMoneyError,
  fetchCustomer,
  formatDay,
  shareStatusLabel,
  type ContactBooking,
  type CustomerCredit,
  type CustomerDetail,
  type CustomerKind,
  type PlayerBooking,
} from '@/lib/venue-money';
import { hhmm } from '@/lib/venue-today';

function when(b: { booking_day: string; start_time: string; end_time: string }) {
  return `${formatDay(b.booking_day)} · ${hhmm(b.start_time)}–${hhmm(b.end_time)}`;
}

/** A share still in the game, whose card and cash parts have a state worth showing. */
const IN_GAME = ['pending', 'authorized', 'paid'];

/** "Player · €0.80 by card, pending · €6.00 cash, not yet received": the
 *  amounts and states as the server sent them. A share no longer in the game
 *  shows its state in words and the amounts alone. */
function playerShare(b: PlayerBooking): string {
  const role = b.is_booker ? 'Booker' : 'Player';
  if (!b.share_status) return `${role} · ${b.format}`;
  const inGame = IN_GAME.includes(b.share_status);
  const card = b.amount_cents
    ? `${formatEuros(b.amount_cents)} by card${inGame ? (b.share_status === 'paid' ? ', paid' : ', pending') : ''}`
    : null;
  const cash = b.cash_cents
    ? `${formatEuros(b.cash_cents)} cash${inGame ? (b.cash_received ? ', received' : ', not yet received') : ''}`
    : null;
  return [role, inGame ? null : shareStatusLabel(b.share_status), card, cash].filter(Boolean).join(' · ');
}

/** A credit's state from the server: Expired once its expiry has passed, Used up when spent, else Expires. */
function creditLine(cr: CustomerCredit): string {
  const on = formatDay(cyprusDateOf(cr.expires_at));
  if (cr.expired) return `${formatEuros(cr.remaining_cents)} left of ${formatEuros(cr.amount_cents)} · Expired ${on}`;
  if (cr.remaining_cents === 0) return `${formatEuros(cr.amount_cents)} · Used up`;
  return `${formatEuros(cr.remaining_cents)} left of ${formatEuros(cr.amount_cents)} · Expires ${on}`;
}

function contactBooking(b: ContactBooking): string {
  const yours = b.venue_price_cents === null ? 'no price set' : `your price ${formatEuros(b.venue_price_cents)}`;
  const charged = b.charged_cents === null ? null : `charged ${formatEuros(b.charged_cents)}`;
  const paid = b.paid_method === 'cash' ? 'paid cash' : b.paid_method === 'card' ? 'paid by card' : 'not paid yet';
  return [bookingSourceLabel(b.source), yours, charged, paid].filter(Boolean).join(' · ');
}

function Figure({ label, cents, testID }: { label: string; cents: number; testID: string }) {
  return (
    <View style={styles.figure}>
      <Text variant="callout" tone="inkMuted">
        {label}
      </Text>
      <Text variant="headline" tabular testID={testID}>
        {formatEuros(cents)}
      </Text>
    </View>
  );
}

function Detail({ c }: { c: CustomerDetail }) {
  return (
    <>
      <Text variant="title">{c.name}</Text>
      {c.kind === 'contact' ? (
        c.phone ? (
          <Text variant="body" tone="inkMuted" tabular>
            {c.phone}
          </Text>
        ) : null
      ) : (
        <Card>
          <View style={styles.figures}>
            <Figure label="Owes your venue" cents={c.debt_cents} testID="customer-debt" />
            <Figure label="Credit at your venue" cents={c.credit_cents} testID="customer-credit" />
          </View>
        </Card>
      )}

      <View style={styles.section}>
        <SectionHeader title="Bookings" />
        {c.bookings.length === 0 ? <EmptyState icon="calendar" message="No bookings here yet." /> : null}
        {c.bookings.map((b) => (
          <View key={b.booking_id} testID={`customer-booking-${b.booking_id}`}>
            <ListRow
              title={when(b)}
              subtitle={c.kind === 'player' ? playerShare(b as PlayerBooking) : contactBooking(b as ContactBooking)}
              trailing={<BookingStatusMark status={b.booking_status} />}
            />
          </View>
        ))}
      </View>

      {c.kind === 'player' ? (
        <>
          <View style={styles.section}>
            <SectionHeader title="Debts" />
            {c.debts.length === 0 ? (
              <Text variant="callout" tone="inkMuted">
                Never owed your venue anything.
              </Text>
            ) : null}
            {c.debts.map((d) => (
              <View key={d.debt_id} testID={`customer-debt-${d.debt_id}`}>
                <ListRow
                  title={`${formatEuros(d.amount_cents)} · ${debtReasonLabel(d.reason)} · ${
                    d.settled_at ? `settled ${formatDay(cyprusDateOf(d.settled_at))}` : 'open'
                  }`}
                  subtitle={`Since ${formatDay(cyprusDateOf(d.created_at))}`}
                />
              </View>
            ))}
          </View>
          <View style={styles.section}>
            <SectionHeader title="Credit" />
            {c.credits.length === 0 ? (
              <Text variant="callout" tone="inkMuted">
                No credit at your venue.
              </Text>
            ) : null}
            {c.credits.map((cr) => (
              <View key={cr.credit_id} testID={`customer-credit-${cr.credit_id}`}>
                <ListRow title={creditLine(cr)} />
              </View>
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

export function CustomerView({ venueId, kind, id }: { venueId: string; kind: CustomerKind; id: string }) {
  const load = useCallback(async () => {
    const { data, error } = await fetchCustomer(venueId, kind, id);
    if (error || !data) throw new Error(describeMoneyError(error?.message ?? ''));
    return data as CustomerDetail;
  }, [venueId, kind, id]);
  const { state, reload } = useLoad(`${venueId}|${kind}|${id}`, load);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {state.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 8} /> : null}
      {state.status === 'error' ? (
        <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />
      ) : null}
      {state.status === 'ready' ? <Detail c={state.data} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  figures: { flexDirection: 'row', gap: space.md },
  figure: { flex: 1, gap: space.xs },
  section: { gap: space.sm, marginTop: space.xl },
});
