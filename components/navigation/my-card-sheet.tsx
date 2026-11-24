import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';

/**
 * What the Card button opens until S19 builds the player card (image 20):
 * one line and one button.
 */
export function MyCardSheet({
  visible,
  onClose,
  onOpenProfile,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="My card"
      primaryAction={{
        label: 'Open profile',
        testID: 'my-card-open-profile',
        onPress: () => {
          onClose();
          onOpenProfile();
        },
      }}>
      <Text variant="body" tone="inkMuted" testID="my-card-sheet">
        Coming soon
      </Text>
    </Sheet>
  );
}
