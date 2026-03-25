#!/usr/bin/env bash
set -euo pipefail

model="claude-sonnet-4-6"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) n="$2"; shift 2 ;;
    -m) model="$2"; shift 2 ;;
    *)  prompt="$1"; shift ;;
  esac
done

: "${n:?Missing -n <count>}"
: "${prompt:?Missing prompt argument}"

for i in $(seq 1 "$n"); do
  claude --dangerously-skip-permissions -p --model "$model" "$prompt" > "proposal_$i.md" &
done
wait
