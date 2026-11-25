// S7: what the + button opens: New post (squad posts are made from a
// booking, so this opens My bookings) and New team.
import { router } from 'expo-router';

import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';

export function NewSheet({
  visible,
  onClose,
  onNewTeam,
}: {
  visible: boolean;
  onClose: () => void;
  onNewTeam: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Create">
      <Card padded={false}>
        <ListRow
          testID="community-new-post"
          title="New post"
          leading={{ icon: 'bubble.left.fill' }}
          chevron
          onPress={() => {
            onClose();
            router.push('/my-bookings');
          }}
        />
        <ListRow
          testID="community-new-team"
          title="New team"
          leading={{ icon: 'person.2.fill' }}
          chevron
          onPress={() => {
            onClose();
            onNewTeam();
          }}
        />
      </Card>
    </Sheet>
  );
}
