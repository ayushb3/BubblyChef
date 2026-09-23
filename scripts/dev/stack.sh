#!/usr/bin/env bash
# Run BubblyChef's full stack as a PRODUCTION build, on ports unique to this worktree.
#
# Used by the `verify` skill (.claude/skills/verify/) so an agent can exercise a
# change in a running app, and so several worktrees can do it at once without
# colliding on 3000/8888.
#
#   scripts/dev/stack.sh ports    print this worktree's ports as shell exports
#   scripts/dev/stack.sh up       build the frontend and start both services
#   scripts/dev/stack.sh status   show whether each service is answering
#   scripts/dev/stack.sh down     stop both services
#
# Why production and not `next dev`: dev mode's partial hydration hid real bugs
# from the e2e suite (issue #345). A change is verified against what ships.
#
# Two things that silently break a non-default port, both handled here:
#   - NEXT_PUBLIC_AI_SERVICE_URL is inlined at BUILD time, so it must be set before
#     `next build`, not at `next start`.
#   - ai-service only allows CORS from http://localhost:3000 by default, so the
#     frontend's real origin must be passed in, or every AI call is blocked by the
#     browser while the page itself looks fine.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
STATE="$ROOT/.verify"
mkdir -p "$STATE"

# ── Ports ────────────────────────────────────────────────────────────────────
# Every checkout, the main one included, gets a slot derived from its path: the
# same checkout always gets the same ports, and two almost never share one. 3000
# and 8888 are never used — those belong to a human's `npm run dev` / `uvicorn`,
# and an agent verifying in the main checkout must not collide with (or, worse,
# stop) them. Collisions between slots are still possible (50 of them), so `up`
# refuses to start on a port that is already answering.
SLOT=$(( ( $(printf '%s' "$ROOT" | cksum | awk '{print $1}') % 50 ) + 1 ))
PORT=$(( 3000 + SLOT * 10 ))
AI_PORT=$(( 8888 + SLOT * 10 ))
SHA=$(git -C "$ROOT" rev-parse HEAD)
# 127.0.0.1, not localhost: e2e/global-setup.ts scopes the auth cookie to
# 127.0.0.1, and browsers don't send it to localhost, so sign-in would silently fail.
WEB_URL="http://127.0.0.1:$PORT"
AI_URL="http://127.0.0.1:$AI_PORT"
LISTENERS="$STATE/listeners"

# The probe runs in a subshell, which closes the connection when it exits. Do not
# add an `exec ... 2>/dev/null` here: outside a subshell that silences stderr for
# the rest of the script, which hid every error message after the first probe.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_for() {
  local url=$1 name=$2 tries=${3:-60}
  for _ in $(seq "$tries"); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then echo "  $name up: $url"; return 0; fi
    sleep 2
  done
  echo "  $name did not come up at $url — see $STATE/$name.log" >&2
  return 1
}

cmd_ports() {
  echo "export PORT=$PORT"
  echo "export AI_PORT=$AI_PORT"
  echo "export PLAYWRIGHT_BASE_URL=$WEB_URL"
  echo "export AI_SERVICE_URL=$AI_URL"
}

# A failed `up` must not leave half a stack behind, and must not be quietly
# replaced by `next dev`: dev mode hides the hydration bugs this script exists
# to catch, and a verify run against it proves nothing about the production
# build. So stop whatever this run started, and say so loudly.
fail_up() {
  local what=$1 log=$2
  {
    echo
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "!! stack.sh up FAILED: $what"
    echo "!! Log: $log"
    if [ -f "$log" ]; then
      echo "!! First errors:"
      grep -m 8 -iE 'error|failed' "$log" | sed 's/^/!!   /'
    fi
    echo "!! Do NOT fall back to 'next dev' and call it verified. Fix the build,"
    echo "!! or report that the stack won't start: that is itself a finding."
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo
  } >&2
  cmd_down >&2
  exit 1
}

cmd_up() {
  for p in "$PORT" "$AI_PORT"; do
    if port_busy "$p"; then
      echo "Port $p is already in use. If an earlier '$0 up' started it, run '$0 down';" >&2
      echo "otherwise something else owns it — find and stop it yourself, then retry." >&2
      exit 1
    fi
  done

  # Both ports were just confirmed free, so any recorded listeners are stale.
  : >"$LISTENERS"

  echo "== ai-service on $AI_PORT"
  (
    cd "$ROOT/ai-service" || exit 1
    BUBBLY_GIT_SHA="$SHA" \
    BUBBLY_CORS_ORIGINS="[\"$WEB_URL\",\"http://localhost:$PORT\"]" \
      nohup python -m uvicorn bubbly_chef.main:app --host 127.0.0.1 --port "$AI_PORT" \
      >"$STATE/ai-service.log" 2>&1 &
  )
  wait_for "$AI_URL/health" ai-service 30 || fail_up "ai-service did not answer" "$STATE/ai-service.log"
  record_listener "$AI_PORT"

  echo "== nextjs production build (AI at $AI_URL)"
  # `next dev` writes route types to .next/dev/types, and tsconfig includes that
  # directory, so `next build` type-checks whatever a previous dev run left
  # there. Stale dev types fail the production type check (for example on a
  # page's extra named export) even though the code builds fine on a clean
  # checkout. They are dev-server output only, so clear them first.
  rm -rf "$ROOT/nextjs/.next/dev"
  (
    cd "$ROOT/nextjs" || exit 1
    NEXT_PUBLIC_GIT_SHA="$SHA" NEXT_PUBLIC_AI_SERVICE_URL="$AI_URL" npm run build >"$STATE/nextjs-build.log" 2>&1
  ) || fail_up "next build failed" "$STATE/nextjs-build.log"

  echo "== nextjs on $PORT"
  (
    cd "$ROOT/nextjs" || exit 1
    NEXT_PUBLIC_GIT_SHA="$SHA" NEXT_PUBLIC_AI_SERVICE_URL="$AI_URL" nohup npx next start -p "$PORT" \
      >"$STATE/nextjs.log" 2>&1 &
  )
  wait_for "$WEB_URL/api/health" nextjs 60 || fail_up "nextjs did not answer" "$STATE/nextjs.log"
  record_listener "$PORT"

  echo
  echo "Stack is up at ${SHA:0:8}. Frontend $WEB_URL · AI service $AI_URL"
  echo "Stop it with: $0 down"
}

cmd_status() {
  printf 'frontend   %-28s ' "$WEB_URL"
  curl -fsS -o /dev/null "$WEB_URL/api/health" 2>/dev/null && echo up || echo down
  printf 'ai-service %-28s ' "$AI_URL"
  curl -fsS -o /dev/null "$AI_URL/health" 2>/dev/null && echo up || echo down
}

# ── Stopping only what we started ────────────────────────────────────────────
# The PID from `$!` is not the server: `npx next start` is a wrapper, and killing
# it on Windows left the real Next.js server running. So after each service comes
# up, record the process actually LISTENING on its port. `up` refuses a busy port,
# so whatever listens there right after we start it is ours.
#
# `down` stops only those recorded processes, and only if each is still listening
# on the port it was recorded against (a PID the OS has since reused for something
# else is left alone). It never kills "whatever is on the port": that is how an
# earlier version would have stopped a human's own dev servers.
#
# On Linux the kernel's own socket table is read instead of asking lsof. Next.js
# sets its process title to "next-server (v16.2.2)", which /proc truncates to the
# 15-character "next-server (v1" — an unbalanced parenthesis that lsof 4.95 cannot
# parse, so it silently drops the whole process and `lsof -i` never listed the
# frontend at all. Nothing got recorded, `down` never tried, and the leftover
# server was then reported as somebody else's (issue #477).
listening_pids() {
  local port=$1
  if command -v taskkill >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v p=":$port" '$2 ~ p"$" && $4=="LISTENING" {print $5}' | sort -u
  elif [ -r /proc/net/tcp ]; then
    proc_listening_pids "$port"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
  elif command -v ss >/dev/null 2>&1; then
    ss -Hltnp "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
  fi
}

# Linux only. /proc/net/tcp{,6} list every socket with its state (0A = LISTEN)
# and inode; /proc/<pid>/fd/* links back to "socket:[inode]". Only processes
# whose fd table we may read are found — our own, which is all `down` needs.
# `find` exits non-zero whenever some other process's fd table is unreadable, and
# under `pipefail` that status would leak out and make `down`'s `| grep -qx` read
# as "not found", so it is swallowed here: the output is what matters.
proc_listening_pids() {
  local hex inodes
  hex=$(printf '%04X' "$1")
  inodes=$(cat /proc/net/tcp /proc/net/tcp6 2>/dev/null \
    | awk -v p=":$hex" '$4=="0A" && $2 ~ p"$" {print $10}' | tr '\n' ' ')
  [ -n "${inodes// /}" ] || return 0
  { find /proc/[0-9]*/fd -maxdepth 1 -lname 'socket:\[*' -printf '%h %l\n' 2>/dev/null || true; } \
    | awk -v want="$inodes" '
        BEGIN { n = split(want, a, " "); for (i = 1; i <= n; i++) w["socket:[" a[i] "]"] = 1 }
        ($2 in w) { split($1, p, "/"); print p[3] }' \
    | sort -u
}

record_listener() {
  local port=$1 pid found=
  for pid in $(listening_pids "$port"); do echo "$port $pid" >>"$LISTENERS"; found=1; done
  if [ -z "$found" ]; then
    echo "  warning: could not identify the process listening on $port — '$0 down' will not be able to stop it" >&2
  fi
}

stop_pid() {
  local pid=$1
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1
  else
    kill "$pid" 2>/dev/null
  fi
  return 0
}

cmd_down() {
  if [ ! -s "$LISTENERS" ]; then
    echo "Nothing started by stack.sh in this checkout — not touching any process."
    return 0
  fi
  local port pid
  while read -r port pid; do
    if listening_pids "$port" | grep -qx "$pid"; then
      stop_pid "$pid"
      echo "stopped pid $pid on port $port"
    else
      echo "pid $pid is no longer on port $port — left alone"
    fi
  done <"$LISTENERS"
  rm -f "$LISTENERS"
  # Next.js handles SIGTERM by closing the server gracefully, so give the ports a
  # few seconds to free up before deciding something else must own them.
  for _ in 1 2 3 4 5; do
    port_busy "$PORT" || port_busy "$AI_PORT" || break
    sleep 1
  done
  if port_busy "$PORT" || port_busy "$AI_PORT"; then
    echo "Something is still listening on $PORT or $AI_PORT that stack.sh did not start — check it by hand." >&2
    return 1
  fi
  echo "stopped: nothing listening on $PORT or $AI_PORT"
}

case "${1:-}" in
  ports)  cmd_ports ;;
  up)     cmd_up ;;
  status) cmd_status ;;
  down)   cmd_down ;;
  *) echo "usage: $0 {ports|up|status|down}" >&2; exit 2 ;;
esac
