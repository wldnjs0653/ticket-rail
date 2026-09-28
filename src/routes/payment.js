// @author gyustar
// @date 2026-09-08
// F0x - Payment 단 건 조회 route
// 예매 확정 후 Kafka 이벤트 체인(booking.create -> payment-consumer) 이 정상 처리 됐는지 확인하는 파일.
// 현재 상태 : Kafka 이벤트 발행 구간이 클러스터 외부 환경 제약으로 미검증으로 payment 테이블이 공백.
// 따라서 이 시점의 정상 동작은 404 - "조회했는데 없다"가 맞게 나오는 것 까지가 검증 범위
// K8s 배포 후 Kafka 체인 검증 시 실제 200 코드 응답 확인 예정

const express = require('express');
const pool = require('../clients/pgClient');
const router = express.Router();

// GET /payments/:id
// 처리 순서 :
//  1) payment 테이블에서 해당 id 조회 - 없을 경우 404
//  2) 있으면 결제 정보 반환

router.get('/:id', async (req, res) => {
    const paymentId = Number(req.params.id);
    // 숫자가 아닌 값이 오면(예 : /payments/abc) 조회 무의미 -> 400
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
        return res.status(400).json({ error: 'invalid_payment_id' });
    }

    try {
        const result = await pool.query(
            `SELECT p.id, p.booking_id, p.amount, p.status, p.processed_at,
                    EXISTS (
                      SELECT 1
                        FROM processed_event pe
                       WHERE pe.event_id = 'payment.completed:booking:' || p.booking_id::text
                    ) AS notification_sent
               FROM payment p
              WHERE p.booking_id = $1`,
                [paymentId]
            );
            if (result.rowCount === 0) {
                // payment 테이블에 없음 - K8s 배포 전 현재 시점에서 예상된 정상 응답
                return res.status(404).json({ error: 'payment_not_found' });
            }
            return res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error('[payment] GET /:id failed:', err.message);
        return res.status(500).json({ error: 'payment_query_failed' });
    }
        });
module.exports = router;
