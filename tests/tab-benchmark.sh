#!/bin/bash
# Tab Management Benchmark — Correctness + Speed
# Tests: open, close by URL, close by index, batch open, batch close, rapid fire

CLI="node cli.js"
PASS=0
FAIL=0
TOTAL_START=$(date +%s%N)

# Helper: count tabs and compare to expected
check_tabs() {
  local expected=$1
  local label=$2
  local result=$($CLI browser tabs 2>&1)
  local count=$(echo "$result" | head -1 | grep -oP '^\d+')
  if [ "$count" = "$expected" ]; then
    echo "  ✓ $label — $count tabs (expected $expected)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label — got $count tabs, expected $expected"
    echo "    $result"
    FAIL=$((FAIL + 1))
  fi
}

# Helper: timed operation
timed() {
  local label=$1
  shift
  local start=$(date +%s%N)
  "$@" > /dev/null 2>&1
  local end=$(date +%s%N)
  local ms=$(( (end - start) / 1000000 ))
  echo "  ${ms}ms — $label"
}

echo "═══════════════════════════════════════════════════════"
echo "  PLAYWRIGHT POOL — TAB MANAGEMENT BENCHMARK"
echo "═══════════════════════════════════════════════════════"
echo ""

# Setup
rm -f "$HOME/.playwright-pool/cli-state.json"
powershell -Command "Get-Process | Where-Object { \$_.Path -like '*chromium*' } | Stop-Process -Force" 2>/dev/null
sleep 1

echo "▸ Launching browser..."
$CLI browser launch > /dev/null 2>&1 &
for i in $(seq 1 30); do
  sleep 0.5
  [ -f "$HOME/.playwright-pool/cli-state.json" ] && break
done
sleep 1
echo "  Browser ready."
echo ""

# ─── PART 1: CORRECTNESS TEST ───────────────────────────
echo "═══ PART 1: CORRECTNESS ═══"
echo ""

echo "▸ Task 1: Open tab 1 (example.com)"
$CLI browser navigate "https://example.com" 2>&1 | grep "Title:"
sleep 0.3
check_tabs 1 "After opening 1 tab"

echo "▸ Task 2: Open tab 2 (google.com) — new tab"
$CLI browser navigate "https://www.google.com" --new-tab 2>&1 | grep "Title:"
sleep 0.3
check_tabs 2 "After opening 2nd tab"

echo "▸ Task 3: Open tab 3 (wikipedia) — new tab"
$CLI browser navigate "https://en.wikipedia.org" --new-tab 2>&1 | grep "Title:"
sleep 0.3
check_tabs 3 "After opening 3rd tab"

echo "▸ Task 4: Close 2nd tab (google)"
$CLI browser close google 2>&1 | grep "Closed"
sleep 0.3
check_tabs 2 "After closing google"

echo "▸ Task 5: Open tab 4 (httpbin) — new tab"
$CLI browser navigate "https://httpbin.org" --new-tab 2>&1 | grep "Title:"
sleep 0.3
check_tabs 3 "After opening httpbin"

echo "▸ Task 6: Close tab by index 0"
$CLI browser close 0 2>&1 | grep "Closed"
sleep 0.3
check_tabs 2 "After closing index 0"

echo "▸ Task 7: Open 2 more tabs"
$CLI browser navigate "https://jsonplaceholder.typicode.com" --new-tab 2>&1 | grep "Title:"
sleep 0.3
$CLI browser navigate "https://example.org" --new-tab 2>&1 | grep "Title:"
sleep 0.3
check_tabs 4 "After opening 2 more"

echo "▸ Task 8: Batch open 3 tabs (sequential)"
$CLI browser navigate "https://www.bing.com" --new-tab 2>&1 | grep "Title:"
sleep 0.3
$CLI browser navigate "https://duckduckgo.com" --new-tab 2>&1 | grep "Title:"
sleep 0.3
$CLI browser navigate "https://www.yahoo.com" --new-tab 2>&1 | grep "Title:"
sleep 0.3
check_tabs 7 "After batch open 3"

echo "▸ Task 9: Close 4 tabs (httpbin, example.org, bing, yahoo)"
$CLI browser close httpbin 2>&1 | grep -E "Closed|No tab"
sleep 0.3
$CLI browser close example.org 2>&1 | grep -E "Closed|No tab"
sleep 0.3
$CLI browser close bing 2>&1 | grep -E "Closed|No tab"
sleep 0.3
$CLI browser close yahoo 2>&1 | grep -E "Closed|No tab"
sleep 0.3
check_tabs 3 "After closing 4 tabs"

echo "▸ Task 10: Verify remaining tabs"
$CLI browser tabs 2>&1
sleep 0.3

echo "▸ Task 11: Close all remaining"
$CLI browser close all 2>&1
sleep 1

echo ""
echo "─── Correctness Results ───"
echo "  Passed: $PASS / $((PASS + FAIL))"
echo "  Failed: $FAIL / $((PASS + FAIL))"
echo ""

# ─── PART 2: SPEED TEST ─────────────────────────────────
echo "═══ PART 2: SPEED TEST ═══"
echo ""

# Relaunch browser
rm -f "$HOME/.playwright-pool/cli-state.json"
$CLI browser launch > /dev/null 2>&1 &
for i in $(seq 1 30); do
  sleep 0.5
  [ -f "$HOME/.playwright-pool/cli-state.json" ] && break
done
sleep 1
echo "  Browser relaunched for speed test."
echo ""

echo "▸ Speed: Navigate (first tab)"
timed "navigate example.com" $CLI browser navigate "https://example.com"

echo "▸ Speed: Open new tab"
timed "open new tab (google)" $CLI browser navigate "https://www.google.com" --new-tab
sleep 0.3

echo "▸ Speed: List tabs"
timed "list tabs" $CLI browser tabs

echo "▸ Speed: Close by URL"
timed "close google tab" $CLI browser close google
sleep 0.3

echo "▸ Speed: 5 rapid-fire tab opens"
RAPID_START=$(date +%s%N)
for site in example.com www.google.com en.wikipedia.org httpbin.org jsonplaceholder.typicode.com; do
  $CLI browser navigate "https://$site" --new-tab > /dev/null 2>&1
  sleep 0.3
done
RAPID_END=$(date +%s%N)
RAPID_MS=$(( (RAPID_END - RAPID_START) / 1000000 ))
$CLI browser tabs 2>&1 | head -1
echo "  ${RAPID_MS}ms total — 5 tabs opened ($(( RAPID_MS / 5 ))ms avg per tab)"

echo ""
echo "▸ Speed: 5 rapid-fire tab closes"
CLOSE_START=$(date +%s%N)
$CLI browser close google > /dev/null 2>&1; sleep 0.3
$CLI browser close wikipedia > /dev/null 2>&1; sleep 0.3
$CLI browser close httpbin > /dev/null 2>&1; sleep 0.3
$CLI browser close jsonplaceholder > /dev/null 2>&1; sleep 0.3
$CLI browser close 0 > /dev/null 2>&1; sleep 0.3
CLOSE_END=$(date +%s%N)
CLOSE_MS=$(( (CLOSE_END - CLOSE_START) / 1000000 ))
$CLI browser tabs 2>&1 | head -1
echo "  ${CLOSE_MS}ms total — 5 tabs closed ($(( CLOSE_MS / 5 ))ms avg per close)"

echo ""
echo "▸ Speed: 10 tabs rapid-fire open"
BULK_START=$(date +%s%N)
for i in $(seq 1 10); do
  $CLI browser navigate "https://example.com/?tab=$i" --new-tab > /dev/null 2>&1
  sleep 0.2
done
BULK_END=$(date +%s%N)
BULK_MS=$(( (BULK_END - BULK_START) / 1000000 ))
$CLI browser tabs 2>&1 | head -1
echo "  ${BULK_MS}ms total — 10 tabs opened ($(( BULK_MS / 10 ))ms avg per tab)"

# Cleanup
echo ""
echo "▸ Cleanup: Close all"
timed "close all" $CLI browser close all

TOTAL_END=$(date +%s%N)
TOTAL_MS=$(( (TOTAL_END - TOTAL_START) / 1000000 ))

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  BENCHMARK COMPLETE"
echo "  Correctness: $PASS / $((PASS + FAIL)) passed"
echo "  Total time: ${TOTAL_MS}ms ($(( TOTAL_MS / 1000 ))s)"
echo "═══════════════════════════════════════════════════════"
