import glyphMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json';

import { ICON_NAMES, materialIconFor } from './icon-mapping';

describe('IconSymbol mapping', () => {
  it('maps every SF Symbol name to a Material icon that exists', () => {
    const missing = ICON_NAMES.filter((name) => !(materialIconFor(name) in glyphMap));
    expect(missing).toEqual([]);
  });

  it('has the venue page amenity and directions icons', () => {
    expect(ICON_NAMES).toEqual(
      expect.arrayContaining([
        'car.fill',
        'door.left.hand.closed',
        'shower.fill',
        'lock.rectangle.stack.fill',
        'cup.and.saucer.fill',
        'lightbulb.fill',
        'tshirt.fill',
        'soccerball',
        'cross.case.fill',
        'wifi',
        'arrow.triangle.turn.up.right.diamond.fill',
        'map.fill',
      ]),
    );
  });
});
