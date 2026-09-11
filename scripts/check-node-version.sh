#!/usr/bin/env bash
set -euo pipefail

NVMRC="$(tr -d '[:space:]' < .nvmrc)"

grep -q "node:${NVMRC}-alpine" apps/api/Dockerfile \
  || { echo "apps/api/Dockerfile does not pin node:${NVMRC}-alpine"; exit 1; }

grep -q "node:${NVMRC}-alpine" apps/worker/Dockerfile \
  || { echo "apps/worker/Dockerfile does not pin node:${NVMRC}-alpine"; exit 1; }

NVMRC="$NVMRC" node -e "
  const major = require('./package.json').engines.node.split('.')[0];
  if (!process.env.NVMRC.startsWith(major)) {
    throw new Error('engines.node does not match .nvmrc');
  }
"

echo "Node version check passed: ${NVMRC}"
