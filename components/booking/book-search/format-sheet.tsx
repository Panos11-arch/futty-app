// The Format chip's sheet: one format; picking one closes it.
import { ChoiceRow } from '@/components/booking/book-search/choice-row';
import { Sheet } from '@/components/ui';
import { PITCH_FORMATS } from '@/lib/booking';

export type FormatSheetProps = {
  visible: boolean;
  onClose: () => void;
  value: string;
  onPick: (format: string) => void;
};

export function FormatSheet({ visible, onClose, value, onPick }: FormatSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Format">
      {PITCH_FORMATS.map((f) => (
        <ChoiceRow key={f} testID={`book-format-${f}`} kind="radio" title={f} checked={f === value} onPress={() => onPick(f)} />
      ))}
    </Sheet>
  );
}
