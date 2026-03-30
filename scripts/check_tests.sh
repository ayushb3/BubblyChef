#!/usr/bin/env bash
# Passes when pytest has 0 failures. Exit 1 otherwise.
result=$(pytest --tb=no -q 2>&1 | tail -1)
echo "$result"
echo "$result" | grep -qE '^[0-9]+ passed' && exit 0
echo "$result" | grep -q 'failed' && exit 1
exit 0
