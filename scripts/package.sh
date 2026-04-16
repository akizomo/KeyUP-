#!/usr/bin/env bash
# Build a Chrome Web Store upload zip for Key↑.
# Excludes LP / docs, build artifacts, tooling configs, and VCS metadata.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(grep -E '"version"' manifest.json | head -1 | sed -E 's/.*"([0-9][^"]*)".*/\1/')"
OUT_DIR="$ROOT/dist"
OUT_ZIP="$OUT_DIR/keyup-$VERSION.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_ZIP"

# Build a staging copy so we can freely delete files without affecting the
# working tree.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

# rsync with excludes — everything that is NOT part of the extension runtime.
rsync -a \
  --exclude '.git' \
  --exclude '.gitignore' \
  --exclude '.claude' \
  --exclude '.vscode' \
  --exclude '.idea' \
  --exclude '.DS_Store' \
  --exclude 'docs' \
  --exclude 'scripts' \
  --exclude 'dist' \
  --exclude 'vercel.json' \
  --exclude 'README.md' \
  --exclude 'CREDITS.md' \
  --exclude '**/*.map' \
  --exclude '**/*.log' \
  --exclude 'assets/CREDITS.md' \
  --exclude 'assets/keyup-icon-src.svg' \
  ./ "$STAGING/"

(cd "$STAGING" && zip -r -q "$OUT_ZIP" .)

echo "✔ $OUT_ZIP"
ls -la "$OUT_ZIP"
unzip -l "$OUT_ZIP" | tail -20
