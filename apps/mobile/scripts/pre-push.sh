#!/usr/bin/env bash
# ParkEase Mobile — Pre-Push Verification Worker
# Runs the full verification chain before pushing mobile changes.
# Usage: bash apps/mobile/scripts/pre-push.sh
#
# Steps:
#   1. Lint + Typecheck (all mobile deps)
#   2. App verification on device (Metro + adb + JS error check)
#   3. Reminder to update learnings.md and testcases.md
#   4. Git status summary
#
# Exit codes:
#   0 = all checks passed, safe to push
#   1 = a check failed, do NOT push

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
PACKAGE="in.parkease.app"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[pre-push]${NC} $1"; }
warn()  { echo -e "${YELLOW}[pre-push]${NC} $1"; }
err()   { echo -e "${RED}[pre-push]${NC} $1"; }
info()  { echo -e "${BLUE}[pre-push]${NC} $1"; }

FAILED=0

# ─── Step 1: Lint + Typecheck ─────────────────────────────────────────
log "Step 1/4: Running lint + typecheck..."
cd "$REPO_ROOT"
if pnpm turbo run lint typecheck --filter=@parkease/mobile... 2>&1 | tail -5; then
  log "Lint + typecheck passed"
else
  err "Lint or typecheck FAILED"
  FAILED=1
fi

# ─── Step 2: App verification on device ───────────────────────────────
log "Step 2/4: Verifying app on device..."

# Check Metro
if ! curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
  warn "Metro is not running — starting it..."
  cd "$MOBILE_DIR"
  rm -rf .expo node_modules/.cache 2>/dev/null || true

  # Check for rogue root tsconfig
  if [ -f "$REPO_ROOT/tsconfig.json" ] && grep -q "expo/tsconfig" "$REPO_ROOT/tsconfig.json" 2>/dev/null; then
    warn "Removing rogue root tsconfig.json"
    rm "$REPO_ROOT/tsconfig.json"
  fi

  npx expo start --dev-client --clear &
  METRO_PID=$!
  MAX_WAIT=60
  WAITED=0
  while ! curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; do
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $WAITED -ge $MAX_WAIT ]; then
      err "Metro did not start within ${MAX_WAIT}s"
      FAILED=1
      break
    fi
  done
  if [ $WAITED -lt $MAX_WAIT ]; then
    log "Metro started (took ${WAITED}s)"
  fi
fi

# Check device
if ! "$ADB" devices 2>/dev/null | grep -q "device$"; then
  warn "No Android device/emulator connected — skipping device verification"
  warn "Start an emulator and re-run to verify on device"
else
  # Ensure adb reverse
  "$ADB" reverse tcp:8081 tcp:8081

  # Clear logcat, launch app
  "$ADB" logcat -c
  "$ADB" shell am force-stop "$PACKAGE" 2>/dev/null || true
  sleep 1
  "$ADB" shell am start -n "$PACKAGE/.MainActivity" 2>/dev/null || true
  log "App launched, waiting for bundle..."
  sleep 15

  # Check for JS errors
  ERRORS=$("$ADB" logcat -d -s ReactNativeJS 2>&1 | grep -iE "error|uncaught" || true)
  if [ -n "$ERRORS" ]; then
    err "JS errors detected on device:"
    echo "$ERRORS"
    FAILED=1
  else
    log "App running with no JS errors"
  fi
fi

# ─── Step 3: File update reminders ───────────────────────────────────
log "Step 3/4: Checking documentation..."

# Check if learnings.md was modified but not staged
cd "$REPO_ROOT"
if git diff --name-only 2>/dev/null | grep -q "learnings.md"; then
  info "learnings.md has unstaged changes — remember to keep it updated"
fi

# Check if testcases.md has the current task's section
if ! grep -q "Task 05" docs/testcases.md 2>/dev/null; then
  warn "docs/testcases.md does not have Task 05 entries — update before shipping"
fi

# ─── Step 4: Git status summary ──────────────────────────────────────
log "Step 4/4: Git status..."
echo ""
git status --short
echo ""

# ─── Result ───────────────────────────────────────────────────────────
if [ $FAILED -eq 0 ]; then
  log "All checks passed. Safe to push."
  exit 0
else
  err "Some checks FAILED. Fix issues before pushing."
  exit 1
fi
