import importlib.util
import json
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'tools' / 'analyze-k6-json.py'
spec = importlib.util.spec_from_file_location('analyzer', SOURCE)
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
START = a.parse_time('2026-09-09T00:00:00Z')


def point(t, value, **tags):
    return {'time': START + timedelta(seconds=t), 'value': value, 'tags': tags}


class AnalyzerTests(unittest.TestCase):
    def test_empty_input_is_unknown(self):
        r = a.analyze({}, fault_time=START)
        self.assertIsNone(r['selected']['error_rate_percent'])
        self.assertEqual(r['timing_optional']['state'], 'no_samples')
        self.assertIsNone(r['timing_optional']['until_stabilized_seconds'])

    def test_no_failures_does_not_claim_zero_second_recovery(self):
        r = a.recovery([point(i, 0) for i in range(6)], 5)
        self.assertEqual(r['state'], 'failure_not_observed')
        self.assertIsNone(r['until_stabilized_seconds'])

    def test_first_success_is_not_final_stabilization(self):
        s = [point(0, 1), point(1, 0), point(2, 1)] + [point(i, 0) for i in range(3, 8)]
        r = a.recovery(s, 5)
        self.assertEqual(r['until_first_ok_seconds'], 1)
        self.assertEqual(r['until_stabilized_seconds'], 7)
        self.assertEqual(len(r['failure_episodes']), 2)

    def test_insufficient_successes_is_unconfirmed(self):
        r = a.recovery([point(0, 1), point(1, 0)], 5)
        self.assertEqual(r['state'], 'recovery_unconfirmed')
        self.assertIsNone(r['until_stabilized_seconds'])

    def test_equal_timestamps_keep_input_order(self):
        r = a.recovery([point(0, 0), point(0, 1)], 1)
        self.assertEqual(r['state'], 'recovery_unconfirmed')

    def test_http_reqs_counter_values_are_summed(self):
        p = {'http_reqs': [point(0, 2), point(1, 3)],
             'http_req_failed': [point(i, 0) for i in range(5)]}
        self.assertEqual(a.analyze(p)['full_run_http_reqs'], 5)

    def test_by_api_contains_matching_http_latency(self):
        p = {
            'http_req_failed': [point(0, 0, api='health'), point(1, 0, api='booking')],
            'http_req_duration': [point(0, 1.25, api='health'), point(1, 8.5, api='booking')],
        }
        r = a.analyze(p)
        self.assertEqual(r['by_api']['health']['latency_ms']['samples'], 1)
        self.assertEqual(r['by_api']['health']['latency_ms']['max'], 1.25)
        self.assertEqual(r['by_api']['booking']['latency_ms']['max'], 8.5)

    def test_booking_filter_preserves_upstream_failures(self):
        p = {'http_reqs': [point(0, 1, api='queue_join'), point(1, 1, api='booking')],
             'http_req_failed': [point(0, 1, api='queue_join'), point(1, 0, api='booking')],
             'flow_started': [point(0, 2)], 'flow_completed': [point(1, 2)],
             'flow_failed': [point(0, 1, failed_step='queue_join'), point(1, 0)]}
        r = a.analyze(p, api='booking')
        self.assertEqual(r['selected']['failed_samples'], 0)
        self.assertEqual(r['by_api']['queue_join']['failed_samples'], 1)
        self.assertEqual(r['full_run_flows']['failed_step_counts']['queue_join'], 1)
        self.assertTrue(r['warnings'])

    def test_drop_and_interrupted_flows_are_visible(self):
        p = {'http_req_failed': [point(0, 0)], 'dropped_iterations': [point(0, 4)],
             'flow_started': [point(0, 5)], 'flow_completed': [point(1, 3)]}
        r = a.analyze(p)
        self.assertEqual(r['full_run_dropped_iterations'], 4)
        self.assertEqual(r['full_run_flows']['unfinished_flows'], 2)
        self.assertGreaterEqual(len(r['warnings']), 2)

    def test_summary_count_mismatch_is_reported(self):
        r = a.analyze({'http_reqs': [point(0, 1)]},
                      summary={'metrics': {'http_reqs': {'values': {'count': 2, 'rate': 1}}}})
        self.assertTrue(any('summary' in x for x in r['warnings']))

    def test_flow_cannot_be_filtered_by_api(self):
        with self.assertRaises(ValueError):
            a.analyze({}, metric='flow_failed', api='booking')

    def test_mixed_runs_are_rejected(self):
        with self.assertRaises(ValueError):
            a.analyze({'http_req_failed': [point(0, 0, run_id='a'), point(1, 0, run_id='b')]})

    def test_bad_or_truncated_json_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'points.json'
            p.write_text('{"type":')
            with self.assertRaises(ValueError):
                a.read_points(p)

    def test_official_json_point_shape(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'points.json'
            p.write_text('\n'.join(json.dumps(x) for x in [
                {'type': 'Metric', 'metric': 'http_reqs', 'data': {}},
                {'type': 'Point', 'metric': 'http_reqs', 'data': {
                    'time': '2026-09-09T00:00:00.123456789Z', 'value': 1, 'tags': {'api': 'booking'}}},
            ]))
            points = a.read_points(p)
            self.assertEqual(a.analyze(points)['full_run_http_reqs'], 1)
            self.assertEqual(points['http_reqs'][0]['time'].microsecond, 123456)

    def test_fault_and_end_boundaries_are_explicit(self):
        p = {'http_req_failed': [point(-1, 0), point(0, 1), point(1, 0), point(2, 1)]}
        r = a.analyze(p, fault_time=START, end_time=START + timedelta(seconds=2),
                      consecutive_successes=1)
        self.assertEqual(r['baseline']['samples'], 1)
        self.assertEqual(r['selected']['samples'], 2)
        self.assertEqual(r['timing_optional']['until_stabilized_seconds'], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
