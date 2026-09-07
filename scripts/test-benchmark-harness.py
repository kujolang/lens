#!/usr/bin/env python3
"""Verify a failed core benchmark cannot become a successful median receipt."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='lens-bench-test-') as directory:
    work = Path(directory)
    binaries = work / 'bin'
    binaries.mkdir()
    target = work / 'target'
    target.mkdir()
    fake_node = binaries / 'node'
    fake_node.write_text('#!/bin/sh\nexit 42\n')
    fake_node.chmod(0o755)
    fake_lens = target / 'lens'
    fake_lens.write_text('#!/bin/sh\nexit 0\n')
    fake_lens.chmod(0o755)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    env = {**os.environ, 'PATH': str(binaries) + os.pathsep + os.environ['PATH'],
           'LENS_BENCH_TARGET_ROOT': str(target), 'LENS_BENCH_PORT': str(port),
           'KUJO_BIN': '/unused-by-this-harness-test'}
    receipt = work / 'receipt.json'
    command = ['bash', str(ROOT / 'scripts/bench.sh'), '1', str(receipt)]
    failed = subprocess.run(command, env=env, capture_output=True, timeout=30)
    assert failed.returncode == 42, (failed.returncode, failed.stderr)
    data = json.loads(receipt.read_text())
    assert data['completed'] is False and not data['medians'], data
    fake_node.write_text('#!/bin/sh\nexit 0\n')
    resumed = subprocess.run([*command, '--resume'], env=env, capture_output=True, timeout=30)
    assert resumed.returncode == 0, resumed.stderr
    data = json.loads(receipt.read_text())
    assert data['completed'] is True and len(data['medians']) == 10, data
print('Benchmark failure rejection and resume: 2 passed, 0 failed')
