#!/usr/bin/env python3
"""Optional analysis of k6 JSON Lines; Python standard library only.

HTTP completion samples and flow completion samples are different populations.
Timing is descriptive and never a measurement of Primary/Pod recovery time.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

METRICS = {
    'http_reqs', 'http_req_failed', 'http_req_duration', 'dropped_iterations',
    'probe_failed', 'probe_latency', 'flow_started', 'flow_completed',
    'flow_successes', 'flow_conflicts', 'flow_failed', 'flow_duration_ms',
}


def parse_time(value):
    if not isinstance(value, str):
        raise ValueError('시각은 문자열이어야 합니다.')

    # k6 JSON timestamps may contain nanoseconds (9 fractional digits), while
    # datetime.fromisoformat() on older controller Python versions accepts at
    # most microseconds (6 digits). Truncation is intentional: datetime cannot
    # represent finer precision and the failure-test sampling interval is much
    # larger than one microsecond.
    normalized = re.sub(
        r'(\.\d{6})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)',
        r'\1',
        value,
    )
    parsed = datetime.fromisoformat(normalized.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('시각에는 시간대가 필요합니다: ' + value)
    return parsed.astimezone(timezone.utc)


def iso(value):
    return value.isoformat().replace('+00:00', 'Z') if value is not None else None


def percentile(values, q):
    if not values:
        return None
    values = sorted(values)
    pos = (len(values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return values[lo] + (values[hi] - values[lo]) * (pos - lo)


def read_points(path):
    points = defaultdict(list)
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt', encoding='utf-8') as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                if item.get('type') != 'Point' or item.get('metric') not in METRICS:
                    continue
                data = item['data']
                value = float(data['value'])
                if not math.isfinite(value):
                    raise ValueError('유한한 숫자가 아닙니다.')
                tags = data.get('tags') or {}
                if not isinstance(tags, dict):
                    raise ValueError('tags는 객체여야 합니다.')
                metric = item['metric']
                if metric.endswith('_failed') and value not in (0, 1):
                    raise ValueError('Rate Point는 0 또는 1이어야 합니다.')
                if value < 0:
                    raise ValueError('음수 Point는 지원하지 않습니다.')
                points[metric].append({'time': parse_time(data['time']), 'value': value, 'tags': tags})
            except (KeyError, TypeError, ValueError, AttributeError) as exc:
                raise ValueError('입력 ' + str(line_number) + '행 오류: ' + str(exc)) from exc
    for samples in points.values():
        samples.sort(key=lambda x: x['time'])
    return points


def stats(samples, latencies=()):
    failed = sum(x['value'] for x in samples)
    return {
        'samples': len(samples), 'failed_samples': failed,
        'error_rate_percent': failed / len(samples) * 100 if samples else None,
        'status_counts': dict(Counter(str(x['tags'].get('status', 'unknown')) for x in samples)),
        'latency_ms': {'samples': len(latencies), 'p95': percentile(latencies, .95),
                       'max': max(latencies) if latencies else None},
    }


def recovery(samples, required):
    failures = [i for i, x in enumerate(samples) if x['value'] == 1]
    if not failures:
        return {'state': 'failure_not_observed' if samples else 'no_samples',
                'first_failure': None, 'first_ok': None, 'last_failure': None,
                'stabilized': None, 'until_first_ok_seconds': None,
                'until_stabilized_seconds': None, 'failure_episodes': []}
    first, last = failures[0], failures[-1]
    first_ok = next((x['time'] for x in samples[first + 1:] if x['value'] == 0), None)
    tail = samples[last + 1:]
    stabilized = tail[required - 1]['time'] if len(tail) >= required else None
    episodes, active = [], None
    for sample in samples:
        if sample['value'] == 1:
            if active is None:
                active = {'first_failed_completion': iso(sample['time']), 'failed_samples': 0}
            active['last_failed_completion'] = iso(sample['time'])
            active['failed_samples'] += 1
        elif active is not None:
            active['next_successful_completion'] = iso(sample['time'])
            episodes.append(active)
            active = None
    if active is not None:
        active['next_successful_completion'] = None
        episodes.append(active)
    first_time = samples[first]['time']
    return {
        'state': 'successes_observed_after_last_failure' if stabilized else 'recovery_unconfirmed',
        'first_failure': iso(first_time), 'last_failure': iso(samples[last]['time']),
        'first_ok': iso(first_ok), 'stabilized': iso(stabilized),
        'until_first_ok_seconds': (first_ok - first_time).total_seconds() if first_ok else None,
        'until_stabilized_seconds': (stabilized - first_time).total_seconds() if stabilized else None,
        'failure_episodes': episodes,
    }


def analyze(points, metric='http_req_failed', api=None, fault_time=None, end_time=None,
            consecutive_successes=5, summary=None):
    warnings = []
    if metric == 'flow_failed' and api:
        raise ValueError('flow_failed에는 --api를 사용할 수 없습니다. 전체 흐름을 선택하세요.')
    if fault_time and end_time and end_time <= fault_time:
        raise ValueError('--end-time은 --fault-time보다 뒤여야 합니다.')
    run_ids = {p['tags'].get('run_id', '<missing>') for p in points.get(metric, [])}
    if len(run_ids) > 1:
        raise ValueError('여러 run_id가 섞여 있습니다. 실행 회차별 원본 파일로 분석하세요.')

    def window(samples, use_api=True):
        return [p for p in samples if (not fault_time or p['time'] >= fault_time)
                and (not end_time or p['time'] < end_time)
                and (not use_api or not api or p['tags'].get('api') == api)]

    samples = window(points.get(metric, []))
    latency_metric = {'http_req_failed': 'http_req_duration', 'probe_failed': 'probe_latency',
                      'flow_failed': 'flow_duration_ms'}[metric]
    latencies = [p['value'] for p in window(points.get(latency_metric, []))]
    http_points = window(points.get('http_reqs', []))
    all_http = points.get('http_reqs', [])
    http_count = sum(p['value'] for p in http_points) if http_points else None
    dropped = sum(p['value'] for p in points.get('dropped_iterations', []))
    full_flows = None
    if 'flow_started' in points:
        totals = {name: sum(p['value'] for p in points.get(name, []))
                  for name in ('flow_started', 'flow_completed', 'flow_successes', 'flow_conflicts')}
        totals['unfinished_flows'] = totals['flow_started'] - totals['flow_completed']
        totals['failed_step_counts'] = dict(Counter(p['tags'].get('failed_step', 'unknown')
            for p in points.get('flow_failed', []) if p['value'] == 1))
        full_flows = totals
        if totals['unfinished_flows'] != 0:
            warnings.append('시작/완료 flow 수가 다릅니다. 완료된 flow의 실패율만으로 전체를 판정할 수 없습니다.')
    if dropped:
        warnings.append('dropped_iterations가 있습니다. 예정된 모든 시도가 발생한 시험이 아닙니다.')
    if not samples:
        warnings.append('선택한 metric/기간/API의 표본이 없습니다. 정상·오류율 0으로 판정하지 마세요.')
    if api == 'booking':
        warnings.append('booking에 도달한 HTTP 요청만 선택했습니다. 앞 단계 실패는 full_run_flows와 by_api도 확인하세요.')
    if metric == 'http_req_failed' and http_count is not None and http_count != len(samples):
        warnings.append('http_reqs와 http_req_failed 표본 수가 다릅니다. 수집 누락 또는 필터를 확인하세요.')
    by_api = {}
    api_failure_points = window(points.get('http_req_failed', []), False)
    api_latency_points = window(points.get('http_req_duration', []), False)
    apis = {p['tags'].get('api', '(untagged)') for p in api_failure_points}
    for name in sorted(apis):
        selected = [p for p in api_failure_points
                    if p['tags'].get('api', '(untagged)') == name]
        selected_latencies = [p['value'] for p in api_latency_points
                              if p['tags'].get('api', '(untagged)') == name]
        by_api[name] = stats(selected, selected_latencies)
    result = {
        'metric': metric, 'api_filter': api, 'sample_timestamp': 'completion',
        'window_start_inclusive': iso(fault_time), 'window_end_exclusive': iso(end_time),
        'selected': stats(samples, latencies), 'http_reqs_in_selected_window': http_count,
        'full_run_http_reqs': sum(p['value'] for p in all_http) if all_http else None,
        'full_run_dropped_iterations': dropped, 'full_run_flows': full_flows, 'by_api': by_api,
        'warnings': warnings,
        'interpretation': 'HTTP 상태 실패와 예약 흐름 실패는 분모가 다릅니다. 결제·알림 완료는 별도 검증합니다.',
    }
    if summary is not None:
        values = summary.get('metrics', {}).get('http_reqs', {})
        values = values.get('values', values)
        result['summary_http_reqs'] = {'count': values.get('count'), 'rate_per_second': values.get('rate')}
        if values.get('count') is not None and values['count'] != result['full_run_http_reqs']:
            warnings.append('summary와 JSON Point의 전체 HTTP 요청 수가 다릅니다. 파일 회차·완전성을 확인하세요.')
    if fault_time:
        baseline = [p for p in points.get(metric, []) if p['time'] < fault_time
                    and (not api or p['tags'].get('api') == api)]
        result['baseline'] = stats(baseline)
        result['timing_optional'] = recovery(samples, consecutive_successes)
        result['timing_optional']['consecutive_successes_required'] = consecutive_successes
        warnings.append('시간 값은 완료 표본의 관측 간격입니다. 실제 장애 지속시간·Pod 복구시간·Primary 전환시간이 아닙니다.')
        if not baseline or any(p['value'] for p in baseline):
            warnings.append('장애 전 정상 baseline이 없거나 실패가 있습니다. 해당 장애만의 영향으로 확정할 수 없습니다.')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--metric', choices=['http_req_failed', 'probe_failed', 'flow_failed'], default='http_req_failed')
    parser.add_argument('--api')
    parser.add_argument('--fault-time', type=parse_time)
    parser.add_argument('--end-time', type=parse_time)
    parser.add_argument('--consecutive-successes', type=int, default=5)
    parser.add_argument('--summary', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.consecutive_successes < 1:
        parser.error('--consecutive-successes는 1 이상이어야 합니다.')
    try:
        summary = json.loads(args.summary.read_text(encoding='utf-8')) if args.summary else None
        result = analyze(read_points(args.input), args.metric, args.api, args.fault_time,
                         args.end_time, args.consecutive_successes, summary)
        rendered = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding='utf-8')
        print(rendered, end='')
    except (OSError, ValueError, TypeError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
