#!/bin/zsh

set -euo pipefail

export PATH="/Users/arnav/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

readonly script_path="${0:A}"
readonly repo_root="${script_path:h:h}"
readonly output_root="$repo_root/outputs/background-lite-local"
readonly stdout_path="$output_root/background-lite-detached.out"
readonly stderr_path="$output_root/background-lite-detached.err"
readonly node_bin="/Users/arnav/.local/bin/node"
readonly cli_path="$repo_root/scripts/local-background-lite.mjs"
readonly screen_name="amble-background-lite"

worker() {
  mkdir -p "$output_root"
  cd "$repo_root"
  exec "$node_bin" "$cli_path" build \
    --output "$output_root" \
    --batch-size 20 \
    --concurrency 4 \
    --reserve-bytes 4294967296 \
    >>"$stdout_path" 2>>"$stderr_path"
}

status() {
  local sessions
  sessions="$(/usr/bin/screen -list 2>/dev/null || true)"
  if [[ "$sessions" == *".$screen_name"* ]]; then
    echo "running in detached screen session: $screen_name"
    printf 'completed tiles: '
    find "$output_root/background-lite" -type f -name '*.b3dm' 2>/dev/null | wc -l | tr -d ' '
    printf '\n'
    return 0
  fi
  echo "not running"
  return 1
}

case "${1:-status}" in
  start)
    mkdir -p "$output_root"
    /usr/bin/screen -S "$screen_name" -X quit >/dev/null 2>&1 || true
    /usr/bin/screen -DmS "$screen_name" /bin/zsh "$script_path" worker
    sleep 2
    status
    ;;
  status)
    status
    ;;
  stop)
    /usr/bin/screen -S "$screen_name" -X quit
    echo "stopped; completed batches remain checkpointed"
    ;;
  worker)
    worker
    ;;
  *)
    echo "usage: $0 {start|status|stop}" >&2
    exit 64
    ;;
esac
