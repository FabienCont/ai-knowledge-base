#!/usr/bin/env bash
set -euo pipefail

echo "=== AI Knowledge Base Smoke Test ==="

# Prerequisites: jq must be installed
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install it with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# 1. Infrastructure check
echo "[1/5] Checking infrastructure..."
curl -sf http://localhost:6333/healthz > /dev/null && echo "  ✓ Qdrant"
curl -sf http://localhost:7474 > /dev/null && echo "  ✓ Neo4j"

# 2. Build
echo "[2/5] Building..."
pnpm -r build

# 3. Vector ingest
echo "[3/5] Vector ingest..."
node apps/cli/dist/bin/aikb.js vector ingest --root docs --json

# 4. Vector query
echo "[4/5] Vector query..."
node apps/cli/dist/bin/aikb.js vector query "getting started" --top-k 3 --json

# 5. Session
echo "[5/5] Session test..."
SESSION=$(node apps/cli/dist/bin/aikb.js session start --json | jq -r '.id')
node apps/cli/dist/bin/aikb.js session add "$SESSION" --role user "Test message"
node apps/cli/dist/bin/aikb.js session show "$SESSION" --json

echo ""
echo "=== Smoke test passed! ==="
