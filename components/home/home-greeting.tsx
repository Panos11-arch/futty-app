// Home's greeting (image 01): "Ready for your next game, Panos?" with the
// player's first name from their profile, or without a name until there is one.
import { Text } from '@/components/ui/text';
import { useProfile } from '@/lib/use-profile';

/** The first word of the full name, or null. */
export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function homeGreeting(name: string | null): string {
  return name ? `Ready for your next game, ${name}?` : 'Ready for your next game?';
}

export function HomeGreeting() {
  const profile = useProfile();
  const name = profile.status === 'ready' ? firstName(profile.profile?.full_name) : null;
  return (
    <Text testID="home-greeting" variant="display" accessibilityRole="header">
      {homeGreeting(name)}
    </Text>
  );
}
