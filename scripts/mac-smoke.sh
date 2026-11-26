#!/usr/bin/env bash
# Smoke test for macOS (also works on Linux/Windows-bash). Run on a Mac with Obsidian installed:
#   npm ci && npm run release && ./scripts/mac-smoke.sh
# It uses a temporary vault and profile only; your real vault is never opened.
set -euo pipefail
cd "$(dirname "$0")/.."
export OBSIDIAN_BIN="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/Obsidian}"
[ -x "$OBSIDIAN_BIN" ] || { echo "Obsidian not found at $OBSIDIAN_BIN (set OBSIDIAN_BIN)"; exit 2; }
export CA_E2E_FROM_RELEASE=1
node tests/e2e/smoke.mjs
SMOKE_CORRUPT_SRD=1 node tests/e2e/smoke.mjs
echo "Results: tests/e2e/out/smoke-$(node -p 'process.platform').json"
