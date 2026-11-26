import { render, screen } from '@testing-library/react-native';

import { firstName, HomeGreeting, homeGreeting } from '@/components/home/home-greeting';

let mockProfile: { status: string; profile?: { full_name: string | null } } = { status: 'loading' };
jest.mock('@/lib/use-profile', () => ({ useProfile: () => mockProfile }));

describe('Home greeting (image 01)', () => {
  it('firstName takes the first word of the full name', () => {
    expect(firstName('Panos Alepis')).toBe('Panos');
    expect(firstName('  Maria  ')).toBe('Maria');
    expect(firstName('')).toBeNull();
    expect(firstName('   ')).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });

  it('the agreed words, with or without a name', () => {
    expect(homeGreeting('Panos')).toBe('Ready for your next game, Panos?');
    expect(homeGreeting(null)).toBe('Ready for your next game?');
  });

  it('greets by first name once the profile is here', async () => {
    mockProfile = { status: 'ready', profile: { full_name: 'Panos Alepis' } };
    await render(<HomeGreeting />);
    expect(screen.getByRole('header', { name: 'Ready for your next game, Panos?' })).toBeTruthy();
  });

  it('while loading, or with no name: no name', async () => {
    mockProfile = { status: 'loading' };
    await render(<HomeGreeting />);
    expect(screen.getByTestId('home-greeting')).toHaveTextContent('Ready for your next game?');
    mockProfile = { status: 'ready', profile: { full_name: null } };
    await render(<HomeGreeting />);
    expect(screen.getByTestId('home-greeting')).toHaveTextContent('Ready for your next game?');
  });
});
