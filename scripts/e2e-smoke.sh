#!/usr/bin/env bash
#
# SmartRouter Pro — E2E Smoke Test
# 用法: bash scripts/e2e-smoke.sh
# 或:   API_BASE=http://localhost:3001 bash scripts/e2e-smoke.sh
#

set -e

BASE="${API_BASE:-http://localhost:3001}"
USER="test-user-e2e-$(date +%s)"
PASS=0; FAIL=0

check() {
  local name="$1"; local result="$2"; local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    echo "✅  $name"
    ((PASS++))
  else
    echo "❌  $name → 期望包含 '$expected'"
    echo    "     实际: $(echo "$result" | head -c 200)"
    ((FAIL++))
  fi
}

http_code() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

echo "🏃 SmartRouter Pro — E2E Smoke Test"
echo "=============================================="
echo "Base: $BASE | User: $USER"
echo ""

# ── T-01 Health ──────────────────────────────────
R=$(curl -s "$BASE/health")
check "T-01 status=ok"          "$R" '"status":"ok"'
check "T-01 DB status ok"       "$R" '"database".*"status":"ok"'
check "T-01 Has services"       "$R" '"services":'
check "T-01 Has stats"          "$R" '"stats":'
check "T-01 Has uptime"         "$R" '"uptime_seconds":'

# ── T-02 Simple QA ───────────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"message":"1+1等于几","session_id":"smoke-01"}')
check "T-02 has message"        "$R" '"message":"'
check "T-02 has task_id"        "$R" '"task_id":"'
check "T-02 has decision"       "$R" '"decision":'
check "T-02 has execution"      "$R" '"execution":'
check "T-02 has input_features" "$R" '"input_features":'
check "T-02 has routing"        "$R" '"routing":'
check "T-02 tokens > 0"        "$R" '"input_tokens":[0-9]'
TASK_ID=$(echo "$R" | grep -o '"task_id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "    ↳ task_id = $TASK_ID"

# ── T-03 Research mode ───────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"message":"分析2024年全球AI芯片市场竞争格局","session_id":"smoke-02"}')
check "T-03 has intent"         "$R" '"intent":"'
check "T-03 has routing"        "$R" '"routing":'
check "T-03 response non-empty" "$R" '"message":"[^"]+'

# ── T-04 Missing message ─────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"session_id":"smoke-03"}')
check "T-04 no crash"           "$R" '"message":"'
check "T-04 still has task_id"  "$R" '"task_id":"'

# ── T-05 Dev fallback ────────────────────────────
R=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"hi","session_id":"smoke-04","user_id":"fallback-test"}')
check "T-05 fallback user_id"   "$R" '"user_id":"fallback-test"'

# ── T-06 Task list ───────────────────────────────
R=$(curl -s "$BASE/v1/tasks/all" -H "X-User-Id: $USER")
check "T-06 tasks wrapper"      "$R" '"tasks":\['
check "T-06 tasks array"         "$R" '"tasks":\['

# ── T-07 Task detail ─────────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s "$BASE/v1/tasks/$TASK_ID" -H "X-User-Id: $USER")
  check "T-07 task wrapper"       "$R" '"task":'
  check "T-07 has task_id"        "$R" '"task_id":"'
fi

# ── T-08 Task traces ────────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s "$BASE/v1/tasks/$TASK_ID/traces" -H "X-User-Id: $USER")
  check "T-08 traces wrapper"     "$R" '"traces":'
  check "T-08 has trace types"    "$R" '"type":"'
fi

# ── T-09 Task pause/resume ──────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s -X PATCH "$BASE/v1/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $USER" \
    -d '{"action":"pause"}')
  check "T-09 pause ok"          "$R" '"action":"pause"'
  check "T-09 status paused"      "$R" '"status":"paused"'

  R=$(curl -s -X PATCH "$BASE/v1/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $USER" \
    -d '{"action":"resume"}')
  check "T-09 resume ok"         "$R" '"action":"resume"'
  check "T-09 status responding"  "$R" '"status":"responding"'
fi

# ── T-10 Auth protection ─────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s "$BASE/v1/tasks/$TASK_ID" -H "X-User-Id: attacker-999")
  check "T-10 403 forbidden"     "$R" '"error"'
fi

# ── T-11 Memory write ────────────────────────────
R=$(curl -s -X POST "$BASE/v1/memory" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"content":"smoke test memory entry","category":"fact","importance":3}')
check "T-11 entry wrapper"       "$R" '"entry":'
check "T-11 has id"              "$R" '"id":"'
MEM_ID=$(echo "$R" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "    ↳ memory_id = $MEM_ID"

# ── T-12 Memory list ─────────────────────────────
R=$(curl -s "$BASE/v1/memory" -H "X-User-Id: $USER")
check "T-12 entries wrapper"     "$R" '"entries":'
check "T-12 has category"       "$R" '"category":"'

# ── T-13 Memory filter ──────────────────────────
R=$(curl -s "$BASE/v1/memory?category=fact" -H "X-User-Id: $USER")
check "T-13 filter works"        "$R" '"entries":'

# ── T-14 Memory delete ───────────────────────────
if [ -n "$MEM_ID" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "$BASE/v1/memory/$MEM_ID" -H "X-User-Id: $USER")
  check "T-14 delete 204"        "$HTTP_CODE" "204"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE/v1/memory/$MEM_ID" -H "X-User-Id: $USER")
  check "T-14 get 404 after del"  "$HTTP_CODE" "404"
fi

# ── T-15 Evidence write ──────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s -X POST "$BASE/v1/evidence" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $USER" \
    -d "{\"task_id\":\"$TASK_ID\",\"source\":\"manual\",\"content\":\"test evidence\",\"relevance_score\":0.8}")
  check "T-15 evidence wrapper"   "$R" '"evidence":'
  check "T-15 has evidence_id"    "$R" '"evidence_id":"'
  EVID_ID=$(echo "$R" | grep -o '"evidence_id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

# ── T-16 Evidence query ──────────────────────────
if [ -n "$TASK_ID" ]; then
  R=$(curl -s "$BASE/v1/evidence?task_id=$TASK_ID" -H "X-User-Id: $USER")
  check "T-16 evidence list"      "$R" '"evidence":'
fi

# ── T-17 Feedback ───────────────────────────────
DECISION_ID=$(curl -s -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"message":"推荐一本好书","session_id":"smoke-05"}' \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$DECISION_ID" ]; then
  R=$(curl -s -X POST "$BASE/api/feedback" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $USER" \
    -d "{\"decision_id\":\"$DECISION_ID\",\"feedback_type\":\"thumbs_up\"}")
  check "T-17 feedback success"   "$R" '"success":true'
fi

# ── T-18 Invalid feedback ───────────────────────
R=$(curl -s -X POST "$BASE/api/feedback" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: $USER" \
  -d '{"decision_id":"00000000-0000-0000-0000-000000000000","feedback_type":"thumbs_up"}')
check "T-18 feedback 404"        "$R" '"error"'

# ── T-19 Dashboard ───────────────────────────────
R=$(curl -s "$BASE/api/dashboard/$USER" -H "X-User-Id: $USER")
check "T-19 dashboard today"      "$R" '"today":'
check "T-19 dashboard growth"     "$R" '"growth":'
check "T-19 has token_flow"       "$R" '"token_flow":'

# ── T-20 Growth ─────────────────────────────────
R=$(curl -s "$BASE/api/growth/$USER" -H "X-User-Id: $USER")
check "T-20 growth level"         "$R" '"level":'
check "T-20 satisfaction"         "$R" '"satisfaction_rate":'

# ── Summary ──────────────────────────────────────
echo ""
echo "=============================================="
echo "结果: $PASS 通过 / $FAIL 失败"
if [ $FAIL -eq 0 ]; then
  echo "🎉 全部通过"
  exit 0
else
  echo "⚠️  有失败项，请检查"
  exit 1
fi
