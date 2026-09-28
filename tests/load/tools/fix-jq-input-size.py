#!/usr/bin/env python3
"""Fix large JSON argument failures in the load-test package (offline installer).

Usage: python3 fix-jq-input-size.py /opt/ticket-rail/tests/load
Does not change configuration, monitoring rules, thresholds, or run any workload.
"""
import datetime
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def replace_once(text, old, new, label):
    if new in text and old not in text:
        return text
    if text.count(old) != 1:
        raise ValueError(f"{label}: expected source differs; no files changed")
    return text.replace(old, new, 1)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1]).resolve()
    paths = [root / p for p in ('guard/watch.sh', 'collect.sh', 'run.sh')]
    if any(p.is_symlink() or not p.is_file() for p in paths):
        raise SystemExit('Expected regular files: guard/watch.sh, collect.sh, run.sh')
    originals = {p: p.read_text() for p in paths}
    changed = dict(originals)
    p = paths[0]
    old = 'WORK="$OUT/.guard"; mkdir -p "$WORK" "$OUT/evidence"'
    new = old + '''
# Read large snapshots from files, preserving the existing evaluation rules.
printf '{}\\n' > "$WORK/empty-http.json"
printf '%s\\n' '$sample_file[0] as $s | $previous_file[0] as $prev | $baseline_file[0] as $baseline | $http_file[0] as $http |' > "$WORK/evaluate-inputs.jq"
cat "$ROOT/evaluate.jq" >> "$WORK/evaluate-inputs.jq"'''
    # The original initialization line remains inside the patched block.
    if new not in changed[p]:
        changed[p] = replace_once(changed[p], old, new, 'watch initialization')
    changed[p] = replace_once(changed[p],
        '  HTTP=\'{}\'; [[ ! -s "$WORK/http.json" ]] || HTTP=$(cat "$WORK/http.json")',
        '  HTTP_FILE="$WORK/empty-http.json"; [[ ! -s "$WORK/http.json" ]] || HTTP_FILE="$WORK/http.json"',
        'HTTP snapshot')
    changed[p] = replace_once(changed[p],
        '''  jq -cn --argjson s "$(cat "$WORK/sample/sample.json")" --argjson prev "$(cat "$WORK/previous.json")" \\
    --argjson baseline "$(cat "$WORK/baseline.json")" --argjson http "$HTTP" -f "$ROOT/evaluate.jq" > "$WORK/current.json"''',
        '''  jq -cn --slurpfile sample_file "$WORK/sample/sample.json" --slurpfile previous_file "$WORK/previous.json" \\
    --slurpfile baseline_file "$WORK/baseline.json" --slurpfile http_file "$HTTP_FILE" -f "$WORK/evaluate-inputs.jq" > "$WORK/current.json"''',
        'watch jq input')
    p = paths[1]
    changed[p] = replace_once(changed[p], "  RESPONSE='null'",
        '''  printf 'null\\n' > "$OUT/evidence/.prom.response.json"''', 'collector empty response')
    changed[p] = replace_once(changed[p], '        RESPONSE=$(cat "$OUT/evidence/.prom.tmp")',
        '        cp "$OUT/evidence/.prom.tmp" "$OUT/evidence/.prom.response.json"', 'collector response')
    changed[p] = replace_once(changed[p], '''[[ $(jq '.data.result|length' <<< "$RESPONSE") != 0 ]]''',
        '''[[ $(jq '.data.result|length' "$OUT/evidence/.prom.response.json") != 0 ]]''', 'collector series count')
    changed[p] = replace_once(changed[p], '--argjson response "$RESPONSE"',
        '--slurpfile response "$OUT/evidence/.prom.response.json"', 'collector jq input')
    changed[p] = replace_once(changed[p],
        "'$spec + {query:$query,state:$state,response:$response}'",
        "'$spec + {query:$query,state:$state,response:$response[0]}'", 'collector response object')
    old = 'rm -f "$OUT/evidence/.prom.tmp"'
    new = 'rm -f "$OUT/evidence/.prom.tmp" "$OUT/evidence/.prom.response.json"'
    if new not in changed[p]:
        changed[p] = replace_once(changed[p], old, new, 'collector cleanup')
    p = paths[2]
    changed[p] = replace_once(changed[p], '--argjson end "$(date +%s)"',
        '--argjson end_ts "$(date +%s)"', 'end variable')
    changed[p] = replace_once(changed[p], '{end:$end,exit_code:$code,stage:$stage}',
        '{end:$end_ts,exit_code:$code,stage:$stage}', 'end metadata')
    updates = {p: value for p, value in changed.items() if value != originals[p]}
    if not updates:
        print('Already applied; no changes.')
        return
    # Validate all anchors and shell syntax before changing any installed file.
    for p, value in updates.items():
        subprocess.run(['bash', '-n'], input=value, text=True, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    backup = root / ('jq-input-backup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir()
    for p in updates:
        dest = backup / p.relative_to(root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dest)
    try:
        for p, value in updates.items():
            fd, temp = tempfile.mkstemp(prefix=p.name + '.', dir=p.parent)
            try:
                with os.fdopen(fd, 'w') as f:
                    f.write(value)
                shutil.copystat(p, temp)
                os.replace(temp, p)
            finally:
                if os.path.exists(temp):
                    os.unlink(temp)
    except Exception:
        for p in updates:
            shutil.copy2(backup / p.relative_to(root), p)
        raise
    print('Applied: ' + ', '.join(str(p.relative_to(root)) for p in updates))
    print('Backup: ' + str(backup))
    print('Configuration and monitoring rules unchanged. Run Ansible preflight next.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc))
