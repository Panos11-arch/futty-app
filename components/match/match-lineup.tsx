// Lineups on a drawn pitch (05-product section 5; match-record.md 4.9, 5.3,
// decisions 1e.4–1e.7). Before kickoff a side's captain (the booker for both
// sides of a pickup) picks a formation and places players: tap a player, then
// tap a position. Only that side's players are offered. Empty positions show
// "Need players". After kickoff the lineup is read-only. set_match_lineup
// checks it all again.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RosterState } from '@/components/match/match-scorers';
import { SectionError } from '@/components/match/page-section';
import { Pitch } from '@/components/match/pitch';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import {
  clearPosition,
  lineupDraft,
  lineupEditable,
  placePlayer,
  playerName,
  savedLineup,
  sideOf,
  sidePlayers,
  type LineupDraft,
  type MatchPage,
} from '@/lib/match/page';
import { setMatchLineup } from '@/lib/match/page-api';
import { describeMatchPageError, STALE_PAGE_ERRORS } from '@/lib/match/page-errors';
import type { Side } from '@/lib/match/types';
import type { Loadable } from '@/lib/match/use-match-result';

export type MatchLineupProps = {
  page: MatchPage;
  roster: RosterState | null;
  onRetryRoster: () => void;
  /** The sides the viewer may write (writerSides). */
  writable: Side[];
  presets: Loadable<{ formations: string[] }>;
  onRetryPresets: () => void;
  onSaved: () => void;
  now?: number;
};

export function MatchLineup({
  page,
  roster,
  onRetryRoster,
  writable,
  presets,
  onRetryPresets,
  onSaved,
  now = Date.now(),
}: MatchLineupProps) {
  const [side, setSide] = useState<Side>(writable[0] ?? 'a');
  const [editing, setEditing] = useState(false);
  const [formation, setFormation] = useState<string | null>(null);
  const [draft, setDraft] = useState<LineupDraft>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = lineupEditable(page, now);
  const canEdit = open && writable.includes(side);
  const saved = savedLineup(page, side);

  const stopEditing = () => {
    setEditing(false);
    setSelected(null);
    setError(null);
  };

  const startEditing = () => {
    const first = presets.status === 'ready' ? (presets.formations[0] ?? null) : null;
    const f = saved?.formation ?? first;
    setFormation(f);
    setDraft(saved?.draft ?? (f ? lineupDraft(f) : {}));
    setSelected(null);
    setError(null);
    setEditing(true);
  };

  const sideSwitch = (
    <SegmentedControl
      accessibilityLabel="Which side's lineup"
      options={(['a', 'b'] as const).map((s) => ({ value: s, label: sideOf(page, s).label }))}
      value={side}
      onChange={(s) => {
        setSide(s);
        stopEditing();
      }}
    />
  );

  if (editing && canEdit) {
    const save = async () => {
      if (!formation) return;
      setSaving(true);
      setError(null);
      const { error: saveError } = await setMatchLineup(page.matchId, side, formation, draft);
      setSaving(false);
      if (saveError) {
        setError(describeMatchPageError(saveError));
        if (STALE_PAGE_ERRORS.has(saveError.message)) onSaved();
        return;
      }
      stopEditing();
      onSaved();
    };

    let formations: React.ReactNode;
    if (presets.status === 'loading') formations = <SkeletonText lines={1} />;
    else if (presets.status === 'error') formations = <SectionError message="Could not load the formations." onRetry={onRetryPresets} />;
    else
      formations = (
        <View style={styles.chips}>
          {presets.formations.map((f) => (
            <Chip
              key={f}
              label={f}
              tabular
              selected={f === formation}
              onPress={() => {
                setFormation(f);
                setDraft((d) => lineupDraft(f, d));
              }}
              testID={`formation-${f}`}
            />
          ))}
        </View>
      );

    let squad: React.ReactNode;
    let names: Record<string, string | null> = {};
    if (!roster || roster.status === 'loading') {
      squad = (
        <View testID="lineup-roster-skeleton">
          <SkeletonText lines={2} />
        </View>
      );
    } else if (roster.status === 'error') {
      squad = <SectionError message="Could not load the squad." onRetry={onRetryRoster} />;
    } else {
      const players = sidePlayers(roster.roster, side);
      const byId = new Map(players.map((p) => [p.id, p.name]));
      names = Object.fromEntries(Object.entries(draft).map(([k, id]) => [k, id ? (byId.get(id) ?? null) : null]));
      const pickedName = selected ? byId.get(selected) : null;
      squad = (
        <View style={styles.stack}>
          <Text variant="callout" tone="inkMuted">
            {pickedName ? `Now tap a position for ${pickedName}.` : 'Tap a player, then tap a position.'}
          </Text>
          <View style={styles.chips} testID="lineup-squad">
            {players.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                selected={selected === p.id}
                onPress={() => setSelected(selected === p.id ? null : p.id)}
                testID={`squad-${p.id}`}
              />
            ))}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.stack} testID="lineup-editor">
        {sideSwitch}
        {formations}
        {formation ? (
          <Pitch
            formation={formation}
            names={names}
            editable
            placing={selected !== null}
            onPressPosition={(key) => {
              if (selected) {
                setDraft((d) => placePlayer(d, key, selected));
                setSelected(null);
              } else if (draft[key]) {
                setDraft((d) => clearPosition(d, key));
              }
            }}
            testID="lineup-pitch"
          />
        ) : null}
        {squad}
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button
          label="Save lineup"
          onPress={save}
          loading={saving}
          disabled={!formation || roster?.status !== 'ready'}
          fullWidth
          testID="save-lineup"
        />
        <Button label="Cancel" variant="plain" onPress={stopEditing} />
      </View>
    );
  }

  const savedNames: Record<string, string> = {};
  for (const p of page.lineups.find((l) => l.side === side)?.positions ?? []) savedNames[p.key] = playerName(p);

  return (
    <View style={styles.stack} testID="lineup">
      {sideSwitch}
      {saved ? (
        <>
          <Text variant="callout" tone="inkMuted" tabular>{`Formation ${saved.formation}`}</Text>
          <Pitch formation={saved.formation} names={savedNames} testID="lineup-pitch" />
        </>
      ) : (
        <EmptyState icon="person.2.fill" message="No lineup set yet." />
      )}
      {canEdit ? (
        <>
          <Button label={saved ? 'Edit lineup' : 'Set lineup'} variant="secondary" onPress={startEditing} testID="edit-lineup" />
          <Text variant="caption" tone="inkMuted">
            Lineups lock at kickoff.
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
