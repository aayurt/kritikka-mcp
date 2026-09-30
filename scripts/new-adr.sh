#!/usr/bin/env sh
# Create a new ADR from the template with the next available number.
# Usage: scripts/new-adr.sh "<Title>"
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADR_DIR="$ROOT/docs/adr"
TEMPLATE="$ADR_DIR/0000-template.md"

[ -f "$TEMPLATE" ] || { echo "template missing: $TEMPLATE" >&2; exit 1; }
[ "$#" -eq 1 ] || { echo "usage: $0 \"<Title>\"" >&2; exit 1; }

NEXT="$(printf '%04d' "$(( $(ls "$ADR_DIR" | grep -E '^[0-9]{4}-' | sed 's/-.*//' | sort -n | tail -1) + 1 ))")"
SLUG="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c '[:lower:][:digit:]' '-' | sed -e 's/-\+/-/g' -e 's/^-//' -e 's/-$//')"
OUT="$ADR_DIR/$NEXT-$SLUG.md"

sed -e "s/<Title>/$1/g" -e 's/^status: template$/status: proposed/' -e "s/^date: 1970-01-01$/date: $(date +%F)/" "$TEMPLATE" > "$OUT"
echo "created $OUT (status: proposed)"
