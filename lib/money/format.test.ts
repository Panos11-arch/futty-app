import { describeSharePayment, formatEuros, formatEurosPlain, parseEurosInput } from './format';

// What staff type as a walk-in's price (docs/specs/13-payments-bookings.md
// "Venue dashboard"): read as whole cents from the digits, never through a
// floating-point number.
describe('parseEurosInput', () => {
  it.each([
    ['50', 5000],
    ['6.5', 650],
    ['6.50', 650],
    ['6,50', 650],
    ['€45', 4500],
    ['€ 45.00', 4500],
    ['  40.10 ', 4010],
    ['0', 0],
    ['0.05', 5],
    ['0.29', 29],
    ['1.13', 113],
    ['99999.99', 9999999],
  ])('%s is %i cents', (text, cents) => {
    expect(parseEurosInput(text)).toBe(cents);
  });

  it.each(['', '   ', 'abc', '6.505', '-5', '6..5', '6.', '.5', '1 000', '100000', '6€'])(
    '%s is not an amount',
    (text) => {
      expect(parseEurosInput(text)).toBeNull();
    },
  );
});

describe('formatEurosPlain', () => {
  it.each([
    [680, '6.80'],
    [6550, '65.50'],
    [5, '0.05'],
    [0, '0.00'],
    [-600, '-6.00'],
    [-5, '-0.05'],
    [123456, '1234.56'],
  ])('%i cents is %s', (cents, text) => {
    expect(formatEurosPlain(cents)).toBe(text);
  });

  it('only takes whole cents', () => {
    expect(() => formatEurosPlain(0.5)).toThrow('formatEurosPlain takes integer cents');
  });
});

describe('formatEuros', () => {
  it.each([
    [680, '€6.80'],
    [691, '€6.91'],
    [6550, '€65.50'],
    [6495, '€64.95'],
    [80, '€0.80'],
    [5, '€0.05'],
    [0, '€0.00'],
    [-100, '-€1.00'],
  ])('%i cents is %s', (cents, text) => {
    expect(formatEuros(cents)).toBe(text);
  });

  it('only takes whole cents', () => {
    expect(() => formatEuros(6.8)).toThrow('formatEuros takes integer cents');
    expect(() => formatEuros(Number.NaN)).toThrow('formatEuros takes integer cents');
  });
});

describe('describeSharePayment', () => {
  it('a card share', () => {
    expect(describeSharePayment({ amountCents: 680, cashCents: 0 })).toEqual({ byCard: '€6.80', inCash: null });
  });

  it('a cash player pays the fee by card and the rest at the venue', () => {
    expect(describeSharePayment({ amountCents: 80, cashCents: 600 })).toEqual({ byCard: '€0.80', inCash: '€6.00' });
  });

  it('a Premium cash player pays nothing by card', () => {
    expect(describeSharePayment({ amountCents: 0, cashCents: 600 })).toEqual({ byCard: null, inCash: '€6.00' });
  });
});
