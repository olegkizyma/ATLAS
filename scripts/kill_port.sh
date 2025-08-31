#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") <port> [port2 port3 ...]"
  exit 1
}

[[ ${1:-} =~ ^[0-9]+$ ]] || usage

kill_with_pids() {
  local pids=("$@")
  if (( ${#pids[@]} == 0 )); then
    return 0
  fi
  echo "TERM: ${pids[*]}"
  kill -TERM "${pids[@]}" 2>/dev/null || true
  sleep 2
  echo "KILL: ${pids[*]}"
  kill -KILL "${pids[@]}" 2>/dev/null || true
}

find_pids_lsof() {
  local port=$1
  # Include listeners and connections bound to the port
  lsof -ti tcp:"$port" 2>/dev/null | tr '\n' ' '
}

find_pids_fuser() {
  local port=$1
  # fuser prints PIDs on stdout
  fuser -n tcp "$port" 2>/dev/null | tr '\n' ' '
}

for port in "$@"; do
  if ! [[ $port =~ ^[0-9]+$ ]]; then
    echo "Skip invalid port: $port" >&2
    continue
  fi
  echo "==> Freeing port $port"

  pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(find_pids_lsof "$port")
  elif command -v fuser >/dev/null 2>&1; then
    pids=$(find_pids_fuser "$port")
  fi

  if [[ -z "${pids// }" ]]; then
    echo "No processes found on port $port"
    continue
  fi

  # shellcheck disable=SC2206
  pids_arr=($pids)
  echo "Found: ${pids_arr[*]}"
  kill_with_pids "${pids_arr[@]}"

  # Final check
  if command -v lsof >/dev/null 2>&1 && lsof -i tcp:"$port" -n -P | grep -q ":$port"; then
    echo "WARNING: Port $port still in use"
    exit_code=1
  else
    echo "Port $port is now free"
  fi
done

exit ${exit_code:-0}
