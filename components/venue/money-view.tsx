// The venue dashboard's Money screen (P6d; docs/specs/13-payments-bookings.md
// "Venue dashboard", Revenue). Revenue by source (app card, app cash, walk-in,
// phone) for a day, a week or a month, with Futty's and Stripe's figures
// beside the venue's, the totals, and the walk-ins charged at a price other
// than the venue's. Every amount is a field venue_revenue returned, shown as
// it came: the screen adds nothing up. "Export CSV" calls
// venue_revenue_export once and shares the file; "Export payouts CSV" does
// the same with venue_payouts_export, for the payouts sent in the same period
// (lib/revenue-export.ts).
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  IconButton,
  ListRow,
  SectionHeader,
  SegmentedControl,
  SkeletonBlock,
  Text,
} from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useLoad } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import type { RevenueTotals } from '@/lib/money/revenue-csv';
import { exportPayoutsCsv, exportRevenueCsv } from '@/lib/revenue-export';
import {
  canStepForward,
  describeMoneyError,
  fetchRevenue,
  formatDay,
  periodLabel,
  periodStart,
  revenueSourceLabel,
  stepPeriod,
  type Period,
  type PriceOverride,
  type RevenueScreen,
} from '@/lib/venue-money';
import { cyprusToday, hhmm } from '@/lib/venue-today';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function Figure({ label, cents, testID, strong }: { label: string; cents: number; testID: string; strong?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text variant="callout" tone="inkMuted">
        {label}
      </Text>
      <Text variant={strong ? 'headline' : 'body'} tabular testID={testID}>
        {formatEuros(cents)}
      </Text>
    </View>
  );
}

function Figures({ title, totals, id, strong }: { title: string; totals: RevenueTotals; id: string; strong?: boolean }) {
  return (
    <Card>
      <View style={styles.cardHead}>
        <Text variant="headline">{title}</Text>
        <Text variant="caption" tone="inkMuted" tabular>
          {totals.rows === 1 ? '1 entry' : `${totals.rows} entries`}
        </Text>
      </View>
      <View style={styles.figures}>
        <Figure label="Venue" cents={totals.venue_cents} testID={`revenue-${id}-venue`} strong={strong} />
        <Figure label="Futty" cents={totals.futty_cents} testID={`revenue-${id}-futty`} />
        <Figure label="Stripe fee" cents={totals.stripe_fee_cents} testID={`revenue-${id}-stripe`} />
      </View>
    </Card>
  );
}

function priceWords(venuePrice: number | null, charged: number | null): string {
  const yours = venuePrice === null ? 'No price set' : `Your price ${formatEuros(venuePrice)}`;
  return charged === null ? yours : `${yours} · charged ${formatEuros(charged)}`;
}

function OverrideRow({ o }: { o: PriceOverride }) {
  return (
    <View testID={`override-${o.booking_id}`}>
      <ListRow
        title={o.contact_name}
        subtitle={[
          `${revenueSourceLabel(o.source)} · ${formatDay(o.booking_day)} at ${hhmm(o.start_time)}`,
          priceWords(o.venue_price_cents, o.charged_cents),
        ].join('\n')}
      />
    </View>
  );
}

export function MoneyView({ venueId }: { venueId: string }) {
  const today = cyprusToday();
  const [period, setPeriod] = useState<Period>('day');
  const [day, setDay] = useState(today);
  const [exporting, setExporting] = useState(false);
  const [exportingPayouts, setExportingPayouts] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'warning'; message: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await fetchRevenue(venueId, period, day);
    if (error || !data) throw new Error(describeMoneyError(error?.message ?? ''));
    return data as RevenueScreen;
  }, [venueId, period, day]);
  const { state, reload } = useLoad(`${venueId}|${period}|${day}`, load);
  const ready = state.status === 'ready' ? state.data : null;

  function choosePeriod(next: Period) {
    setPeriod(next);
    setDay(periodStart(next, today));
    setNotice(null);
  }

  function step(n: number) {
    setDay((d) => stepPeriod(period, d, n));
    setNotice(null);
  }

  async function exportCsv() {
    if (!ready) return;
    setExporting(true);
    setNotice(null);
    const result = await exportRevenueCsv(venueId, period, day, ready);
    setExporting(false);
    if (result.status === 'changed') {
      setNotice({ tone: 'warning', message: describeMoneyError('revenue_changed') });
      reload();
    } else if (result.status === 'error') {
      setNotice({ tone: 'danger', message: result.message });
    }
  }

  async function exportPayouts() {
    setExportingPayouts(true);
    setNotice(null);
    const result = await exportPayoutsCsv(venueId, period, day);
    setExportingPayouts(false);
    if (result.status === 'error') setNotice({ tone: 'danger', message: result.message });
  }

  const title = ready ? periodLabel(period, ready.from, ready.to, today) : periodLabel(period, day, day, today);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SegmentedControl accessibilityLabel="Period" options={PERIODS} value={period} onChange={choosePeriod} />
      <View style={styles.stepper}>
        <IconButton icon="chevron.left" accessibilityLabel="Previous period" onPress={() => step(-1)} />
        <Text variant="headline" tabular style={styles.stepperTitle} testID="period-title">
          {title}
        </Text>
        <IconButton
          icon="chevron.right"
          accessibilityLabel="Next period"
          disabled={!canStepForward(period, day, today)}
          onPress={() => step(1)}
        />
      </View>

      <Text variant="callout" tone="inkMuted">
        Venue is what your venue takes, dated by when the money moved (Cyprus time). Futty and Stripe fee are shown
        beside it and are not part of it.
      </Text>

      {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}

      {state.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 10} /> : null}
      {state.status === 'error' ? (
        <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />
      ) : null}

      {ready ? (
        <>
          {ready.sources.map((s) => (
            <Figures key={s.source} title={revenueSourceLabel(s.source)} totals={s} id={s.source} />
          ))}
          <Figures title="Total" totals={ready.totals} id="total" strong />

          <Button
            label="Export CSV"
            variant="secondary"
            loading={exporting}
            disabled={exporting}
            onPress={exportCsv}
            fullWidth
          />

          <Text variant="callout" tone="inkMuted">
            Stripe pays your bank on its own schedule, so one bank deposit can hold several transfers. Your Stripe
            dashboard shows which.
          </Text>
          <Button
            label="Export payouts CSV"
            variant="secondary"
            loading={exportingPayouts}
            disabled={exportingPayouts}
            onPress={exportPayouts}
            fullWidth
          />

          <View style={styles.section}>
            <SectionHeader title="Price overrides" />
            {ready.overrides.length === 0 ? (
              <EmptyState icon="list.clipboard.fill" message="Every walk-in and phone booking was charged your price." />
            ) : (
              ready.overrides.map((o) => <OverrideRow key={o.booking_id} o={o} />)
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepperTitle: { flex: 1, textAlign: 'center' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.sm },
  figures: { flexDirection: 'row', gap: space.md },
  figure: { flex: 1, gap: space.xs },
  section: { gap: space.sm, marginTop: space.xl },
});
