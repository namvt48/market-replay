#!/usr/bin/env bash
# Control script for the market-replay docker-compose service.
# Usage: market-replay.sh {start|stop|restart|status|health|logs}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
SERVICE="app"
HEALTH_URL="http://127.0.0.1:${HOST_PORT:-8080}/healthz"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
  start|up)
    compose up -d
    ;;
  stop|down)
    compose stop
    ;;
  restart)
    compose restart
    ;;
  status|ps)
    compose ps
    ;;
  health)
    cid="$(compose ps -q "$SERVICE")"
    if [ -z "$cid" ]; then
      echo "container: not running" >&2
      exit 1
    fi
    status="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "unknown")"
    echo "container: $status"
    if body="$(curl -fsS -m 3 "$HEALTH_URL")"; then
      echo "http:      $body"
    else
      echo "http:      unreachable ($HEALTH_URL)" >&2
      exit 1
    fi
    ;;
  logs)
    compose logs -f --tail=200 "$SERVICE" "$@"
    ;;
  *)
    echo "Usage: $(basename "$0") {start|stop|restart|status|health|logs}" >&2
    exit 1
    ;;
esac
