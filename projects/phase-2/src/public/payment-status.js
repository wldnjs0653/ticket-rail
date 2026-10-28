/* 결제 조회는 읽기 전용이다. 예약 응답/HTTP 200/알림 완료만으로 승인하지 않는다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketRailPaymentStatus = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function classifyPayment(payment, bookingId) {
    if (!payment || Number(payment.booking_id) !== Number(bookingId)) return 'pending';
    const status = String(payment.status || '').toUpperCase();
    if (status === 'APPROVED') return 'approved';
    if (['FAILED', 'DECLINED', 'REJECTED', 'CANCELED', 'CANCELLED'].includes(status)) return 'failed';
    return 'pending';
  }

  function createPaymentTracker(options) {
    const later = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    const now = options.now || Date.now;
    const interval = options.intervalMs ?? 1500;
    const requestTimeout = options.requestTimeoutMs ?? 5000;
    const pendingAfter = options.pendingAfterMs ?? 8000;
    let active = null;

    function stop() {
      if (!active) return;
      const previous = active;
      active = null;
      for (const key of ['pollTimer', 'pendingTimer', 'tickTimer', 'requestTimer']) cancel(previous[key]);
      previous.controller?.abort();
    }

    function showPending(ctx) {
      if (active !== ctx || ctx.pendingShown) return;
      ctx.pendingShown = true;
      options.onPending?.(ctx.bookingId);
    }

    function tick(ctx) {
      if (active !== ctx) return;
      options.onTick?.(Math.max(0, now() - ctx.startedAt));
      ctx.tickTimer = later(() => tick(ctx), 1000);
    }

    async function poll(ctx) {
      if (active !== ctx || ctx.inFlight) return;
      ctx.inFlight = true;
      ctx.controller = new AbortController();
      options.onChecking?.(true);
      try {
        const deadline = new Promise((_, reject) => {
          ctx.requestTimer = later(() => {
            ctx.controller.abort();
            reject(new Error('payment_status_timeout'));
          }, requestTimeout);
        });
        const payment = await Promise.race([
          options.readPayment(ctx.bookingId, ctx.controller.signal), deadline,
        ]);
        if (active !== ctx) return;
        const state = classifyPayment(payment, ctx.bookingId);
        if (state !== 'pending') {
          stop();
          options.onChecking?.(false);
          if (state === 'approved') options.onApproved?.(payment);
          else options.onFailed?.(payment);
          return;
        }
        options.onWaiting?.();
      } catch {
        if (active === ctx) options.onWaiting?.();
      } finally {
        cancel(ctx.requestTimer);
        ctx.inFlight = false;
        if (active === ctx) {
          options.onChecking?.(false);
          ctx.pollTimer = later(() => poll(ctx), interval);
        }
      }
    }

    function start(bookingId, settings = {}) {
      stop();
      if (!Number.isSafeInteger(Number(bookingId)) || Number(bookingId) <= 0) throw new Error('invalid_booking_id');
      const ctx = { bookingId: Number(bookingId), startedAt: settings.startedAt || now(), pendingShown: false, inFlight: false };
      active = ctx;
      if (settings.immediate) showPending(ctx);
      else ctx.pendingTimer = later(() => showPending(ctx), pendingAfter);
      tick(ctx);
      void poll(ctx);
    }

    function checkNow() {
      if (!active || active.inFlight) return;
      cancel(active.pollTimer);
      return poll(active);
    }

    return { start, stop, checkNow };
  }

  // 결제 승인은 즉시 표시하고, 알림 완료는 별도 읽기 전용 조회로 확인한다.
  function createNotificationTracker(options) {
    const later = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    const interval = options.intervalMs ?? 3000;
    const requestTimeout = options.requestTimeoutMs ?? 5000;
    const maxWait = options.maxWaitMs ?? 300000;
    let active = null;

    function stop() {
      if (!active) return;
      const previous = active;
      active = null;
      cancel(previous.pollTimer);
      cancel(previous.requestTimer);
      cancel(previous.expiryTimer);
      previous.controller?.abort();
    }

    function confirm(ctx, payment) {
      if (active !== ctx || classifyPayment(payment, ctx.bookingId) !== 'approved' || payment.notification_sent !== true) return false;
      stop();
      options.onConfirmed?.(payment);
      return true;
    }

    async function poll(ctx) {
      if (active !== ctx) return;
      ctx.controller = new AbortController();
      try {
        const deadline = new Promise((_, reject) => {
          ctx.requestTimer = later(() => {
            ctx.controller.abort();
            reject(new Error('notification_status_timeout'));
          }, requestTimeout);
        });
        const payment = await Promise.race([
          options.readPayment(ctx.bookingId, ctx.controller.signal), deadline,
        ]);
        if (confirm(ctx, payment)) return;
      } catch {
        // 통신 실패나 미처리 상태에서는 완료 알림을 표시하지 않는다.
      } finally {
        cancel(ctx.requestTimer);
        if (active === ctx) ctx.pollTimer = later(() => poll(ctx), interval);
      }
    }

    function start(bookingId, initialPayment) {
      stop();
      if (!Number.isSafeInteger(Number(bookingId)) || Number(bookingId) <= 0) throw new Error('invalid_booking_id');
      const ctx = { bookingId: Number(bookingId) };
      active = ctx;
      if (confirm(ctx, initialPayment)) return;
      ctx.expiryTimer = later(stop, maxWait);
      ctx.pollTimer = later(() => poll(ctx), interval);
    }

    return { start, stop };
  }

  return { classifyPayment, createPaymentTracker, createNotificationTracker };
});
