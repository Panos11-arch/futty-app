// Adding or editing a pitch (P6e; spec 13 "Venue setup"; spec 05 section 12,
// item 2). What the server would refuse is greyed out from venue_setup's
// flags: size and formats while the pitch holds a game that hasn't ended
// (sent as null, which keeps them), and Delete once it has held any game.
// Closing a pitch with games to come tells their players, so it asks first;
// deleting asks first too.
import { useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { Button, Chip, SegmentedControl, Sheet, Text, TextField } from '@/components/ui';
import { ChipRow, ConfirmStep, setupStyles } from '@/components/venue/setup-parts';
import { describeSetupError, FORMATS, type PitchInput, type SetupPitch } from '@/lib/venue-setup';

type Refusal = Promise<string | null>;

export function PitchSheet({
  pitch,
  onClose,
  onSave,
  onSetOpen,
  onDelete,
}: {
  /** Null for a new pitch. */
  pitch: SetupPitch | null;
  onClose: () => void;
  /** Each: null when done, or the server's refusal in words. */
  onSave: (input: PitchInput) => Refusal;
  onSetOpen: (open: boolean) => Refusal;
  onDelete: () => Refusal;
}) {
  const { height } = useWindowDimensions();
  const [name, setName] = useState(pitch?.name ?? '');
  const [size, setSize] = useState<string>(pitch?.size ?? FORMATS[0]);
  const [formats, setFormats] = useState<string[]>(pitch?.formats ?? [FORMATS[0]]);
  const [surface, setSurface] = useState(pitch?.surface ?? '');
  const [indoor, setIndoor] = useState(pitch?.indoor ?? false);
  const [description, setDescription] = useState(pitch?.description ?? '');
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null);
  const [busy, setBusy] = useState<'save' | 'open' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locked = pitch?.has_future_bookings ?? false;

  function toggleFormat(f: string) {
    setFormats((list) => (list.includes(f) ? list.filter((x) => x !== f) : FORMATS.filter((x) => x === f || list.includes(x))));
  }

  async function run(kind: 'save' | 'open' | 'delete', action: () => Refusal) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const refusal = await action();
    setBusy(null);
    setConfirm(null);
    if (refusal) setError(refusal);
    else onClose();
  }

  const save = () =>
    run('save', () =>
      onSave({
        name,
        size: locked ? null : size,
        formats: locked ? null : formats,
        surface,
        indoor,
        description,
      }),
    );

  function close() {
    if (pitch?.has_future_bookings && confirm !== 'close') {
      setConfirm('close');
      return;
    }
    run('open', () => onSetOpen(false));
  }

  return (
    <Sheet visible onClose={onClose} title={pitch ? pitch.name : 'Add pitch'}>
      <ScrollView
        style={{ maxHeight: height * 0.75 }}
        contentContainerStyle={setupStyles.sheet}
        keyboardShouldPersistTaps="handled">
        <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Text variant="callout">Size</Text>
        <ChipRow>
          {FORMATS.map((f) => (
            <Chip key={f} testID={`size-${f}`} label={f} selected={f === size} disabled={locked} onPress={() => setSize(f)} />
          ))}
        </ChipRow>
        <Text variant="callout">Games it takes</Text>
        <ChipRow>
          {FORMATS.map((f) => (
            <Chip
              key={f}
              testID={`format-${f}`}
              label={f}
              selected={formats.includes(f)}
              disabled={locked}
              onPress={() => toggleFormat(f)}
            />
          ))}
        </ChipRow>
        {locked ? (
          <Text variant="caption" tone="inkMuted">
            {describeSetupError('pitch_has_future_bookings')}
          </Text>
        ) : null}
        <TextField label="Surface" helper="Optional, like 3G or grass." value={surface} onChangeText={setSurface} />
        <SegmentedControl
          accessibilityLabel="Indoor or outdoor"
          options={[
            { value: 'outdoor', label: 'Outdoor' },
            { value: 'indoor', label: 'Indoor' },
          ]}
          value={indoor ? 'indoor' : 'outdoor'}
          onChange={(value) => setIndoor(value === 'indoor')}
        />
        <TextField label="Description" helper="Optional." value={description} onChangeText={setDescription} multiline />
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        {confirm === 'close' && pitch ? (
          <ConfirmStep
            message={`${pitch.name} has games still to come. They stay on, and their players will be told you’ve closed new bookings.`}
            confirmLabel="Yes, close pitch"
            busy={busy === 'open'}
            onConfirm={close}
            onBack={() => setConfirm(null)}
          />
        ) : null}
        {confirm === 'delete' && pitch ? (
          <ConfirmStep
            message={`Delete ${pitch.name}? Any combination it is part of is removed too.`}
            confirmLabel="Yes, delete"
            busy={busy === 'delete'}
            onConfirm={() => run('delete', onDelete)}
            onBack={() => setConfirm(null)}
          />
        ) : null}

        {confirm === null ? (
          <>
            <Button label="Save pitch" loading={busy === 'save'} disabled={busy !== null} onPress={save} />
            {pitch ? (
              <>
                {pitch.is_open ? (
                  <Button label="Close pitch" variant="secondary" loading={busy === 'open'} disabled={busy !== null} onPress={close} />
                ) : (
                  <Button
                    label="Open pitch"
                    variant="secondary"
                    loading={busy === 'open'}
                    disabled={busy !== null}
                    onPress={() => run('open', () => onSetOpen(true))}
                  />
                )}
                <Text variant="caption" tone="inkMuted">
                  {pitch.is_open
                    ? 'A closed pitch takes no new bookings, alone or combined. Games already on it stay on.'
                    : 'This pitch is closed: it takes no new bookings.'}
                </Text>
                <Button
                  testID="pitch-delete"
                  label="Delete pitch"
                  variant="destructive"
                  disabled={pitch.has_bookings || busy !== null}
                  onPress={() => setConfirm('delete')}
                />
                {pitch.has_bookings ? (
                  <Text variant="caption" tone="inkMuted">
                    {describeSetupError('pitch_has_bookings')}
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
