#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
port="${PORT:-8080}"
if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
  echo "Invalid preview PORT" >&2
  exit 1
fi

base="http://127.0.0.1:$port"
state_dir="${TMPDIR:-/tmp}/route-agent-preview-$(id -u)"
mkdir -p -m 700 -- "$state_dir"
log="$state_dir/$port.log"
exec 9>"$state_dir/$port.lock"
flock -w 12 9

is_ready() {
  local html
  html="$(curl -fsS --max-time 2 "$base/" 2>/dev/null)" &&
    [[ "$html" == *'id="workspace"'* && "$html" == *'src="/app.js"'* ]]
}

if is_ready; then
  echo "Route Agent preview already ready at $base"
  exit 0
fi

if [[ -n "$(ss -H -ltn "sport = :$port")" ]]; then
  echo "$base is already occupied. Inspect the listener before restarting." >&2
  exit 1
fi

node --check serve.cjs
PORT="$port" nohup node serve.cjs >"$log" 2>&1 < /dev/null 9>&- &
for attempt in {1..20}; do
  if is_ready; then
    echo "Route Agent preview ready at $base"
    exit 0
  fi
  sleep .25
done

echo "Route Agent preview failed its readiness check. See $log" >&2
exit 1
