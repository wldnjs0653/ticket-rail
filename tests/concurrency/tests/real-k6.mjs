// Real k6 + Ansible against local HTTPS fixture; PostgreSQL/Kubernetes are mocked.
// Usage: node tests/real-k6.mjs /path/to/ansible-playbook /path/to/k6
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'concurrency-real-k6-'));
const key = join(temp, 'key.pem'), cert = join(temp, 'cert.pem');
const ssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert]);
if (ssl.status !== 0) throw Error('openssl failed');
let winner = null; const calls = [];
const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  let raw = ''; req.on('data', part => raw += part); req.on('end', () => {
    const value = JSON.parse(raw); calls.push({ path: req.url, user_id: value.user_id });
    let status, payload;
    if (req.url === '/queue/join') { status = 202; payload = { token: 'private-' + value.user_id }; }
    else if (req.url === '/auth/verify') { status = 200; payload = { status: 'admitted' }; }
    else if (req.url === '/seats/9/hold') {
      status = winner === null ? 200 : 409;
      if (winner === null) winner = value.user_id;
      payload = {};
    } else if (req.url === '/bookings' && value.user_id === winner) {
      status = 201; payload = { booking_id: 900 + Number(winner) };
    } else { status = 500; payload = {}; }
    // Deliberate fixture delay makes client overlap observable; not a real service latency result.
    setTimeout(() => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); },
      req.url.endsWith('/hold') ? 100 : 1);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const vars = join(temp, 'vars.json');
writeFileSync(vars, JSON.stringify({ base_url: `https://127.0.0.1:${server.address().port}`,
  seat_id: 9, user_ids: [1,2,3,4,5], k6_binary: process.argv[3],
  kubectl_binary: join(root, 'tests/mock-kubectl.cjs'), result_root: join(temp, 'results'),
  prometheus_remote_write_url: '', db_poll_attempts: 1, tls_ca_file: cert,
  ansible_python_interpreter: process.env.TEST_ANSIBLE_PYTHON || 'auto_silent' }));
const child = spawn(process.argv[2] || 'ansible-playbook', ['-i', 'inventory.ini', 'concurrency.yml', '-e', '@' + vars], {
  cwd: root, env: { ...process.env, CONCURRENCY_TEST_MODE: 'pass' },
});
let output = ''; child.stdout.on('data', part => output += part); child.stderr.on('data', part => output += part);
const code = await new Promise(resolve => child.on('close', resolve));
server.close();
writeFileSync(join(temp, 'ansible.log'), output);
const runs = readdirSync(join(temp, 'results'));
const outcome = JSON.parse(readFileSync(join(temp, 'results', runs[0], 'result.json')));
if (code !== 0 || outcome.state !== 'PASS' || calls.filter(c => c.path.endsWith('/hold')).length !== 5 ||
    calls.filter(c => c.path === '/bookings').length !== 1) {
  console.error(output, outcome); throw Error('Integration failed; logs: ' + temp);
}
console.log(`Real k6 HTTPS integration: PASS, overlap=${outcome.overlap_ms}ms; mock DB. Logs: ${temp}`);
