#!/usr/bin/env bash
# usage: scripts/dev/test-stack-port-check.sh
#
# Tests stack.sh's port handling (issue #870): `up` must refuse a port another
# process already holds and name that process's PID, and must not report success
# when a service it started lost the bind race. Plain bash, no framework; exits
# non-zero if any case fails.
#
# The `up` cases run the real script in a throwaway git repo (stack.sh derives its
# ports from the repo path) with a real listener pre-bound to one of its ports.
# `up` has to refuse before it starts anything, so no build or server runs.
# The PID-lookup cases source stack.sh and stub netstat/lsof/ss on PATH, so every
# platform's lookup path is exercised on any machine (STACK_PORT_TOOL picks one).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"

TMP=$(mktemp -d)
HOLDERS=()
cleanup() {
  local p
  for p in ${HOLDERS[@]+"${HOLDERS[@]}"}; do
    kill "$p" 2>/dev/null
    if command -v taskkill >/dev/null 2>&1; then taskkill //F //PID "$p" >/dev/null 2>&1; fi
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

pass=0
fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1${2:+: $2}"; }

# new_repo NAME: a git repo holding a copy of scripts/dev, with free stack ports.
# Sets REPO, PORT, AI_PORT. Ports follow the repo path, so retry on the rare clash.
new_repo() {
  local n
  for n in $(seq 20); do
    REPO="$TMP/$1-$n"
    mkdir -p "$REPO/scripts/dev"
    cp "$DIR"/stack.sh "$DIR"/node-modules-link.sh "$REPO/scripts/dev/"
    git -C "$REPO" init -q 2>/dev/null
    git -C "$REPO" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init 2>/dev/null
    eval "$(cd "$REPO" && bash scripts/dev/stack.sh ports | grep -E '^export (PORT|AI_PORT)=')"
    PORT=${PORT:?} AI_PORT=${AI_PORT:?}
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then continue; fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$AI_PORT") 2>/dev/null; then continue; fi
    return 0
  done
  echo "could not find free stack ports" >&2; exit 2
}

# hold_port PORT: bind a real listener; sets HOLDER_PID to its (OS-level) pid.
hold_port() {
  local f="$TMP/holder-$1.pid" i
  rm -f "$f"
  node -e 'require("net").createServer().listen(+process.argv[1], "127.0.0.1", () => {
    require("fs").writeFileSync(process.argv[2], String(process.pid)); });
    setTimeout(() => process.exit(0), 120000)' "$1" "$f" &
  HOLDERS+=("$!")
  for i in $(seq 50); do [ -s "$f" ] && break; sleep 0.2; done
  HOLDER_PID=$(cat "$f" 2>/dev/null)
  [ -n "$HOLDER_PID" ] || { echo "listener never came up on $1" >&2; exit 2; }
  HOLDERS+=("$HOLDER_PID")
}

# ── up refuses a held port and names the holder ──────────────────────────────
for which in PORT AI_PORT; do
  new_repo "up-$which"
  eval "target=\$$which"
  hold_port "$target"
  out=$(cd "$REPO" && timeout 60 bash scripts/dev/stack.sh up 2>&1); code=$?
  name="up with $which held"
  if [ "$code" -ne 0 ]; then ok "$name: exits non-zero"; else bad "$name: exits non-zero" "exit $code"; fi
  case "$out" in
    *"$target"*"already in use"*) ok "$name: says the port is in use" ;;
    *) bad "$name: says the port is in use" "$out" ;;
  esac
  case "$out" in
    *"pid $HOLDER_PID"*) ok "$name: names the holder's pid ($HOLDER_PID)" ;;
    *) bad "$name: names the holder's pid ($HOLDER_PID)" "$out" ;;
  esac
  case "$out" in
    *"Stack is up"*) bad "$name: no success message" ;;
    *) ok "$name: no success message" ;;
  esac
  # Nothing was started, so nothing may be recorded for `down` to stop.
  if [ -s "$REPO/.verify/listeners" ]; then bad "$name: records no listeners"; else ok "$name: records no listeners"; fi
  if [ -e "$REPO/.verify/ai-service.log" ]; then bad "$name: starts no service"; else ok "$name: starts no service"; fi
done

# ── each platform's pid lookup, via stubbed tools ────────────────────────────
STUBS="$TMP/stubs"; mkdir -p "$STUBS"
cat >"$STUBS/netstat" <<'STUB'
#!/bin/sh
cat <<'OUT'

Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:4070           0.0.0.0:0              LISTENING       4242
  TCP    [::]:4070              [::]:0                 LISTENING       4242
  TCP    127.0.0.1:4070         127.0.0.1:51000        ESTABLISHED     999
  TCP    0.0.0.0:14070          0.0.0.0:0              LISTENING       555
  TCP    0.0.0.0:4071           0.0.0.0:0              LISTENING       777
OUT
STUB
cat >"$STUBS/lsof" <<'STUB'
#!/bin/sh
echo 7001
STUB
cat >"$STUBS/ss" <<'STUB'
#!/bin/sh
echo 'LISTEN 0 511 127.0.0.1:4070 0.0.0.0:* users:(("node",pid=7002,fd=22))'
STUB
chmod +x "$STUBS"/*

new_repo lookup
# lookup TOOL PORT: what listening_pids prints for that tool.
lookup() {
  (cd "$REPO" && PATH="$STUBS:$PATH" STACK_PORT_TOOL=$1 bash -c ". scripts/dev/stack.sh; listening_pids $2") 2>/dev/null | tr '\n' ' '
}
got=$(lookup netstat 4070)
if [ "$got" = "4242 " ]; then ok "netstat path: listener only, not ESTABLISHED or a longer port"; else bad "netstat path" "'$got'"; fi
got=$(lookup netstat 4072)
if [ "$got" = "" ]; then ok "netstat path: free port has no holder"; else bad "netstat free port" "'$got'"; fi
got=$(lookup lsof 4070)
if [ "$got" = "7001 " ]; then ok "lsof path"; else bad "lsof path" "'$got'"; fi
got=$(lookup ss 4070)
if [ "$got" = "7002 " ]; then ok "ss path"; else bad "ss path" "'$got'"; fi
got=$(lookup none 4070)
if [ "$got" = "" ]; then ok "no tool available: no holder, no crash"; else bad "no tool" "'$got'"; fi

# ── a holder the socket probe cannot see is still refused, with its pid ─────
# (a listener bound to another interface answers no /dev/tcp probe on 127.0.0.1,
# but the process table still shows it)
out=$(cd "$REPO" && PATH="$STUBS:$PATH" STACK_PORT_TOOL=netstat bash -c '
  . scripts/dev/stack.sh; PORT=4070; AI_PORT=4071
  port_listening() { return 1; }     # the socket probe sees nothing
  cmd_up' 2>&1); code=$?
if [ "$code" -eq 1 ]; then ok "held only on another interface: refused"; else bad "held only on another interface: refused" "exit $code"; fi
case "$out" in
  *"pid 4242"*) ok "held only on another interface: names pid 4242" ;;
  *) bad "held only on another interface: names pid 4242" "$out" ;;
esac

# ── up must not report success when a service lost the bind race ─────────────
# Both ports were free at the pre-check, a third process took one before the
# service bound it, the service logged the bind failure, and the health check
# was then answered by the other process. confirm_listener reads the log.
race() {
  (cd "$REPO" && STACK_PORT_TOOL=netstat PATH="$STUBS:$PATH" bash -c ". scripts/dev/stack.sh; $1") 2>&1
}
printf 'Error: listen EADDRINUSE: address already in use :::4070\n' >"$TMP/next.log"
out=$(race "confirm_listener nextjs 4070 $TMP/next.log"); code=$?
if [ "$code" -eq 1 ]; then ok "EADDRINUSE in the service log fails the start"; else bad "EADDRINUSE fails the start" "exit $code"; fi
case "$out" in
  *4070*"another process"*) ok "...and says another process holds the port" ;;
  *) bad "says another process holds the port" "$out" ;;
esac
printf 'ERROR: [Errno 10048] error while attempting to bind on address (127.0.0.1, 4070)\n' >"$TMP/ai.log"
race "confirm_listener ai-service 4070 $TMP/ai.log" >/dev/null; code=$?
if [ "$code" -eq 1 ]; then ok "uvicorn bind error in the log fails the start"; else bad "uvicorn bind error fails the start" "exit $code"; fi
printf 'Ready in 400ms\n' >"$TMP/clean.log"
race "confirm_listener nextjs 4070 $TMP/clean.log" >/dev/null; code=$?
if [ "$code" -eq 0 ]; then ok "a clean log passes"; else bad "a clean log passes" "exit $code"; fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
