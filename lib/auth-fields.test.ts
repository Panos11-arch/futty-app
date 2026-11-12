import { emailError, passwordError, usernameError } from '@/lib/auth-fields';

describe('auth field errors', () => {
  it.each([
    ['', 'Enter your email.'],
    ['   ', 'Enter your email.'],
    ['anghelo', 'Enter a valid email address.'],
    ['anghelo@futty', 'Enter a valid email address.'],
    ['a b@futty.cy', 'Enter a valid email address.'],
    [' player@futty.cy ', null],
  ])('email %p', (value, error) => {
    expect(emailError(value)).toBe(error);
  });

  it.each([
    ['', 'Enter a username.'],
    ['ab', 'Usernames are 3–24 characters, letters, numbers and underscores only.'],
    ['bad name', 'Usernames are 3–24 characters, letters, numbers and underscores only.'],
    ['good_name1', null],
  ])('username %p', (value, error) => {
    expect(usernameError(value)).toBe(error);
  });

  it('password: required, and the length rule only for a new one', () => {
    expect(passwordError('', { isNew: false })).toBe('Enter your password.');
    expect(passwordError('short', { isNew: false })).toBeNull();
    expect(passwordError('', { isNew: true })).toBe('Choose a password.');
    expect(passwordError('short', { isNew: true })).toBe('Password must be at least 8 characters.');
    expect(passwordError('long enough', { isNew: true })).toBeNull();
  });
});
