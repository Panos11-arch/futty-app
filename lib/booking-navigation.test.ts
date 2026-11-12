import { afterPayment, bookingDetailHref, linkedBookingId, openBookingDetail } from './booking-navigation';

function nav() {
  return { push: jest.fn(), replace: jest.fn() };
}

describe('booking navigation', () => {
  it('a booking’s detail is /booking/{id}', () => {
    expect(bookingDetailHref('b1')).toEqual({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('paying (checkout or Pay my share) replaces the payment screen with /booking/{id}', () => {
    const n = nav();
    afterPayment('b1', n);
    expect(n.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
    expect(n.push).not.toHaveBeenCalled();
  });

  it('paid without a booking id: My Bookings', () => {
    const n = nav();
    afterPayment(null, n);
    expect(n.replace).toHaveBeenCalledWith('/my-bookings');
  });

  it('opening a booking pushes its detail', () => {
    const n = nav();
    openBookingDetail('b2', n);
    expect(n.push).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b2' } });
  });

  it('?booking= gives one id or none', () => {
    expect(linkedBookingId('b3')).toBe('b3');
    expect(linkedBookingId(['b4', 'b5'])).toBe('b4');
    expect(linkedBookingId('')).toBeNull();
    expect(linkedBookingId(undefined)).toBeNull();
  });
});
