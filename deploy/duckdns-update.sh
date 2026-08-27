#!/usr/bin/env bash
# DuckDNS dynamic DNS updater for market-replay.
#
# Tells DuckDNS to point the configured domain(s) at this server's public IP
# (source IP of the request — no external IP lookup needed, works behind NAT).
# Run it from the systemd timer deploy/duckdns-update.timer every 5 minutes,
# or manually:
#   ./duckdns-update.sh [/path/to/duckdns.conf]
#
# Config file format (one per line, '=' separated; file must be root-only):
#   token=<your DuckDNS token>
#   duckdns=<your subdomain>.duckdns.org   # may repeat for multiple domains
#
# The token is a SECRET. The config file lives at /etc/duckdns/duckdns.conf
# on the server with chmod 600 root:root, and is NEVER committed to git
# (see .gitignore). Alternative: export DUCKDNS_TOKEN / DUCKDNS_DOMAINS in
# the systemd unit's Environment= line instead of a config file.

set -euo pipefail

CONF="${1:-/etc/duckdns/duckdns.conf}"

# Allow env override (systemd Environment=) so the config file can be skipped.
TOKEN="${DUCKDNS_TOKEN:-}"
DOMAINS="${DUCKDNS_DOMAINS:-}"

if [[ -z "$TOKEN" || -z "$DOMAINS" ]] && [[ -r "$CONF" ]]; then
  # The `|| [[ -n "$key" ]]` guard makes `while read` process the final line
  # even when the file lacks a trailing newline (read exits 1 at EOF).
  while IFS='=' read -r key val || [[ -n "$key" ]]; do
    case "$key" in
      token)   TOKEN="$val" ;;
      duckdns) DOMAINS="$DOMAINS${DOMAINS:+,}$val" ;;
    esac
  done < "$CONF"
fi

log() { printf '%s duckdns: %s\n' "$(date -Is)" "$*"; }

[[ -n "$TOKEN" ]]  || { log "ERROR: token missing (set ${CONF} or DUCKDNS_TOKEN)"        >&2; exit 1; }
[[ -n "$DOMAINS" ]] || { log "ERROR: domain missing (set ${CONF} or DUCKDNS_DOMAINS)"   >&2; exit 1; }

resp="$(curl -sS --max-time 15 \
  "https://www.duckdns.org/update?domains=${DOMAINS}&token=${TOKEN}&ip=")" \
  || { log "ERROR: curl failed ($?)" >&2; exit 1; }

case "$resp" in
  OK|NOCHG) log "$DOMAINS -> $resp" ;;
  *)        log "ERROR: DuckDNS rejected update: $resp" >&2; exit 1 ;;
esac