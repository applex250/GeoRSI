#!/usr/bin/env bash
# GeoRSI research agent: normal pi chat + /research commands.
# Run from ANY folder: the research scaffold lands in that folder.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" -e "$DIR/extensions/georsi.ts" "$@"
