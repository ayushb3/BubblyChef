#!/usr/bin/env bash
# usage: scripts/dev/test-node-modules-link.sh
#
# Tests node_modules_is_link (node-modules-link.sh), which decides whether
# stack.sh builds with --webpack (issue #828). Plain bash, no framework; exits
# non-zero if any case fails.
#
# Links are made with node's fs.symlinkSync(..., 'junction'): on Windows that is a
# real junction (what agent worktrees use, needs no privileges, and what
# `ln -s` in Git Bash may silently turn into a copy), and on Linux/macOS the type
# is ignored and it is a plain symlink.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/dev/node-modules-link.sh
. "$DIR/node-modules-link.sh"

TMP=$(mktemp -d)
# Remove links first with rmdir/unlink semantics, never recursively through one:
# `rm -rf` on a directory that holds a junction can follow it and empty the target.
cleanup() {
  local l
  for l in "$TMP"/*/node_modules; do
    if [ -L "$l" ]; then node -e 'require("fs").unlinkSync(process.argv[1])' "$l" 2>/dev/null; fi
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

pass=0
fail=0

# check NAME EXPECTED(yes|no) PATH
check() {
  local name=$1 want=$2 path=$3 got=no
  node_modules_is_link "$path" && got=yes
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    echo "ok   $name"
  else
    fail=$((fail + 1))
    echo "FAIL $name: expected $want, got $got"
  fi
}

mkdir -p "$TMP/shared/pkg" "$TMP/real/node_modules/pkg" "$TMP/linked" "$TMP/missing"
node -e 'require("fs").symlinkSync(process.argv[1], process.argv[2], "junction")' \
  "$TMP/shared" "$TMP/linked/node_modules"
# A dangling link: its target does not exist.
mkdir -p "$TMP/dangling"
node -e 'require("fs").symlinkSync(process.argv[1], process.argv[2], "junction")' \
  "$TMP/nowhere" "$TMP/dangling/node_modules" 2>/dev/null

check "real directory keeps the default build"        no  "$TMP/real/node_modules"
check "junction/symlink to a shared copy is detected" yes "$TMP/linked/node_modules"
check "missing node_modules is not a link"            no  "$TMP/missing/node_modules"
check "dangling link is detected"                     yes "$TMP/dangling/node_modules"

# The link must still be intact: detection never touches it.
if [ -d "$TMP/shared/pkg" ]; then
  pass=$((pass + 1)); echo "ok   shared target untouched"
else
  fail=$((fail + 1)); echo "FAIL shared target was modified"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
