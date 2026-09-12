#!/usr/bin/env bash
# ParkEase Mobile — Dev Start Worker
# Automates: kill stale Metro, clear caches, adb reverse, start Metro, launch app, verify.
# Usage: bash apps/mobile/scripts/dev-start.sh [--rebuild]
#   --rebuild  run expo prebuild --clean before starting (needed after native dep changes)

set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
PACKAGE="in.parkease.app"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[dev-start]${NC} $1"; }
warn() { echo -e "${YELLOW}[dev-start]${NC} $1"; }
err()  { echo -e "${RED}[dev-start]${NC} $1"; }

# --- 1. Kill stale Metro / node processes on port 8081 ---
log "Killing any process on port 8081..."
if command -v npx &>/dev/null; then
  npx --yes kill-port 8081 2>/dev/null || true
else
  # Fallback: kill node processes listening on 8081
  for pid in $(netstat -ano 2>/dev/null | grep ":8081 " | grep LISTEN | awk '{print $5}' | sort -u); do
    taskkill //F //PID "$pid" 2>/dev/null || true
  done
fi

# --- 2. Clear caches ---
log "Clearing Metro and Expo caches..."
cd "$MOBILE_DIR"
rm -rf .expo node_modules/.cache 2>/dev/null || true
rm -rf "$LOCALAPPDATA/Temp/metro-"* "$LOCALAPPDATA/Temp/haste-map-"* 2>/dev/null || true

# --- 3. Check for rogue root tsconfig extending expo ---
if [ -f "$REPO_ROOT/tsconfig.json" ]; then
  if grep -q "expo/tsconfig" "$REPO_ROOT/tsconfig.json" 2>/dev/null; then
    warn "Removing rogue root tsconfig.json (extends expo — confuses Metro)"
    rm "$REPO_ROOT/tsconfig.json"
  fi
fi

# --- 4. Optional: expo prebuild ---
if [[ "${1:-}" == "--rebuild" ]]; then
  log "Running expo prebuild --clean..."
  npx expo prebuild --clean
  # Re-apply Java 17 fix for firebase auth
  if ! grep -q "VERSION_17" "$MOBILE_DIR/android/build.gradle" 2>/dev/null; then
    warn "Re-applying Java 17 source compatibility fix in android/build.gradle"
    cat >> "$MOBILE_DIR/android/build.gradle" <<'GRADLE'

subprojects { subproject ->
  afterEvaluate {
    if (subproject.plugins.hasPlugin('com.android.library') || subproject.plugins.hasPlugin('com.android.application')) {
      subproject.android {
        compileOptions {
          sourceCompatibility JavaVersion.VERSION_17
          targetCompatibility JavaVersion.VERSION_17
        }
      }
    }
  }
}
GRADLE
  fi
  # Ensure local.properties exists
  if [ ! -f "$MOBILE_DIR/android/local.properties" ]; then
    echo "sdk.dir=$LOCALAPPDATA\\\\Android\\\\Sdk" > "$MOBILE_DIR/android/local.properties"
  fi
fi

# --- 5. Verify adb and device ---
log "Checking adb device..."
if ! "$ADB" devices 2>/dev/null | grep -q "device$"; then
  err "No Android device/emulator found. Start one and try again."
  exit 1
fi

# --- 6. Set up adb reverse ---
log "Setting adb reverse tcp:8081..."
"$ADB" reverse tcp:8081 tcp:8081

# --- 7. Start Metro ---
log "Starting Metro bundler with fresh cache..."
cd "$MOBILE_DIR"
npx expo start --dev-client --clear &
METRO_PID=$!

# --- 8. Wait for Metro to be ready ---
log "Waiting for Metro to be ready..."
MAX_WAIT=60
WAITED=0
while ! curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; do
  sleep 2
  WAITED=$((WAITED + 2))
  if [ $WAITED -ge $MAX_WAIT ]; then
    err "Metro did not start within ${MAX_WAIT}s"
    kill $METRO_PID 2>/dev/null || true
    exit 1
  fi
done
log "Metro is ready (took ${WAITED}s)"

# --- 9. Force stop and relaunch app ---
log "Relaunching $PACKAGE..."
"$ADB" shell am force-stop "$PACKAGE"
sleep 1
"$ADB" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 2>/dev/null

# --- 10. Wait for bundle and check for errors ---
log "Waiting for JS bundle to load..."
sleep 15
"$ADB" logcat -c
sleep 3

ERRORS=$("$ADB" logcat -d -s ReactNativeJS 2>&1 | grep -i "error" || true)
if [ -n "$ERRORS" ]; then
  err "JS errors detected:"
  echo "$ERRORS"
  exit 1
else
  log "No JS errors detected"
fi

log "App is running. Metro PID: $METRO_PID"
log "To stop: kill $METRO_PID"

# Keep Metro in foreground
wait $METRO_PID
