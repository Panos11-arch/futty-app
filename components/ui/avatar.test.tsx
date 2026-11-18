import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { Avatar, initials } from '@/components/ui/avatar';
import { flatStyle, loadWithFile } from '@/components/ui/test-utils';
import { colors, kitColours } from '@/constants/futty-theme';
import { avatarKit } from '@/lib/avatar';

// The shirt's <Svg> and <Path> as plain views that keep the props they were
// drawn with, so the test reads the fill and outline as the avatar set them.
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: (props: object) => React.createElement(View, props),
    Path: (props: object) => React.createElement(View, props),
  };
});

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

describe('Avatar with a kit (A12)', () => {
  it('draws the kit shirt with the number instead of initials', async () => {
    await render(<Avatar name="Eleni Kyriakou" kit={{ colour: 'kitRed', number: 10 }} />);
    expect(screen.getByTestId('avatar-kit')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.queryByText('EK')).toBeNull();
    expect(screen.getByLabelText('Eleni Kyriakou, shirt 10')).toBeTruthy();
  });

  it('fills the shirt with the kit token and the number with its label colour', async () => {
    await render(<Avatar name="Eleni Kyriakou" kit={{ colour: 'kitYellow', number: 7 }} />);
    expect(screen.getByTestId('avatar-kit-shirt').props.fill).toBe(kitColours.kitYellow.shirt);
    expect(flatStyle(screen.getByText('7')).color).toBe(kitColours.kitYellow.label);
  });

  it('outlines the white shirt so it shows on a light background', async () => {
    await render(<Avatar name="Eleni Kyriakou" kit={{ colour: 'kitWhite', number: 1 }} />);
    expect(screen.getByTestId('avatar-kit-shirt').props.stroke).toBe(colors.border);
  });

  it('shows initials when there is no kit', async () => {
    await render(<Avatar name="Eleni Kyriakou" kit={null} />);
    expect(screen.getByText('EK')).toBeTruthy();
    expect(screen.queryByTestId('avatar-kit')).toBeNull();
  });
});

describe('avatarKit', () => {
  it('reads a kit row', () => {
    expect(avatarKit({ avatar_style: 'kit', avatar_kit_colour: 'kitBlue', avatar_number: 9 })).toEqual({
      colour: 'kitBlue',
      number: 9,
    });
  });

  it.each([
    [{ avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null }],
    [{ avatar_style: 'kit', avatar_kit_colour: null, avatar_number: 9 }],
    [{ avatar_style: 'kit', avatar_kit_colour: 'kitBlue', avatar_number: null }],
    [{ avatar_style: 'kit', avatar_kit_colour: 'kitPurple', avatar_number: 9 }],
    [{ avatar_style: 'kit', avatar_kit_colour: 'kitBlue', avatar_number: 100 }],
    [{}],
    [null],
  ])('falls back to initials for %j', (row) => {
    expect(avatarKit(row)).toBeNull();
  });
});
