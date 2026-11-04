// RETIRED. This was the original "charge the whole booking at once" flow,
// from before per-player split payments. Nothing in the app calls it any
// more (bookings now go through create-share-payment, which only places a
// card hold), but while deployed it could still be called directly to
// charge a booker the full amount outside the split-payment rules.
//
// It now refuses every request. Once this version is deployed you can also
// delete it entirely:
//   supabase functions delete create-booking-payment

Deno.serve(() =>
  new Response(JSON.stringify({ error: 'This payment flow has been retired — please update the app.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })
);
