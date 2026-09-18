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
# The main checkout keeps the familiar 3000/8888. Every other worktree gets a slot
# derived from its path, so the same worktree always gets the same ports and two
# worktrees almost never share one. Collisions are still possible (50 slots), so
# `up` refuses to start on a port that is already answering.
slot() {
  local main
  main=$(git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{print $2; exit}')
  if [ "$(cd "$ROOT" && pwd -P)" = "$(cd "$main" && pwd -P)" ]; then
    echo 0
    return
  fi
  local h
  h=$(printf '%s' "$ROOT" | cksum | awk '{print $1}')
  echo $(( (h % 50) + 1 ))
}

SLOT=$(slot)
PORT=$(( 3000 + SLOT * 10 ))
AI_PORT=$(( 8888 + SLOT * 10 ))
SHA=$(git -C "$ROOT" rev-parse HEAD)
WEB_URL="http://localhost:$PORT"
AI_URL="http://localhost:$AI_PORT"

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- 3<&- 2>/dev/null; }

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
      echo "Port $p is already in use. Run '$0 down', or free the port, then retry." >&2
      exit 1
    fi
  done

  echo "== ai-service on $AI_PORT"
  (
    cd "$ROOT/ai-service" || exit 1
    BUBBLY_GIT_SHA="$SHA" \
    BUBBLY_CORS_ORIGINS="[\"$WEB_URL\",\"http://127.0.0.1:$PORT\"]" \
      nohup python -m uvicorn bubbly_chef.main:app --host 127.0.0.1 --port "$AI_PORT" \
      >"$STATE/ai-service.log" 2>&1 &
    echo $! >"$STATE/ai-service.pid"
  )
  wait_for "$AI_URL/health" ai-service 30 || exit 1

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
    echo $! >"$STATE/nextjs.pid"
  )
  wait_for "$WEB_URL/api/health" nextjs 60 || exit 1

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

# Stop whatever is LISTENING on a port. The recorded PID is not enough: `npx next
# start` is a wrapper, and on Windows killing it left the real Next.js server
# running on the port (found by testing `down`). Killing by port also cleans up
# after a crashed or half-finished `up` that never wrote a PID file.
kill_port() {
  local port=$1 pids
  if command -v taskkill >/dev/null 2>&1; then
    pids=$(netstat -ano 2>/dev/null | awk -v p=":$port" '$2 ~ p"$" && $4=="LISTENING" {print $5}' | sort -u)
    for pid in $pids; do taskkill //F //T //PID "$pid" >/dev/null 2>&1; done
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "$port/tcp" >/dev/null 2>&1
  elif command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null)
    [ -n "$pids" ] && kill $pids 2>/dev/null
  fi
  return 0
}

cmd_down() {
  kill_port "$PORT"
  kill_port "$AI_PORT"
  rm -f "$STATE/nextjs.pid" "$STATE/ai-service.pid"
  sleep 1
  if port_busy "$PORT" || port_busy "$AI_PORT"; then
    echo "Something is still listening on $PORT or $AI_PORT — check it by hand." >&2
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
