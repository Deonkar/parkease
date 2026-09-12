#!/usr/bin/env bash
# ParkEase Mobile — Dev Verify
# Quick check: is Metro running? Reload app, check for JS errors.
# Usage: bash apps/mobile/scripts/dev-verify.sh

set -euo pipefail

ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
PACKAGE="in.parkease.app"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[dev-verify]${NC} $1"; }
warn() { echo -e "${YELLOW}[dev-verify]${NC} $1"; }
err()  { echo -e "${RED}[dev-verify]${NC} $1"; }

# 1. Check Metro
if ! curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
  err "Metro is not running. Run: bash apps/mobile/scripts/dev-start.sh"
  exit 1
fi
log "Metro is running"

# 2. Check device
if ! "$ADB" devices 2>/dev/null | grep -q "device$"; then
  err "No Android device/emulator connected"
  exit 1
fi
log "Device connected"

# 3. Ensure adb reverse
"$ADB" reverse tcp:8081 tcp:8081

# 4. Clear logcat and reload app
"$ADB" logcat -c
"$ADB" shell am force-stop "$PACKAGE"
sleep 1
"$ADB" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 2>/dev/null
log "App launched, waiting for bundle..."

# 5. Wait for bundle to load and check errors
sleep 15

ERRORS=$("$ADB" logcat -d -s ReactNativeJS 2>&1 | grep -iE "error|uncaught" || true)
if [ -n "$ERRORS" ]; then
  err "JS errors found:"
  echo "$ERRORS"
  exit 1
fi

log "App is running with no JS errors"
exit 0
