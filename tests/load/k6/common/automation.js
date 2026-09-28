export function recordBooking(bookingId, eventId, seatId, userId) {
  if (!/^[1-9][0-9]*$/.test(String(bookingId))) return;
  console.log(JSON.stringify({type: 'booking_result', booking_id: String(bookingId), event_id: String(eventId), seat_id: String(seatId)}));
}
