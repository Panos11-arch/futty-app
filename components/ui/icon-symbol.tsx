// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<Extract<SymbolViewProps['name'], string>, ComponentProps<typeof MaterialIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
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
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
