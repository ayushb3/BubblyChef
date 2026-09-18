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
  wait_for "$AI_URL/health" ai-service 30 || exit 1
  record_listener "$AI_PORT"

  echo "== nextjs production build (AI at $AI_URL)"
  (
    cd "$ROOT/nextjs" || exit 1
    NEXT_PUBLIC_GIT_SHA="$SHA" NEXT_PUBLIC_AI_SERVICE_URL="$AI_URL" npm run build >"$STATE/nextjs-build.log" 2>&1
  ) || { echo "next build failed — see $STATE/nextjs-build.log" >&2; exit 1; }

  echo "== nextjs on $PORT"
  (
    cd "$ROOT/nextjs" || exit 1
    NEXT_PUBLIC_GIT_SHA="$SHA" NEXT_PUBLIC_AI_SERVICE_URL="$AI_URL" nohup npx next start -p "$PORT" \
      >"$STATE/nextjs.log" 2>&1 &
  )
  wait_for "$WEB_URL/api/health" nextjs 60 || exit 1
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
listening_pids() {
  local port=$1
  if command -v taskkill >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v p=":$port" '$2 ~ p"$" && $4=="LISTENING" {print $5}' | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
  elif command -v ss >/dev/null 2>&1; then
    ss -Hltnp "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
  fi
}

record_listener() {
  local port=$1 pid
  for pid in $(listening_pids "$port"); do echo "$port $pid" >>"$LISTENERS"; done
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
  sleep 1
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
