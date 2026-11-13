import { checkoutCancellationLines } from '@/components/booking/checkout-parts';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('checkoutCancellationLines', () => {
  it('spec 13 terms: the free window ends at whichever comes first, €1 per player, cash risks only the fee', () => {
    expect(checkoutCancellationLines({ fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 })).toEqual([
      'Cancel for a full refund until 1 hour after paying or 6 hours before kickoff, whichever comes first.',
      'After that, until 6 hours before kickoff, €1.00 is kept for each player paid for and the rest becomes credit at this venue. Paying the pitch in cash, only the service fee is at stake.',
      'Less than 6 hours before kickoff, there are no refunds.',
    ]);
  });

  it('uses the server’s numbers, not the app’s', () => {
    const [free, kept, late] = checkoutCancellationLines({ fee_cents: 150, free_minutes: 90, refund_cutoff_hours: 1 });
    expect(free).toBe('Cancel for a full refund until 90 minutes after paying or 1 hour before kickoff, whichever comes first.');
    expect(kept).toMatch(/^After that, until 1 hour before kickoff, €1\.50 is kept for each player paid for/);
    expect(late).toBe('Less than 1 hour before kickoff, there are no refunds.');
  });

  it('never promises a full hour regardless of kickoff, or a single €1 for the whole booking', () => {
    const lines = checkoutCancellationLines({ fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 }).join(' ');
    expect(lines).not.toMatch(/if you booked more than/);
    expect(lines).not.toMatch(/€1\.00 is kept and/);
  });
});
