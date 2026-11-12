// Follow a team or player (05 section 2: followers of a team get "X play Y
// tonight", results and "X want an opponent"). Writes the signed-in
// player's own user_follows row through lib/use-follows.ts.
import { Button } from '@/components/ui/button';
import type { FollowTarget } from '@/lib/community';
import { useFollows } from '@/lib/use-follows';

export type FollowButtonProps = {
  targetType: FollowTarget;
  targetId: string;
  /** Spoken with the action, e.g. the team name. */
  name: string;
  /** For a screen that already holds useFollows(); otherwise the button loads its own. */
  follows?: ReturnType<typeof useFollows>;
};

export function FollowButton({ follows, ...props }: FollowButtonProps) {
  return follows ? <FollowButtonView follows={follows} {...props} /> : <OwnFollowButton {...props} />;
}

function OwnFollowButton(props: Omit<FollowButtonProps, 'follows'>) {
  const follows = useFollows();
  return <FollowButtonView follows={follows} {...props} />;
}

function FollowButtonView({
  follows,
  targetType,
  targetId,
  name,
}: Omit<FollowButtonProps, 'follows'> & { follows: ReturnType<typeof useFollows> }) {
  const following = follows.isFollowing(targetType, targetId);
  return (
    <Button
      testID="follow-button"
      label={following ? 'Following' : 'Follow'}
      variant={following ? 'secondary' : 'primary'}
      disabled={follows.status !== 'ready'}
      accessibilityHint={following ? `Stops notifications about ${name}` : `Get notifications about ${name}`}
      onPress={() => {
        follows.toggle(targetType, targetId);
      }}
    />
  );
}
