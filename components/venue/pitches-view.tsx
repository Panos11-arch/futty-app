// Pitches and combinations (P6e; spec 13 "Venue setup"; spec 05 section 12,
// item 2): every pitch, closed ones too; tap one to edit, open or close, or
// delete it. Below, which pitches combine for a format, each removed with
// one tap (games already booked keep their own pitches).
import { useState } from 'react';

import { Banner, EmptyState, IconButton, ListRow, SectionHeader, Text } from '@/components/ui';
import { CombinationSheet } from '@/components/venue/combination-sheet';
import { PitchSheet } from '@/components/venue/pitch-sheet';
import { SetupFrame } from '@/components/venue/setup-parts';
import { useVenueSetup } from '@/lib/use-venue-setup';
import {
  addPitchCombination,
  deletePitch,
  removePitchCombination,
  savePitch,
  setPitchOpen,
  type Combination,
  type SetupPitch,
} from '@/lib/venue-setup';

function pitchLine(p: SetupPitch): string {
  const plays = p.formats.length === 1 && p.formats[0] === p.size ? null : `takes ${p.formats.join(', ')}`;
  return [p.is_open ? null : 'Closed', p.size, plays, p.surface, p.indoor ? 'Indoor' : 'Outdoor']
    .filter(Boolean)
    .join(' · ');
}

function combinationTitle(c: Combination, pitches: SetupPitch[]): string {
  const names = c.pitch_ids.map((id) => pitches.find((p) => p.id === id)?.name ?? 'a removed pitch');
  return `${c.format}: ${names.join(' + ')}`;
}

export function PitchesView({ venueId }: { venueId: string }) {
  const { state, write, retry } = useVenueSetup(venueId);
  /** The pitch open in the sheet: 'new' to add one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [addingCombination, setAddingCombination] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function removeCombination(id: string) {
    setBusy(id);
    setNotice(null);
    const refusal = await write(removePitchCombination(id));
    setBusy(null);
    if (refusal) setNotice(refusal);
  }

  return (
    <SetupFrame state={state} retry={retry}>
      {(setup) => {
        const pitch = editing && editing !== 'new' ? (setup.pitches.find((p) => p.id === editing) ?? null) : null;
        return (
          <>
            <SectionHeader title="Pitches" action={{ label: 'Add pitch', onPress: () => setEditing('new') }} />
            {setup.pitches.length === 0 ? (
              <EmptyState icon="sportscourt.fill" message="No pitches yet. Add your first pitch." />
            ) : null}
            {setup.pitches.map((p) => (
              <ListRow
                key={p.id}
                testID={`pitch-${p.id}`}
                title={p.name}
                subtitle={pitchLine(p)}
                leading={{ icon: 'sportscourt.fill' }}
                chevron
                onPress={() => setEditing(p.id)}
              />
            ))}

            <SectionHeader
              title="Combinations"
              action={{ label: 'Add combination', onPress: () => setAddingCombination(true) }}
            />
            <Text variant="callout" tone="inkMuted">
              Pitches that join up for a bigger game.
            </Text>
            {notice ? <Banner tone="danger" message={notice} /> : null}
            {setup.combinations.map((c) => {
              const title = combinationTitle(c, setup.pitches);
              return (
                <ListRow
                  key={c.id}
                  title={title}
                  trailing={
                    <IconButton
                      icon="trash.fill"
                      tone="danger"
                      accessibilityLabel={`Remove combination ${title}`}
                      disabled={busy === c.id}
                      onPress={() => removeCombination(c.id)}
                    />
                  }
                />
              );
            })}

            {editing !== null && (editing === 'new' || pitch) ? (
              <PitchSheet
                key={editing}
                pitch={pitch}
                onClose={() => setEditing(null)}
                onSave={(input) => write(savePitch(venueId, pitch?.id ?? null, input))}
                onSetOpen={(open) => write(setPitchOpen(pitch!.id, open))}
                onDelete={() => write(deletePitch(pitch!.id))}
              />
            ) : null}
            {addingCombination ? (
              <CombinationSheet
                pitches={setup.pitches}
                onClose={() => setAddingCombination(false)}
                onAdd={(format, ids) => write(addPitchCombination(venueId, format, ids))}
              />
            ) : null}
          </>
        );
      }}
    </SetupFrame>
  );
}
