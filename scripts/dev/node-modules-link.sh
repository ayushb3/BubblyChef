#!/usr/bin/env bash
# Sourced by stack.sh (and its test); defines helpers only, runs nothing.
#
# Agent worktrees junction `nextjs/node_modules` to the main checkout's copy on
# purpose: a per-worktree `npm ci` is slow and has collided with other installs.
# Turbopack, the default `next build` bundler, rejects such a link ("Symlink
# [project]/node_modules is invalid, it points out of the filesystem root"), so
# stack.sh builds those worktrees with `--webpack` instead (issue #828). A real
# directory keeps the default build, which is what production deploys use.

# node_modules_is_link PATH — succeeds when PATH itself is a symlink or a Windows
# junction (a linked parent directory does not count).
#
# `[ -L ]` alone is not enough: older Git Bash builds do not report a junction as
# a link. Comparing the physical path (`pwd -P`, which resolves both kinds) with
# the path it would have as a plain directory in its parent catches it either way, and needs
# no cmd.exe / fsutil call, so it also works on Linux and macOS. A missing path is
# "not a link": the build then fails on its own, with its own message.
node_modules_is_link() {
  local nm=$1 parent real
  [ -L "$nm" ] && return 0
  [ -d "$nm" ] || return 1
  parent=$(cd "$(dirname "$nm")" 2>/dev/null && pwd -P) || return 1
  real=$(cd "$nm" 2>/dev/null && pwd -P) || return 1
  [ "$real" != "$parent/$(basename "$nm")" ]
}
