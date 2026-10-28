// 조회한 날짜에만 실제 열차 이벤트와 좌석을 생성한다.
// 기존 예약/좌석은 수정하거나 삭제하지 않으며, 일자별 생성은 DB 잠금으로 직렬화한다.
const schedules = require('./dailyTrainSchedules.json');

function validateServiceDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('invalid_service_date');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError('invalid_service_date');
  }
  return value;
}

function displayTrainTitle(title) {
  return title.replace(/ \[\d{4}-\d{2}-\d{2}\](?= )/, '');
}

function planServiceDate(value) {
  const date = validateServiceDate(value);
  return schedules.map((train) => {
    const routeStart = train.title.lastIndexOf(' ');
    const departure = new Date(`${date}T${train.departure}+09:00`);
    return {
      title: train.title,
      tagged_title: `${train.title.slice(0, routeStart)} [${date}]${train.title.slice(routeStart)}`,
      opens_at: departure.toISOString(),
      closes_at: new Date(departure.getTime() + train.durationMinutes * 60000).toISOString(),
      price: train.price,
      seats: train.seats,
    };
  });
}

const INSERT_EVENTS_SQL = `
  INSERT INTO ticket_event(title, opens_at, closes_at)
  SELECT desired.tagged_title, desired.opens_at, desired.closes_at
    FROM jsonb_to_recordset($1::jsonb) AS desired(
      title text, tagged_title text, opens_at timestamptz, closes_at timestamptz)
   WHERE NOT EXISTS (
     SELECT 1 FROM ticket_event existing
      WHERE existing.title IN (desired.title, desired.tagged_title)
        AND (existing.opens_at AT TIME ZONE 'Asia/Seoul')::date = $2::date
   )`;

const SELECT_EVENTS_SQL = `
  SELECT DISTINCT ON (desired.title) existing.id, desired.price, desired.seats
    FROM jsonb_to_recordset($1::jsonb) AS desired(
      title text, tagged_title text, price integer, seats integer)
    JOIN ticket_event existing
      ON existing.title IN (desired.title, desired.tagged_title)
     AND (existing.opens_at AT TIME ZONE 'Asia/Seoul')::date = $2::date
   ORDER BY desired.title, (existing.title = desired.title) DESC, existing.id`;

const INSERT_SEATS_SQL = `
  WITH targets AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb)
      AS target(id bigint, price integer, seats integer)
  ), counts AS (
    SELECT target.id, target.price, target.seats, COUNT(existing.id)::integer AS current_count
      FROM targets target LEFT JOIN seat existing ON existing.event_id = target.id
     GROUP BY target.id, target.price, target.seats
  ), missing AS (
    SELECT counts.id, counts.price, candidate.number
      FROM counts CROSS JOIN LATERAL (
        SELECT generated.number FROM generate_series(1, counts.seats) AS generated(number)
         WHERE NOT EXISTS (
           SELECT 1 FROM seat existing
            WHERE existing.event_id = counts.id
              AND existing.seat_code = 'DEMO-' || LPAD(generated.number::text, 3, '0')
         )
         ORDER BY generated.number
         LIMIT GREATEST(0, counts.seats - counts.current_count)
      ) candidate
  )
  INSERT INTO seat(event_id, seat_code, status, version, price, grade)
  SELECT id, 'DEMO-' || LPAD(number::text, 3, '0'), 'AVAILABLE', 0, price, 'STANDARD'
    FROM missing ON CONFLICT (event_id, seat_code) DO NOTHING`;

function createDailyCatalog(pool) {
  // 같은 날짜의 동시 조회를 합치고, 다른 Pod와의 충돌은 DB 잠금으로 막는다.
  const cache = new Map();
  async function seed(date) {
    const planned = planServiceDate(date);
    const serialized = JSON.stringify(planned);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('ticketrail-daily-catalog-v1'), hashtext($1))",
        [date]
      );
      await client.query(INSERT_EVENTS_SQL, [serialized, date]);
      const { rows } = await client.query(SELECT_EVENTS_SQL, [serialized, date]);
      if (rows.length !== planned.length) throw new Error('daily_catalog_incomplete');
      await client.query(INSERT_SEATS_SQL, [JSON.stringify(rows)]);
      await client.query('COMMIT');
      return rows.map((row) => String(row.id));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return async function ensureServiceDate(value) {
    const date = validateServiceDate(value);
    const existing = cache.get(date);
    if (existing && Date.now() - existing.started < 300000) return existing.promise;
    const entry = { started: Date.now() };
    entry.promise = seed(date).catch((error) => {
      if (cache.get(date) === entry) cache.delete(date);
      throw error;
    });
    cache.set(date, entry);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return entry.promise;
  };
}

module.exports = {
  validateServiceDate, displayTrainTitle, planServiceDate, createDailyCatalog,
};
