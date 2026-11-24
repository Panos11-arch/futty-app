import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { loadWithFile } from '@/components/ui/test-utils';
import { AmenityIcons, FoodCards } from '@/components/venue/venue-extras';
import type { FoodCard } from '@/lib/venue-extras';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
loadWithFile(Image);

describe('AmenityIcons', () => {
  it('each amenity\'s own icon, read aloud by name; at most `max`, food and drink first', async () => {
    await render(<AmenityIcons testID="row" amenities={[{ kind: 'wifi' }, { kind: 'parking' }, { kind: 'restaurant' }]} max={2} />);
    const row = within(screen.getByTestId('row'));
    expect(row.getByTestId('icon-fork.knife')).toBeTruthy();
    expect(row.getByTestId('icon-car.fill')).toBeTruthy();
    expect(row.queryByTestId('icon-wifi')).toBeNull();
    expect(screen.getByTestId('row').props.accessibilityLabel).toBe('Restaurant, Parking');
    expect(row.queryByText('Restaurant')).toBeNull();
  });

  it('with labels: a tiny label under each icon, and the note', async () => {
    await render(
      <AmenityIcons
        testID="row"
        labels
        amenities={[{ kind: 'vending_machines', note: 'Drinks' }, { kind: 'shop' }, { kind: 'other', note: 'Physio' }]}
      />,
    );
    expect(screen.getByText('Vending machines')).toBeTruthy();
    expect(screen.getByText('Drinks')).toBeTruthy();
    expect(screen.getByTestId('icon-bag.fill')).toBeTruthy();
    expect(screen.getByText('Physio')).toBeTruthy();
    expect(screen.getByLabelText('Vending machines, Drinks')).toBeTruthy();
  });

  it('nothing entered: nothing at all', async () => {
    await render(<AmenityIcons testID="row" amenities={[]} />);
    expect(screen.queryByTestId('row')).toBeNull();
  });
});

const food = (over: Partial<FoodCard>): FoodCard => ({
  id: 'f',
  name: 'Frappé',
  photoUrl: null,
  price: '€3.50',
  was: null,
  afterGame: false,
  ...over,
});

describe('FoodCards', () => {
  it('photo, name and price; an offer price with the normal one struck through and the After game tag', async () => {
    await render(
      <FoodCards
        testID="food"
        cards={[
          food({ id: 'a', photoUrl: 'https://p/a' }),
          food({ id: 'b', name: 'Keo beer', price: '€3.00', was: '€4.00', afterGame: true }),
        ]}
      />,
    );
    const a = within(screen.getByTestId('food-a'));
    expect(a.getByLabelText('Frappé')).toBeTruthy();
    expect(a.getByText('€3.50')).toBeTruthy();
    expect(a.queryByText('After game')).toBeNull();
    const b = within(screen.getByTestId('food-b'));
    expect(b.getByText('€3.00')).toBeTruthy();
    expect(b.getByLabelText('was €4.00')).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(b.getByText('After game')).toBeTruthy();
  });

  it('a tap opens the card, when the place allows it', async () => {
    const onPress = jest.fn();
    await render(<FoodCards testID="food" cards={[food({ id: 'a' })]} onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('food-a'));
    expect(onPress).toHaveBeenCalledWith('a');
  });

  it('no item without a price shows a price', async () => {
    await render(<FoodCards testID="food" cards={[food({ id: 'a', price: null })]} />);
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('no cards: nothing at all', async () => {
    await render(<FoodCards testID="food" cards={[]} />);
    expect(screen.queryByTestId('food')).toBeNull();
  });
});
