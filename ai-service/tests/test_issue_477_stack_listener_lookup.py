"""`stack.sh`'s listener lookup must see a process lsof cannot parse (issue #477).

`stack.sh down` left the frontend running and then reported its own orphan as a
foreign process. The cause was not the pid bookkeeping: Next.js sets its process
title to "next-server (v16.2.2)", the kernel truncates a process name to 15
characters, and the resulting "next-server (v1" has an unbalanced parenthesis
that lsof cannot parse. lsof drops the process silently, so nothing was ever
recorded at `up` and `down` had nothing to stop.

These tests exercise `proc_listening_pids`, the /proc-based lookup that replaces
lsof on Linux. They fail on the base commit -- the function does not exist there,
and the lsof path they stand in for returns nothing for the mangled name.

This lives under ai-service/tests because it is the repository's only Python test
suite; `stack.sh` is the script that starts this service.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
STACK_SH = REPO_ROOT / "scripts" / "dev" / "stack.sh"

pytestmark = pytest.mark.skipif(
    not sys.platform.startswith("linux") or not Path("/proc/net/tcp").exists(),
    reason="the /proc lookup is the Linux path; other platforms keep lsof/taskkill",
)

# A listener whose process name is exactly what the kernel gives Next.js.
_LISTENER = textwrap.dedent(
    """
    import ctypes, os, socket, sys, time
    ctypes.CDLL("libc.so.6").prctl(15, sys.argv[2].encode(), 0, 0, 0)
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", int(sys.argv[1])))
    s.listen(1)
    print(os.getpid(), flush=True)
    time.sleep(30)
    """
)


def _proc_listening_pids(port: int) -> list[str]:
    """Run stack.sh's `proc_listening_pids` in isolation.

    The function is extracted rather than sourced: sourcing stack.sh would run
    its argument dispatch. On a tree without the fix the extraction is empty and
    bash reports a missing command, which is the fail-to-pass signal.
    """
    body = subprocess.run(
        ["sed", "-n", "/^proc_listening_pids()/,/^}/p", str(STACK_SH)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    result = subprocess.run(
        ["bash", "-c", f'{body}\nproc_listening_pids "$1"', "_", str(port)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"proc_listening_pids failed: {result.stderr}"
    return result.stdout.split()


@pytest.fixture
def listener(request: pytest.FixtureRequest):
    """Spawn a listener on a free port under a given process name."""

    def _spawn(comm: str) -> tuple[int, int]:
        import socket as _socket

        probe = _socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()

        proc = subprocess.Popen(
            [sys.executable, "-c", _LISTENER, str(port), comm],
            stdout=subprocess.PIPE,
            text=True,
        )
        request.addfinalizer(proc.kill)
        assert proc.stdout is not None
        pid = int(proc.stdout.readline().strip())
        return port, pid

    return _spawn


def test_finds_a_plain_listener(listener) -> None:
    port, pid = listener("plain-listener")
    assert str(pid) in _proc_listening_pids(port)


def test_finds_the_listener_lsof_cannot_parse(listener) -> None:
    """The actual #477 bug: the truncated Next.js title breaks lsof's parser."""
    port, pid = listener("next-server (v16.2.2)")

    comm = Path(f"/proc/{pid}/comm").read_text(encoding="utf-8").strip()
    assert comm == "next-server (v1", "expected the kernel's 15-char truncation"

    assert str(pid) in _proc_listening_pids(port)


def test_reports_nothing_for_an_unused_port() -> None:
    import socket as _socket

    probe = _socket.socket()
    probe.bind(("127.0.0.1", 0))
    free_port = probe.getsockname()[1]
    probe.close()

    assert _proc_listening_pids(free_port) == []
