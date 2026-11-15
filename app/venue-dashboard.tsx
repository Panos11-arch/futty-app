// The venue dashboard's Today screen (P6c; docs/specs/13-payments-bookings.md
// "Venue dashboard", "Cash at the venue", "Weather, condition warnings and
// blocking pitches"; spec 05 section 12; spec 15 "Venue dashboard"). Phone
// first, every common action in two taps or fewer:
// - a day calendar per pitch (venue_day_board): bookings, walk-ins, blocks
//   and condition flags; tap a booking for its roster (cash tick, run
//   collection, check-in code, cancel), tap a free slot to add a walk-in,
//   tap a blocked slot to remove its block; past slots (Cyprus time) take
//   no tap;
// - Block and Flag conditions for the day or a time range;
// - the 6 v 6 on 5-a-side pitches setting;
// - below, unchanged from before P6c: adding a house player and recurring
//   training slots (restyled in P6e).
// The app never computes an amount: it sends ids and choices, and shows the
// amounts the server returns.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Chip,
  EmptyState,
  IconButton,
  ListRow,
  SectionHeader,
  SegmentedControl,
  SkeletonBlock,
  Text,
} from '@/components/ui';
import { BlockSheet } from '@/components/venue/block-sheet';
import { BookingSheet, type BookingSheetActions, type RosterLoad } from '@/components/venue/booking-sheet';
import { DayCalendar } from '@/components/venue/day-calendar';
import { DayMarks } from '@/components/venue/day-marks';
import { MarkSheet, type MarkMode } from '@/components/venue/mark-sheet';
import { NeedPlayersSection } from '@/components/venue/need-players-section';
import { TrainingSlotsSection } from '@/components/venue/training-slots-section';
import { WalkInSheet } from '@/components/venue/walk-in-sheet';
import { colors, space } from '@/constants/futty-theme';
import type { CancellationQuote } from '@/lib/booking-actions';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useProfile } from '@/lib/use-profile';
import {
  addBlock,
  addCounterBooking,
  addDays,
  bookingSummary,
  bookingTitle,
  cancelCounterBooking,
  canStartGame,
  clearConditions,
  confirmVenueCancel,
  cyprusNow,
  cyprusToday,
  dayTitle,
  describeVenueError,
  fetchCheckInCode,
  fetchDayBoard,
  fetchRoster,
  fetchSlotPrice,
  fetchVenueQuote,
  flagConditions,
  halfHourAfter,
  hhmm,
  kindLabel,
  markCashReceived,
  markCounterPaid,
  markLabel,
  removeBlock,
  requestCollection,
  setAllows6v6,
  slotIsPast,
  unassignedBookings,
  type BoardBlock,
  type BoardBooking,
  type BoardFlag,
  type BoardPitch,
  type DayBoard,
  type Roster,
  type Slot,
} from '@/lib/venue-today';

type DashboardVenue = { id: string; name: string; base_pitches: number | null; allows_6v6_on_5s: boolean };

type BoardState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; board: DayBoard };

type Result = PromiseLike<{ error: { message: string } | null }>;

/** Null when the server accepted it, or its refusal in words. */
async function refusalOf(result: Result): Promise<string | null> {
  const { error } = await result;
  return error ? describeVenueError(error.message) : null;
}

function useDayBoard(venueId: string | null, day: string) {
  const [state, setState] = useState<BoardState>({ status: 'loading' });
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!venueId) return;
    const id = ++requestId.current;
    const { data, error } = await fetchDayBoard(venueId, day);
    if (id !== requestId.current) return;
    setState(error || !data ? { status: 'error', message: describeVenueError(error?.message ?? '') } : { status: 'ready', board: data as DayBoard });
  }, [venueId, day]);

  useEffect(() => {
    setState({ status: 'loading' });
    reload();
  }, [reload]);

  return { state, reload };
}

/** Today's date and the time now in Cyprus, refreshed every minute so past
 *  slots stop taking taps while the dashboard stays open. */
function useCyprusClock() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  return { today: cyprusToday(), now: cyprusNow() };
}

export default function VenueDashboardScreen() {
  const { user } = useAuth();
  const profile = useProfile();
  const clock = useCyprusClock();
  const today = clock.today;

  const [venues, setVenues] = useState<DashboardVenue[] | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [day, setDay] = useState(today);
  const { state: board, reload: reloadBoard } = useDayBoard(venueId, day);

  const [opened, setOpened] = useState<BoardBooking | null>(null);
  const [roster, setRoster] = useState<RosterLoad>({ status: 'loading' });
  const [walkIn, setWalkIn] = useState<{ pitch: BoardPitch; start: string } | null>(null);
  const [blockOpened, setBlockOpened] = useState<BoardBlock | null>(null);
  const [mark, setMark] = useState<{
    mode: MarkMode;
    key: number;
    /** Opened from a slot: that pitch and half hour. */
    slot?: { pitch: BoardPitch; start: string };
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('venues')
      .select('id, name, base_pitches, allows_6v6_on_5s')
      .eq('owner_profile_id', user.id)
      .then(({ data }) => {
        setVenues(data ?? []);
        if (data && data.length > 0) setVenueId(data[0].id);
      });
  }, [user]);

  const venue = venues?.find((v) => v.id === venueId) ?? null;

  // Only the latest booking opened may fill the sheet: a slow answer for an
  // earlier one is dropped.
  const rosterRequest = useRef(0);
  const loadRoster = useCallback(async (bookingId: string) => {
    const id = ++rosterRequest.current;
    setRoster({ status: 'loading' });
    const { data, error } = await fetchRoster(bookingId);
    if (id !== rosterRequest.current) return;
    setRoster(
      error || !data ? { status: 'error', message: describeVenueError(error?.message ?? '') } : { status: 'ready', roster: data as Roster },
    );
  }, []);

  function openBooking(booking: BoardBooking) {
    setOpened(booking);
    loadRoster(booking.id);
  }

  /** A write from the booking sheet: on success, reload the roster and the day. */
  async function bookingWrite(result: Result): Promise<string | null> {
    const refusal = await refusalOf(result);
    if (!refusal && opened) {
      loadRoster(opened.id);
      reloadBoard();
    }
    return refusal;
  }

  const actions: BookingSheetActions = {
    tickCash: (shareId) => bookingWrite(markCashReceived(shareId)),
    runCollection: (bookingId) => bookingWrite(requestCollection(bookingId)),
    markCounterPaid: (bookingId, method) => bookingWrite(markCounterPaid(bookingId, method)),
    cancelCounter: (bookingId) => bookingWrite(cancelCounterBooking(bookingId)),
    checkInCode: async (matchId) => {
      const { data, error } = await fetchCheckInCode(matchId);
      return error || typeof data !== 'string' ? { error: describeVenueError(error?.message ?? '') } : { code: data };
    },
    venueQuote: async (bookingId) => {
      const { data, error } = await fetchVenueQuote(bookingId);
      return error || !data ? { error: describeVenueError(error?.message ?? '') } : { quote: data as CancellationQuote };
    },
    venueCancel: async (bookingId, quote) => {
      const result = await confirmVenueCancel(bookingId, quote);
      if (result.status === 'cancelled') reloadBoard();
      return result;
    },
  };

  async function loadPrice(slot: Slot): Promise<{ cents: number | null } | { error: string }> {
    const { data, error } = await fetchSlotPrice(slot);
    return error ? { error: describeVenueError(error.message) } : { cents: typeof data === 'number' ? data : null };
  }

  async function markWrite(key: string, result: Result) {
    setBusy(key);
    setNotice(null);
    const refusal = await refusalOf(result);
    setBusy(null);
    if (refusal) setNotice(refusal);
    else reloadBoard();
  }

  async function sheetWrite(result: Result): Promise<string | null> {
    const refusal = await refusalOf(result);
    if (!refusal) reloadBoard();
    return refusal;
  }

  async function change6v6(allowed: boolean) {
    if (!venue || venue.allows_6v6_on_5s === allowed) return;
    setBusy('6v6');
    setNotice(null);
    const refusal = await refusalOf(setAllows6v6(venue.id, allowed));
    setBusy(null);
    if (refusal) setNotice(refusal);
    else setVenues((list) => list?.map((v) => (v.id === venue.id ? { ...v, allows_6v6_on_5s: allowed } : v)) ?? null);
  }

  if (profile.status === 'loading') {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.content}>
          <SkeletonBlock width="100%" height={space.xxl * 8} />
        </View>
      </SafeAreaView>
    );
  }

  if (profile.status !== 'ready' || profile.profile.role !== 'venue_owner') {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <EmptyState icon="lock.fill" message="This screen is only available to venue owner accounts." />
      </SafeAreaView>
    );
  }

  const ready = board.status === 'ready' ? board.board : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {!venues ? <SkeletonBlock width="100%" height={space.xxl * 2} /> : null}
        {venues && venues.length === 0 ? (
          <EmptyState
            icon="building.columns.fill"
            message="No venues are linked to your account yet. Ask Futty to link your venue."
          />
        ) : null}

        {venues && venues.length > 1 ? (
          <View style={styles.wrapRow}>
            {venues.map((v) => (
              <Chip key={v.id} label={v.name} selected={v.id === venueId} onPress={() => setVenueId(v.id)} />
            ))}
          </View>
        ) : null}

        {venue ? (
          <>
            <View style={styles.dayRow}>
              <IconButton icon="chevron.left" accessibilityLabel="Previous day" onPress={() => setDay((d) => addDays(d, -1))} />
              <View style={styles.dayTitle}>
                <Text variant="title">{dayTitle(day, today)}</Text>
                <Text variant="callout" tone="inkMuted" tabular>
                  {day}
                </Text>
              </View>
              <IconButton icon="chevron.right" accessibilityLabel="Next day" onPress={() => setDay((d) => addDays(d, 1))} />
            </View>
            {day !== today ? (
              <View style={styles.wrapRow}>
                <Chip label="Back to today" onPress={() => setDay(today)} />
              </View>
            ) : null}

            <View style={styles.actions}>
              <Button label="Block" variant="secondary" onPress={() => setMark({ mode: 'block', key: Date.now() })} />
              <Button
                label="Flag conditions"
                variant="secondary"
                onPress={() => setMark({ mode: 'flag', key: Date.now() })}
              />
            </View>

            {notice ? <Banner tone="danger" message={notice} /> : null}

            {board.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 10} /> : null}
            {board.status === 'error' ? (
              <Banner tone="danger" message={board.message} action={{ label: 'Try again', onPress: reloadBoard }} />
            ) : null}
            {ready ? (
              <>
                <DayMarks
                  board={ready}
                  busy={busy}
                  onRemoveBlock={(b: BoardBlock) => markWrite(b.id, removeBlock(b.id))}
                  onClearFlag={(f: BoardFlag) => markWrite(f.id, clearConditions(f.id))}
                />
                <DayCalendar
                  board={ready}
                  clock={clock}
                  onOpenBooking={openBooking}
                  onAddAt={(pitch, start) => setWalkIn({ pitch, start })}
                  onFlagAt={(pitch, start) => setMark({ mode: 'flag', key: Date.now(), slot: { pitch, start } })}
                  onBlockAt={setBlockOpened}
                />
                {unassignedBookings(ready).length > 0 ? (
                  <View style={styles.section}>
                    <SectionHeader title="No pitch assigned" />
                    {unassignedBookings(ready).map((b) => (
                      <ListRow
                        key={b.id}
                        title={`${hhmm(b.start_time)}–${hhmm(b.end_time)} · ${bookingTitle(b)}`}
                        subtitle={[kindLabel(b), bookingSummary(b)].filter(Boolean).join(' · ')}
                        chevron
                        onPress={() => openBooking(b)}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="6 v 6 on 5-a-side pitches" />
              <SegmentedControl
                accessibilityLabel="6 v 6 on 5-a-side pitches"
                options={[
                  { value: 'off', label: 'Not allowed' },
                  { value: 'on', label: 'Allowed' },
                ]}
                value={venue.allows_6v6_on_5s ? 'on' : 'off'}
                onChange={(value) => change6v6(value === 'on')}
              />
            </View>

            {ready ? <NeedPlayersSection bookings={ready.bookings} /> : null}

            {user ? (
              <View style={styles.divider}>
                <TrainingSlotsSection venue={venue} userId={user.id} today={today} onChanged={reloadBoard} />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <BookingSheet
        key={opened?.id ?? 'none'}
        visible={opened !== null}
        onClose={() => {
          rosterRequest.current += 1;
          setOpened(null);
        }}
        booking={opened}
        state={roster}
        onRetry={() => opened && loadRoster(opened.id)}
        actions={actions}
      />
      {venue && walkIn ? (
        <WalkInSheet
          key={`${walkIn.pitch.id}-${walkIn.start}`}
          visible
          onClose={() => setWalkIn(null)}
          venueId={venue.id}
          day={day}
          pitch={walkIn.pitch}
          start={walkIn.start}
          loadPrice={loadPrice}
          onAdd={(input) => sheetWrite(addCounterBooking(input))}
        />
      ) : null}
      {ready && blockOpened ? (
        <BlockSheet
          key={blockOpened.id}
          visible
          block={blockOpened}
          label={markLabel(ready, blockOpened)}
          onClose={() => setBlockOpened(null)}
          onRemove={(b) => sheetWrite(removeBlock(b.id))}
        />
      ) : null}
      {venue && user && mark ? (
        <MarkSheet
          key={mark.key}
          visible
          mode={mark.mode}
          pitches={ready?.pitches ?? []}
          initial={
            mark.slot
              ? { pitchId: mark.slot.pitch.id, start: mark.slot.start, end: halfHourAfter(mark.slot.start) }
              : undefined
          }
          onAddWalkIn={
            mark.mode === 'flag' &&
            mark.slot &&
            mark.slot.pitch.is_open &&
            canStartGame(mark.slot.start) &&
            !slotIsPast(mark.slot.start, day, clock.today, clock.now)
              ? () => {
                  const slot = mark.slot!;
                  setMark(null);
                  setWalkIn(slot);
                }
              : undefined
          }
          onClose={() => setMark(null)}
          onBlock={(input) => sheetWrite(addBlock({ venueId: venue.id, day, ...input }, user.id))}
          onFlag={(input) => sheetWrite(flagConditions({ venueId: venue.id, day, ...input }))}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dayTitle: { flex: 1, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: space.sm },
  section: { gap: space.sm, marginTop: space.xl },
  divider: { marginTop: space.xl },
});
