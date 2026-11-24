import { fireEvent, render, screen } from '@testing-library/react-native';

import { ContactForm } from '@/components/venue/contact-view';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));

describe('ContactForm (S5: the venue page\'s Call and Website)', () => {
  it('shows what\'s saved, and saves what staff type; the server\'s version is shown back', async () => {
    const onSave = jest.fn().mockResolvedValue({ saved: { phone: '+357 25 123456', website: 'https://arena.example.com' }, error: null });
    await render(<ContactForm initial={{ phone: '+357 25 000000', website: null }} onSave={onSave} />);
    expect(screen.getByTestId('venue-contact-phone').props.value).toBe('+357 25 000000');
    expect(screen.getByTestId('venue-contact-website').props.value).toBe('');
    await fireEvent.changeText(screen.getByTestId('venue-contact-phone'), '+357 25 123456');
    await fireEvent.changeText(screen.getByTestId('venue-contact-website'), 'arena.example.com');
    await fireEvent.press(screen.getByTestId('venue-contact-save'));
    expect(onSave).toHaveBeenCalledWith('+357 25 123456', 'arena.example.com');
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByTestId('venue-contact-website').props.value).toBe('https://arena.example.com');
  });

  it('a refusal is shown in words, and nothing is lost', async () => {
    const onSave = jest.fn().mockResolvedValue({ saved: null, error: 'Check the phone number and try again.' });
    await render(<ContactForm initial={{ phone: null, website: null }} onSave={onSave} />);
    await fireEvent.changeText(screen.getByTestId('venue-contact-phone'), 'abc');
    await fireEvent.press(screen.getByTestId('venue-contact-save'));
    expect(await screen.findByText('Check the phone number and try again.')).toBeTruthy();
    expect(screen.getByTestId('venue-contact-phone').props.value).toBe('abc');
  });
});
