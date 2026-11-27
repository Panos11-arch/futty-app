// G4a tests: every testID on screen, in the order a player sees them, to
// check where a banner ad sits. Not a test file.
import { screen } from '@testing-library/react-native';

type Node = { props?: { testID?: string }; children?: unknown[] | null };

export function testIdsInOrder(): string[] {
  const ids: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as Node;
    if (n.props?.testID) ids.push(n.props.testID);
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return ids;
}

/** The marker the screen tests swap in for the shared AdBanner. */
export function adBannerMarker() {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { AdBanner: ({ testID }: { testID: string }) => createElement(View, { testID }) };
}
