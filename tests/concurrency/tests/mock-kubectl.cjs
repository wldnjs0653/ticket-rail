#!/usr/bin/env node
// Local verification double only. Never contacts Kubernetes or a database.
const fs = require('fs');
if (!process.env.CONCURRENCY_TEST_MODE) process.exit(78);
const args = process.argv.slice(2);
if (args.includes('version')) { console.log('mock kubectl'); process.exit(0); }
if (args.includes('get')) { console.log('mock-primary-1'); process.exit(0); }
const sql = fs.readFileSync(0, 'utf8');
if (!sql.includes('READ ONLY') || /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(sql)) process.exit(79);
if (!sql.includes('WITH b AS')) {
  console.log(JSON.stringify({ seats: [{ id: 9, event_id: 1, status:
    process.env.CONCURRENCY_TEST_MODE === 'used-seat' ? 'BOOKED' : 'AVAILABLE' }], seat_link_count: 0 }));
} else {
  const bookingId = Number(sql.match(/FROM public\.booking WHERE id=(\d+)/)[1]);
  const userId = Number(sql.match(/WHERE user_id=(\d+)/)[1]);
  console.log(JSON.stringify({ ok: process.env.CONCURRENCY_TEST_MODE !== 'db-pending',
    bookings: [{ id: bookingId, user_id: userId, event_id: 1, status: 'CONFIRMED' }],
    booking_seats: [{ booking_id: bookingId, seat_id: 9 }], seat_link_count: 1,
    seats: [{ id: 9, event_id: 1, status: 'BOOKED' }],
    payments: [{ id: 701, booking_id: bookingId, status: process.env.CONCURRENCY_TEST_MODE === 'db-pending' ? 'PENDING' : 'APPROVED',
      amount: 83700, processed_at: process.env.CONCURRENCY_TEST_MODE === 'db-pending' ? null : '2026-09-15T00:00:00Z' }] }));
}
