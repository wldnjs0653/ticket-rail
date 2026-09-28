// @author gyustar
// @date 2026-09-10
//
// 열차(이벤트) 목록 조회 라우트
//
// 기존에는 UI(ticketing.html)가 열차 목록을 하드코딩으로 들고 있었다.
// 열차를 추가할 때마다 HTML을 고치고 이미지를 다시 구워야 했고,
// DB에 실제로 존재하는 이벤트와 화면 목록이 어긋날 수 있었다.
// 이 라우트는 ticket_event 와 seat 을 조인해서 "화면에 뿌릴 목록"을 만든다.
//
// opens_at / closes_at 은 원래 예매 시작·종료 시각이지만,
// 열차 이벤트에서는 출발·도착 시각으로 사용한다 (1차 범위 한정).

const express = require('express');
const pool = require('../clients/pgClient');
const router = express.Router();

// GET /events
// 이벤트별로 최저가와 잔여 좌석 수를 함께 반환한다.
// 좌석이 하나도 없는 이벤트는 예매 대상이 아니므로 제외한다.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id,
              e.title,
              e.opens_at,
              e.closes_at,
              MIN(s.price)                                      AS min_price,
              MIN(s.price) FILTER (WHERE s.grade = 'STANDARD') AS standard_price,
              MIN(s.price) FILTER (WHERE s.grade <> 'STANDARD')      AS first_price,
              COUNT(*) FILTER (WHERE s.status = 'AVAILABLE')     AS available_seats,
              COUNT(*)                                           AS total_seats
         FROM ticket_event e
         JOIN seat s ON s.event_id = e.id
        GROUP BY e.id, e.title, e.opens_at, e.closes_at
        HAVING MIN(s.price) > 0
        ORDER BY e.opens_at`
    );
    return res.status(200).json({ events: result.rows });
  } catch (err) {
    console.error('[event] GET / failed:', err.message);
    return res.status(500).json({ error: 'event_query_failed' });
  }
});

module.exports = router;