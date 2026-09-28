// Usage: node tests/run.mjs /absolute/path/to/ansible-playbook
// No real cluster/API calls; all outputs are under a temporary directory.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ansible = process.argv[2] || 'ansible-playbook';
const temp = mkdtempSync(join(tmpdir(), 'concurrency-validation-'));
for (const name of ['mock-k6.cjs', 'mock-kubectl.cjs']) chmodSync(join(root, 'tests', name), 0o755);
for (const [mode, state] of [['pass', 'PASS'], ['no-overlap', 'INCONCLUSIVE'], ['double-winner', 'FAIL'], ['db-pending', 'FAIL'], ['used-seat', 'ERROR']]) {
  const results = join(temp, mode);
  const vars = join(temp, mode + '.json');
  writeFileSync(vars, JSON.stringify({ seat_id: 9, user_ids: [1,2,3,4,5],
    k6_binary: join(root, 'tests/mock-k6.cjs'), kubectl_binary: join(root, 'tests/mock-kubectl.cjs'),
    result_root: results, prometheus_remote_write_url: '', db_poll_attempts: 1,
    ansible_python_interpreter: process.env.TEST_ANSIBLE_PYTHON || 'auto_silent' }));
  const result = spawnSync(ansible, ['-i', 'inventory.ini', 'concurrency.yml', '-e', '@' + vars], {
    cwd: root, env: { ...process.env, CONCURRENCY_TEST_MODE: mode }, encoding: 'utf8', timeout: 180000,
  });
  writeFileSync(join(temp, mode + '.log'), (result.stdout || '') + (result.stderr || ''));
  const runs = readdirSync(results);
  const outcome = JSON.parse(readFileSync(join(results, runs[0], 'result.json')));
  if (outcome.state !== state || (state === 'PASS' ? result.status !== 0 : result.status === 0)) {
    console.error(result.stdout, result.stderr, outcome); throw Error(`${mode}: expected ${state}; logs ${temp}`);
  }
  console.log(`${mode}: ${outcome.state}; overlap=${outcome.overlap_ms}; API=${outcome.api_ok}; DB=${outcome.db_ok}`);
}
console.log('All five deterministic workflow cases passed. Logs: ' + temp);
