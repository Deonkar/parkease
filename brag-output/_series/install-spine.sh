#!/usr/bin/env bash
# Copy the series spine (sting + end card + fonts) into a HyperFrames project,
# stamped with the project's canvas size: a sub-composition lays itself out at its
# own declared data-width/height, not the host's, so a 1080x1920 spine inside a
# 1920x1080 video renders as a portrait box.
# Usage: bash brag-output/_series/install-spine.sh <project-dir> <width> <height>
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:?usage: install-spine.sh <project-dir> <width> <height>}"
W="${2:?width}"; H="${3:?height}"
mkdir -p "$DEST/compositions" "$DEST/fonts"
for f in sting endcard; do
  sed -E "s/data-width=\"[0-9]+\" data-height=\"[0-9]+\"/data-width=\"$W\" data-height=\"$H\"/" \
    "$SRC/compositions/$f.html" > "$DEST/compositions/$f.html"
done
cp "$SRC/fonts/"* "$DEST/fonts/"
echo "spine ${W}x${H} installed into $DEST"
