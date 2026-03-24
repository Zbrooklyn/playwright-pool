#!/bin/bash
# autoresearch.sh — run one experiment cycle (benchmark + compare + revert on regression)
#
# Usage: ./scripts/autoresearch.sh [baseline.json]
#
# This script handles the mechanical parts of the autoresearch loop:
#   1. Run a quick benchmark
#   2. Compare against the baseline
#   3. If no regression: update the baseline
#   4. If regression: revert editable source files
#   5. Clean up temp files
#
# The hypothesis, edit, and logging steps are done by the AI agent.

set -e

# Resolve project root (script lives in scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

BASELINE="${1:-baseline.json}"
CURRENT="/tmp/autoresearch-$(date +%s).json"

# Verify baseline exists
if [ ! -f "$BASELINE" ]; then
  echo "ERROR: Baseline file not found: $BASELINE"
  echo "Run: node cli.js benchmark --quick --warmup 1 --runs 5 --output $BASELINE"
  exit 1
fi

# Run benchmark
echo "========================================="
echo "AUTORESEARCH — Benchmark Run"
echo "========================================="
echo "Baseline: $BASELINE"
echo "Output:   $CURRENT"
echo ""
echo "Running benchmark..."
node cli.js benchmark --quick --warmup 1 --runs 3 --output "$CURRENT" 2>&1 | tail -5
echo ""

# Compare
echo "========================================="
echo "AUTORESEARCH — Comparison"
echo "========================================="
set +e
node cli.js benchmark compare "$BASELINE" "$CURRENT" 2>&1
EXIT=$?
set -e

echo ""
echo "========================================="

if [ $EXIT -eq 0 ]; then
  echo "RESULT: No regression detected."
  cp "$CURRENT" "$BASELINE"
  echo "Baseline updated: $BASELINE"
elif [ $EXIT -eq 2 ]; then
  echo "RESULT: REGRESSION DETECTED"
  echo "Reverting changes..."
  git checkout -- server.js cli.js cli-commands/ audit-tools-b.js shared.js 2>/dev/null || true
  echo "Reverted editable source files."
else
  echo "RESULT: Benchmark comparison exited with code $EXIT"
  echo "Check output above for errors."
fi

echo "========================================="

# Clean up
rm -f "$CURRENT"
