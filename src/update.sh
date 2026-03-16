#!/usr/bin/env bash
# Deprecated — use deploy.sh (includes restart) or restart.sh (restart only)
exec "$(dirname "$0")/deploy.sh" "$@"
