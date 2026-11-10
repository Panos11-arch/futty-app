import { fireEvent, render, screen } from '@testing-library/react-native';

import { flatStyle } from '@/components/ui/test-utils';
import { VenueCard } from '@/components/ui/venue-card';
import { colors } from '@/constants/futty-theme';

const venue = {
  name: 'Nicosia Five',
  area: 'Strovolos',
  pricePerPlayerCents: 680,
  nextTimes: ['18:00', '19:00', '20:30'],
};

describe('VenueCard', () => {
  it('shows initials on a neutral canvas block when there is no photo', async () => {
    await render(<VenueCard {...venue} onPress={() => {}} />);
    expect(screen.getByText('NF')).toBeTruthy();
    const placeholder = screen.getByTestId('venue-card-placeholder');
    expect(flatStyle(placeholder)).toMatchObject({ backgroundColor: colors.canvas, aspectRatio: 16 / 9 });
    expect(screen.queryByTestId('venue-card-photo')).toBeNull();
  });

  it('shows the photo, not initials, when there is one', async () => {
    await render(<VenueCard {...venue} photoUrl="https://example.com/v.jpg" onPress={() => {}} />);
    expect(screen.getByTestId('venue-card-photo')).toBeTruthy();
    expect(screen.queryByText('NF')).toBeNull();
  });

  it('shows name, area, the server price per player and the next free times', async () => {
    const onPress = jest.fn();
    const onTimePress = jest.fn();
    await render(<VenueCard {...venue} onPress={onPress} onTimePress={onTimePress} />);
    expect(screen.getByText('Nicosia Five')).toBeTruthy();
    expect(screen.getByText('Strovolos')).toBeTruthy();
    expect(screen.getByText('€6.80 per player')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '19:00' }));
    expect(onTimePress).toHaveBeenCalledWith('19:00');
    await fireEvent.press(screen.getByText('Nicosia Five'));
    expect(onPress).toHaveBeenCalled();
  });

  it('shows no time chips when none are free', async () => {
    await render(<VenueCard {...venue} nextTimes={[]} onPress={() => {}} />);
    expect(screen.queryByRole('button', { name: '18:00' })).toBeNull();
  });
});
