const token = window.location.hash.slice(1);
const bookingLabel = document.getElementById('booking');
const timeline = document.getElementById('stages');
const statusLabel = document.getElementById('status');
const retryButton = document.getElementById('retry');
const clock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const stages = [
  { id: 'seatHeld', name: 'Redis', icon: 'redis', describe: (_trace, stage) => `좌석 선점 · 유효 시간 ${stage.ttlSeconds}초` },
  { id: 'bookingStored', name: 'PostgreSQL', icon: 'postgresql', describe: trace => `예약 ${trace.bookingId}번 저장` },
  { id: 'seatReleased', name: 'Redis', icon: 'redis', describe: () => '좌석 선점 해제' },
  { id: 'bookingPublished', name: 'Kafka', icon: 'kafka', describe: () => 'booking.created 발행' },
  { id: 'paymentApproved', name: '결제 Consumer', describe: () => '테스트 결제 승인' },
  { id: 'paymentPublished', name: 'Kafka', icon: 'kafka', describe: () => 'payment.completed 발행' },
  { id: 'notificationSent', name: '알림 Consumer', describe: () => '테스트 알림 처리 완료' },
];

function createRow(step, event, trace, state) {
  const row = document.createElement('li');
  row.className = 'stage';
  row.dataset.state = state;
  const time = document.createElement('time');
  time.textContent = event ? clock.format(new Date(event.at)) : '—';
  if (event) time.dateTime = event.at;

  const technology = document.createElement('strong');
  const icon = document.createElement(step.icon ? 'img' : 'span');
  if (step.icon) {
    icon.src = `assets/booking-trace/${step.icon}.svg`;
    icon.alt = '';
  } else {
    icon.className = 'consumer-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⚙';
  }
  technology.append(icon, step.name);

  const result = document.createElement('span');
  result.className = 'stage-result';
  result.textContent = state === 'failed' ? 'booking.created 발행 실패'
    : event ? step.describe(trace, event)
    : state === 'missing' ? '기록 없음' : '확인 대기';
  row.append(time, technology, result);
  return row;
}

function showStatus(message, state = '', canRetry = false) {
  if (statusLabel.textContent !== message) statusLabel.textContent = message;
  statusLabel.parentElement.dataset.state = state;
  retryButton.hidden = !canRetry;
}

function render(trace) {
  bookingLabel.hidden = false;
  bookingLabel.textContent = `예약 번호 ${trace.bookingId}`;
  const events = trace.stages;
  const complete = Boolean(events.notificationSent && events.paymentPublished && events.paymentApproved && events.bookingPublished);
  const ordered = stages.map(step => {
    const failure = step.id === 'bookingPublished' && events.bookingPublishFailed;
    const event = events[step.id] || failure;
    const state = failure ? 'failed' : event ? 'done' : complete ? 'missing' : 'waiting';
    return { step, event, state };
  }).sort((a, b) => (a.event?.at || 'z').localeCompare(b.event?.at || 'z'));
  timeline.replaceChildren(...ordered.map(({ step, event, state }) => createRow(step, event, trace, state)));

  if (events.bookingPublishFailed) {
    showStatus('예약은 저장됐지만 Kafka 발행에 실패했습니다.', 'failed');
    return true;
  }
  if (complete) {
    showStatus(`예약 ${trace.bookingId}번의 테스트 결제·알림 처리 완료`, 'complete');
    return true;
  }
  showStatus('결제·알림 처리 기록을 확인하고 있습니다.');
  return false;
}

async function loadTrace() {
  showStatus('처리 기록을 불러오는 중입니다.');
  const deadline = Date.now() + 90000;
  try {
    while (Date.now() < deadline) {
      const response = await fetch('/demo/booking-trace', {
        cache: 'no-store',
        headers: { 'X-TicketRail-Trace': token },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 404) {
        showStatus('처리 기록이 없거나 보관 시간이 지났습니다.', 'failed');
        return;
      }
      if (!response.ok) throw new Error('Trace request failed');
      if (render(await response.json())) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    showStatus('아직 확인되지 않은 단계가 있습니다.', '', true);
  } catch {
    showStatus('처리 기록을 불러오지 못했습니다.', 'failed', true);
  }
}

retryButton.addEventListener('click', loadTrace);
if (/^[0-9a-f-]{36}$/.test(token)) void loadTrace();
else showStatus('예매 완료 화면의 처리 기록 링크를 열어주세요.');
