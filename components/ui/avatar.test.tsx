import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { Avatar, initials } from '@/components/ui/avatar';
import { loadWithFile } from '@/components/ui/test-utils';

loadWithFile(Image);

describe('initials', () => {
  it.each([
    ['Andreas Georgiou', 'AG'],
    ['nicosia five a side arena', 'NF'],
    ['Marios', 'M'],
    ['  ', ''],
  ])('%s -> %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('Avatar', () => {
  it('shows initials without a photo', async () => {
    await render(<Avatar name="Eleni Kyriakou" />);
    expect(screen.getByText('EK')).toBeTruthy();
    expect(screen.getByLabelText('Eleni Kyriakou')).toBeTruthy();
  });

  it('shows the photo when there is one', async () => {
    await render(<Avatar name="Eleni Kyriakou" photoUrl="https://example.com/e.jpg" />);
    expect(screen.queryByText('EK')).toBeNull();
    expect(screen.getByTestId('avatar-photo')).toBeTruthy();
  });
});
