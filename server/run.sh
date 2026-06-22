#!/usr/bin/env bash
# Convenience launcher for the NST local AI optimization server.
# Usage: ./run.sh [port]
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-${NST_PORT:-31314}}"
exec python3 nst_server.py --port "$PORT"
