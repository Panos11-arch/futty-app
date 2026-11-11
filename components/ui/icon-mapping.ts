// SF Symbol names and their Material icon fallback on Android and web
// (icon-symbol.tsx). In its own file so tests read it on every platform.
import type MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { SymbolViewProps } from 'expo-symbols';
import type { ComponentProps } from 'react';

type IconMapping = Record<Extract<SymbolViewProps['name'], string>, ComponentProps<typeof MaterialIcons>['name']>;
export type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
export const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  calendar: 'event',
  'lock.fill': 'lock',
  'trophy.fill': 'emoji-events',
  'person.2.fill': 'group',
  'flag.fill': 'flag',
  'shield.fill': 'shield',
  globe: 'public',
  'person.fill': 'person',
  pencil: 'edit',
  'bell.fill': 'notifications',
  'phone.fill': 'phone',
  'star.fill': 'star',
  'mappin.and.ellipse': 'place',
  'bubble.left.fill': 'chat',
  xmark: 'close',
  'paperplane.circle.fill': 'send',
  'magnifyingglass': 'search',
  'clock.fill': 'access-time',
  'checkmark.circle.fill': 'check-circle',
  'circle': 'radio-button-unchecked',
  'wrench.fill': 'build',
  'cone.fill': 'construction',
  'sportscourt.fill': 'sports-soccer',
  'building.columns.fill': 'stadium',
  'building.2.fill': 'location-city',
  'list.clipboard.fill': 'assignment',
  'envelope.fill': 'mail',
  'key.fill': 'vpn-key',
  'sparkles': 'auto-awesome',
  'hand.wave.fill': 'front-hand',
  'rectangle.portrait.and.arrow.right': 'logout',
  'flag.checkered': 'flag-circle',
  'exclamationmark.triangle.fill': 'report',
  'arrow.right': 'arrow-forward',
  'chevron.left': 'chevron-left',
  'creditcard.fill': 'credit-card',
  'doc.text.fill': 'description',
  'lock.shield.fill': 'security',
  'questionmark.circle.fill': 'help',
  'info.circle.fill': 'info',
  'gearshape.fill': 'settings',
  'square.and.arrow.up': 'ios-share',
  'crown.fill': 'workspace-premium',
  'checkmark': 'check',
  'plus': 'add',
  'ellipsis': 'more-horiz',
  'person.crop.circle.badge.plus': 'person-add',
  'chevron.down': 'expand-more',
  'trash.fill': 'delete',
  'exclamationmark.circle.fill': 'error',
  'photo': 'image',
  // Venue page (P9): amenities and directions.
  'car.fill': 'local-parking',
  'door.left.hand.closed': 'meeting-room',
  'shower.fill': 'shower',
  'lock.rectangle.stack.fill': 'lock-outline',
  'cup.and.saucer.fill': 'local-cafe',
  'lightbulb.fill': 'lightbulb',
  'tshirt.fill': 'checkroom',
  'soccerball': 'sports-soccer',
  'cross.case.fill': 'medical-services',
  'wifi': 'wifi',
  'arrow.triangle.turn.up.right.diamond.fill': 'directions',
  'map.fill': 'map',
} as IconMapping;

/** Every icon name the app may use (for tests). */
export const ICON_NAMES = Object.keys(MAPPING) as IconSymbolName[];
/** The Material icon an SF Symbol name falls back to on Android and web. */
export function materialIconFor(name: IconSymbolName) {
  return MAPPING[name];
}

