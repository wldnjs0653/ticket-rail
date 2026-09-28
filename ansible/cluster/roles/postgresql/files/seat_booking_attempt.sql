BEGIN;
WITH target AS MATERIALIZED (
  SELECT s.id seat_id,s.event_id,s.price,u.id user_id FROM seats s
  JOIN events e ON e.id=s.event_id CROSS JOIN users u
  WHERE e.title='__PG_CONCURRENCY_TEST__' AND s.seat_no='TEST-A1'
    AND u.email='pg-concurrency-test@local.invalid'
), claimed AS (
  UPDATE seats s SET status='BOOKED',booked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
  FROM target t WHERE s.id=t.seat_id AND s.event_id=t.event_id AND s.status='AVAILABLE'
  RETURNING s.id seat_id,s.event_id,s.price,t.user_id
), delayed AS MATERIALIZED (
  SELECT c.*,pg_sleep(1) FROM claimed c
), new_booking AS (
  INSERT INTO bookings(user_id,event_id,status,total_amount)
  SELECT user_id,event_id,'CONFIRMED',price FROM delayed RETURNING id,event_id
)
INSERT INTO booking_seats(booking_id,seat_id,price)
SELECT b.id,c.seat_id,c.price FROM new_booking b JOIN claimed c ON c.event_id=b.event_id;
COMMIT;
