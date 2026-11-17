// The venue dashboard's Customers list (P6d; docs/specs/13-payments-bookings.md
// "Venue dashboard", Customers): app players by name with their bookings,
// debt and credit at this venue (never their email or phone), and walk-in
// and phone contacts with the phone staff entered. Each row shows only the
// fields named here, so nothing else the server sent can appear.
import { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Banner, EmptyState, ListRow, SkeletonBlock } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useLoad } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import { describeMoneyError, fetchCustomers, formatDay, type CustomerKind, type CustomerListItem } from '@/lib/venue-money';

function count(n: number) {
  return n === 1 ? '1 booking' : `${n} bookings`;
}

function lines(c: CustomerListItem): string {
  const last = c.last_booking_day ? `Last booking ${formatDay(c.last_booking_day)}` : null;
  if (c.kind === 'contact') {
    return [[c.phone, count(c.bookings)].filter(Boolean).join(' · '), last].filter(Boolean).join('\n');
  }
  const money = [
    count(c.bookings),
    c.debt_cents !== 0 ? `owes ${formatEuros(c.debt_cents)}` : null,
    c.credit_cents !== 0 ? `credit ${formatEuros(c.credit_cents)}` : null,
  ];
  return [money.filter(Boolean).join(' · '), last].filter(Boolean).join('\n');
}

export function CustomersView({ venueId, onOpen }: { venueId: string; onOpen: (kind: CustomerKind, id: string) => void }) {
  const load = useCallback(async () => {
    const { data, error } = await fetchCustomers(venueId);
    if (error || !data) throw new Error(describeMoneyError(error?.message ?? ''));
    return data as CustomerListItem[];
  }, [venueId]);
  const { state, reload } = useLoad(venueId, load);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {state.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 8} /> : null}
      {state.status === 'error' ? (
        <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState icon="person.2.fill" message="No customers yet. Everyone who books here will show up here." />
      ) : null}
      {state.status === 'ready'
        ? state.data.map((c) => {
            const id = c.kind === 'player' ? c.profile_id : c.contact_id;
            return (
              <ListRow
                key={`${c.kind}-${id}`}
                title={c.name}
                subtitle={lines(c)}
                leading={{ icon: c.kind === 'player' ? 'person.fill' : 'phone.fill' }}
                chevron
                onPress={() => onOpen(c.kind, id)}
              />
            );
          })
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
});
