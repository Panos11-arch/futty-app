// S10A admin: a tournament's details (create and edit): name, area, venue (or
// none), format, dates (empty for "Coming soon"), the sign-up deadline,
// subs, the entry fee (shown only, never collected) and match length. The
// structure is fixed at 16 teams (4 groups of 4). The server checks it all.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import type { TournamentInput } from '@/lib/match/tournament-api';
import { describeTournamentError } from '@/lib/match/tournament-errors';
import {
  SQUAD_SUBS,
  TOURNAMENT_FORMATS,
  toTournamentChanges,
  toTournamentInput,
  type TournamentForm,
} from '@/lib/match/tournament-form';
import { TEAM_CITIES } from '@/lib/teams';
import { makeStyles } from '@/lib/theme';
import { useVenues } from '@/lib/use-venues';

export function AdminTournamentForm({
  initial,
  submitLabel,
  onSubmit,
  editing = false,
}: {
  initial: TournamentForm;
  submitLabel: string;
  /** Returns the server's error code, or null when saved. Editing sends only what changed. */
  onSubmit: (input: TournamentInput | Partial<TournamentInput>) => Promise<string | null>;
  editing?: boolean;
}) {
  const styles = useStyles();
  const [form, setForm] = useState<TournamentForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const venues = useVenues();
  const set = <K extends keyof TournamentForm>(key: K, value: TournamentForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const result = editing ? toTournamentChanges(initial, form) : toTournamentInput(form);
    if ('error' in result) {
      haptic.error();
      setError(describeTournamentError({ message: result.error }));
      return;
    }
    setBusy(true);
    setError(null);
    const code = await onSubmit(result.input);
    setBusy(false);
    if (code) {
      haptic.error();
      setError(describeTournamentError({ message: code }));
      return;
    }
    haptic.success();
  }

  return (
    <ScrollView contentContainerStyle={styles.content} testID="admin-tournament-form" keyboardShouldPersistTaps="handled">
      <TextField testID="admin-tournament-name" label="Name" value={form.name} onChangeText={(v) => set('name', v)} maxLength={60} />
      <SectionHeader title="Area" />
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Area">
        {TEAM_CITIES.map((c) => (
          <Chip key={c} label={c} selected={form.area === c} onPress={() => set('area', c)} testID={`admin-tournament-area-${c.toLowerCase()}`} />
        ))}
      </View>
      <SectionHeader title="Venue" />
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Venue">
        <Chip label="None" selected={form.venueId === null} onPress={() => set('venueId', null)} testID="admin-tournament-venue-none" />
        {venues.status === 'ready'
          ? venues.venues.map((v) => (
              <Chip
                key={v.id}
                label={v.name}
                selected={form.venueId === v.id}
                onPress={() => set('venueId', v.id)}
                testID={`admin-tournament-venue-${v.id}`}
              />
            ))
          : null}
      </View>
      <SectionHeader title="Format" />
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Format">
        {TOURNAMENT_FORMATS.map((f) => (
          <Chip key={f} label={f} selected={form.format === f} onPress={() => set('format', f)} testID={`admin-tournament-format-${f}`} />
        ))}
      </View>
      <SectionHeader title="Subs" />
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Subs">
        {SQUAD_SUBS.map((n) => (
          <Chip key={n} label={String(n)} selected={form.squadSubs === n} onPress={() => set('squadSubs', n)} testID={`admin-tournament-subs-${n}`} />
        ))}
      </View>
      <TextField
        testID="admin-tournament-start"
        label="Start date"
        placeholder="YYYY-MM-DD"
        value={form.startDate}
        onChangeText={(v) => set('startDate', v)}
      />
      <TextField
        testID="admin-tournament-end"
        label="End date"
        placeholder="YYYY-MM-DD"
        value={form.endDate}
        onChangeText={(v) => set('endDate', v)}
      />
      <TextField
        testID="admin-tournament-deadline-day"
        label="Sign-up deadline"
        placeholder="YYYY-MM-DD"
        value={form.deadlineDay}
        onChangeText={(v) => set('deadlineDay', v)}
      />
      <TextField
        testID="admin-tournament-deadline-time"
        label="Deadline time"
        placeholder="HH:MM"
        value={form.deadlineTime}
        onChangeText={(v) => set('deadlineTime', v)}
      />
      <TextField
        testID="admin-tournament-fee"
        label="Entry fee per player (€)"
        keyboardType="decimal-pad"
        value={form.entryFee}
        onChangeText={(v) => set('entryFee', v)}
      />
      <TextField
        testID="admin-tournament-minutes"
        label="Match length (minutes)"
        keyboardType="number-pad"
        value={form.matchMinutes}
        onChangeText={(v) => set('matchMinutes', v)}
      />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="admin-tournament-error">
          {error}
        </Text>
      ) : null}
      <Button label={submitLabel} onPress={() => void save()} loading={busy} fullWidth testID="admin-tournament-save" />
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl, backgroundColor: colors.canvas },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
