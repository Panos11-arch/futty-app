// The venue dashboard's Debts list (P6d; docs/specs/13-payments-bookings.md
// "Debt", "A debt settled at the venue"): what players owe this venue, open
// by default, settled too on a toggle. "Mark settled" first asks; only the
// confirm calls settle_debt, which records the whole debt as paid at the
// venue and Futty's part as owed by the venue (off its next payout). Every
// amount is the one venue_debt_list returned.
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  EmptyState,
  ListRow,
  SegmentedControl,
  Sheet,
  SkeletonBlock,
  Text,
} from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useLoad } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import {
  cyprusDateOf,
  debtReasonLabel,
  describeMoneyError,
  fetchDebts,
  formatDay,
  settleDebt,
  type DebtListItem,
} from '@/lib/venue-money';
import { hhmm } from '@/lib/venue-today';

type Show = 'open' | 'all';

function about(d: DebtListItem): string {
  const game = d.booking_day ? ` · game on ${formatDay(d.booking_day)}${d.start_time ? ` at ${hhmm(d.start_time)}` : ''}` : '';
  const settled = d.settled_at ? `\nSettled ${formatDay(cyprusDateOf(d.settled_at))}` : '';
  return `${debtReasonLabel(d.reason)}${game}${settled}`;
}

export function DebtsView({ venueId }: { venueId: string }) {
  const [show, setShow] = useState<Show>('open');
  const [asking, setAsking] = useState<DebtListItem | null>(null);
  const [settling, setSettling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const includeSettled = show === 'all';
  const load = useCallback(async () => {
    const { data, error } = await fetchDebts(venueId, includeSettled);
    if (error || !data) throw new Error(describeMoneyError(error?.message ?? ''));
    return data as DebtListItem[];
  }, [venueId, includeSettled]);
  const { state, reload } = useLoad(`${venueId}|${show}`, load);

  // Set at once on the confirm tap, so a second tap before React re-renders
  // the disabled button sends nothing.
  const settlingRef = useRef(false);

  async function confirmSettled() {
    if (!asking || settlingRef.current) return;
    settlingRef.current = true;
    setSettling(true);
    const { error } = await settleDebt(asking.debt_id);
    settlingRef.current = false;
    setSettling(false);
    setAsking(null);
    if (error) {
      setNotice(describeMoneyError(error.message));
      // Settled or gone meanwhile: the list on screen is out of date.
      if (error.message === 'debt_settled' || error.message === 'debt_not_found') reload();
    } else {
      setNotice(null);
      reload();
    }
  }

  // The sheet can't be closed while settle_debt runs.
  function closeSheet() {
    if (!settlingRef.current) setAsking(null);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SegmentedControl
        accessibilityLabel="Which debts"
        options={[
          { value: 'open', label: 'Open' },
          { value: 'all', label: 'Settled too' },
        ]}
        value={show}
        onChange={(value) => {
          setShow(value);
          setNotice(null);
        }}
      />
      <Text variant="callout" tone="inkMuted">
        A player in debt can&apos;t book anywhere on Futty until it&apos;s cleared. Mark a debt settled when they pay
        you in person.
      </Text>

      {notice ? <Banner tone="danger" message={notice} /> : null}
      {state.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 8} /> : null}
      {state.status === 'error' ? (
        <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState icon="checkmark.circle.fill" message="Nobody owes you anything." />
      ) : null}
      {state.status === 'ready'
        ? state.data.map((d) => (
            <View key={d.debt_id} testID={`debt-${d.debt_id}`} style={styles.debt}>
              <ListRow
                title={d.name}
                subtitle={about(d)}
                trailing={
                  <Text variant="headline" tone={d.settled_at ? 'inkMuted' : 'danger'} tabular>
                    {formatEuros(d.amount_cents)}
                  </Text>
                }
              />
              {d.settled_at ? null : (
                <Button
                  label={`Mark ${formatEuros(d.amount_cents)} settled`}
                  variant="secondary"
                  onPress={() => {
                    setNotice(null);
                    setAsking(d);
                  }}
                />
              )}
            </View>
          ))
        : null}

      <Sheet
        visible={asking !== null}
        onClose={closeSheet}
        title="Mark debt settled"
        primaryAction={{ label: 'Yes, settled', onPress: confirmSettled, loading: settling, disabled: settling }}
        secondaryAction={{ label: 'Not yet', disabled: settling }}>
        {asking ? (
          <>
            <Text variant="body">
              {`${asking.name} paid you ${formatEuros(asking.amount_cents)} in person? This clears their debt.`}
            </Text>
            {asking.futty_cents > 0 ? (
              <Text variant="callout" tone="inkMuted">
                {`Futty's part, ${formatEuros(asking.futty_cents)}, comes off your next payout.`}
              </Text>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  debt: { gap: space.sm },
});
