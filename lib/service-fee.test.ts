import { formatEuros } from './service-fee';

describe('formatEuros', () => {
  it.each([
    [680, '€6.80'],
    [5, '€0.05'],
    [0, '€0.00'],
  ])('%i cents -> %s', (cents, expected) => {
    expect(formatEuros(cents)).toBe(expected);
  });
});
