#!/bin/bash

# Integration Tests - Agent-Like Edge Cases
# Covers auth failures, payload validation, SSE error paths, session contention,
# and worker reservation invariants under concurrent request patterns.

BASE_URL="http://localhost:3000"
API_KEY="test-key-123"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

TMP_FILES=()
SESSIONS_TO_DELETE=()

new_tmp() {
  local f
  f=$(mktemp)
  TMP_FILES+=("$f")
  echo "$f"
}

extract_json_field() {
  local json="$1"
  local key="$2"
  echo "$json" | sed -n "s/.*\"$key\":\"\([^\"]*\)\".*/\1/p"
}

api_call() {
  local method="$1"
  local endpoint="$2"
  local payload="$3"
  local include_key="$4"

  local body_file
  body_file=$(new_tmp)

  local curl_args=("-s" "-o" "$body_file" "-w" "%{http_code}" "-X" "$method")

  if [[ "$include_key" == "yes" ]]; then
    curl_args+=("-H" "X-API-Key: $API_KEY")
  fi

  if [[ -n "$payload" ]]; then
    curl_args+=("-H" "Content-Type: application/json" "-d" "$payload")
  fi

  local status
  status=$(curl "${curl_args[@]}" "$BASE_URL$endpoint")
  local body
  body=$(cat "$body_file")

  echo "$status|$body"
}

record_pass() {
  echo -e "${GREEN}✓ PASS${NC}"
  ((PASS++))
}

record_fail() {
  local details="$1"
  echo -e "${RED}✗ FAIL${NC}"
  if [[ -n "$details" ]]; then
    echo "$details" | head -c 500
    echo
  fi
  ((FAIL++))
}

create_session() {
  local response
  response=$(api_call "POST" "/session/create" '{"expires_in":120}' "yes")

  local status="${response%%|*}"
  local body="${response#*|}"

  if [[ "$status" != "201" ]]; then
    echo "ERR|$status|$body"
    return
  fi

  local sid
  sid=$(extract_json_field "$body" "session_id")
  if [[ -z "$sid" ]]; then
    echo "ERR|$status|$body"
    return
  fi

  SESSIONS_TO_DELETE+=("$sid")
  echo "OK|$sid"
}

cleanup_sessions() {
  local sid
  for sid in "${SESSIONS_TO_DELETE[@]}"; do
    curl -s -X DELETE -H "X-API-Key: $API_KEY" "$BASE_URL/session/$sid" > /dev/null 2>&1 || true
  done
  SESSIONS_TO_DELETE=()
}

cleanup_tmp() {
  local f
  for f in "${TMP_FILES[@]}"; do
    rm -f "$f" > /dev/null 2>&1 || true
  done
}

cleanup() {
  cleanup_sessions
  cleanup_tmp
}

trap cleanup EXIT

echo -e "\n${CYAN}================================================${NC}"
echo -e "${CYAN} INTEGRATION TESTS - AGENT EDGE CASES${NC}"
echo -e "${CYAN}================================================${NC}"

echo -e "\n${YELLOW}[AUTH]${NC} Missing API key returns 401"
auth_resp=$(api_call "GET" "/usage" "" "no")
auth_status="${auth_resp%%|*}"
auth_body="${auth_resp#*|}"
if [[ "$auth_status" == "401" ]] && echo "$auth_body" | grep -q 'Invalid or missing API key'; then
  record_pass
else
  record_fail "$auth_resp"
fi

echo -e "\n${YELLOW}[VALIDATION]${NC} Invalid run type returns 400"
invalid_type_resp=$(api_call "POST" "/run" '{"type":"invalid"}' "yes")
invalid_type_status="${invalid_type_resp%%|*}"
invalid_type_body="${invalid_type_resp#*|}"
if [[ "$invalid_type_status" == "400" ]] && echo "$invalid_type_body" | grep -q 'type must be execute or command'; then
  record_pass
else
  record_fail "$invalid_type_resp"
fi

echo -e "\n${YELLOW}[VALIDATION]${NC} Execute without code returns 400"
missing_code_resp=$(api_call "POST" "/run" '{"type":"execute","language":"python"}' "yes")
missing_code_status="${missing_code_resp%%|*}"
missing_code_body="${missing_code_resp#*|}"
if [[ "$missing_code_status" == "400" ]] && echo "$missing_code_body" | grep -q 'Missing field: code'; then
  record_pass
else
  record_fail "$missing_code_resp"
fi

echo -e "\n${YELLOW}[VALIDATION]${NC} Unknown command returns 400"
unknown_cmd_resp=$(api_call "POST" "/run" '{"type":"command","command":"nope_command","params":{}}' "yes")
unknown_cmd_status="${unknown_cmd_resp%%|*}"
unknown_cmd_body="${unknown_cmd_resp#*|}"
if [[ "$unknown_cmd_status" == "400" ]] && echo "$unknown_cmd_body" | grep -q 'Unknown command'; then
  record_pass
else
  record_fail "$unknown_cmd_resp"
fi

echo -e "\n${YELLOW}[STREAM]${NC} Invalid stream payload emits SSE error event"
stream_error=$(curl -sN -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"language":"python"}' \
  "$BASE_URL/run/stream")

if echo "$stream_error" | grep -q '"type":"error"' && echo "$stream_error" | grep -q 'Missing field: type'; then
  record_pass
else
  record_fail "$stream_error"
fi

echo -e "\n${YELLOW}[SESSION]${NC} Busy session rejects concurrent run"
session_create=$(create_session)
if [[ "$session_create" == OK\|* ]]; then
  session_id="${session_create#OK|}"

  stream_file=$(new_tmp)
  curl -sN -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"execute\",\"language\":\"python\",\"session_id\":\"$session_id\",\"code\":\"import time\\nprint('start')\\ntime.sleep(2)\\nprint('end')\"}" \
    "$BASE_URL/run/stream" > "$stream_file" &
  stream_pid=$!

  conflict_seen=0
  for _ in {1..60}; do
    concurrent_resp=$(api_call "POST" "/run" "{\"type\":\"execute\",\"language\":\"python\",\"session_id\":\"$session_id\",\"code\":\"print('second call')\"}" "yes")
    concurrent_status="${concurrent_resp%%|*}"

    if [[ "$concurrent_status" == "409" ]]; then
      conflict_seen=1
      break
    fi

    if ! kill -0 "$stream_pid" 2>/dev/null; then
      break
    fi
  done

  wait "$stream_pid" 2>/dev/null || true

  if [[ "$conflict_seen" -eq 1 ]]; then
    record_pass
  else
    record_fail "Expected 409 while session in use; got: $concurrent_resp"
  fi
else
  record_fail "Failed to create session: $session_create"
fi

echo -e "\n${YELLOW}[SESSION]${NC} Session worker remains reserved after session command"
# Discover pool size by creating sessions until exhausted.
BASELINE_IDS=()
while true; do
  baseline_resp=$(api_call "POST" "/session/create" '{"expires_in":120}' "yes")
  baseline_status="${baseline_resp%%|*}"
  baseline_body="${baseline_resp#*|}"
  if [[ "$baseline_status" != "201" ]]; then
    break
  fi
  sid=$(extract_json_field "$baseline_body" "session_id")
  if [[ -z "$sid" ]]; then
    break
  fi
  BASELINE_IDS+=("$sid")
done
POOL_SIZE="${#BASELINE_IDS[@]}"

for sid in "${BASELINE_IDS[@]}"; do
  curl -s -X DELETE -H "X-API-Key: $API_KEY" "$BASE_URL/session/$sid" > /dev/null 2>&1 || true
done

if [[ "$POOL_SIZE" -lt 2 ]]; then
  record_fail "Unable to establish baseline pool size (found $POOL_SIZE)"
else
  s1_resp=$(create_session)
  if [[ "$s1_resp" == OK\|* ]]; then
    s1="${s1_resp#OK|}"

    cmd_resp=$(api_call "POST" "/run" "{\"type\":\"command\",\"command\":\"list_dir\",\"params\":{},\"session_id\":\"$s1\"}" "yes")
    cmd_status="${cmd_resp%%|*}"

    if [[ "$cmd_status" != "200" ]]; then
      record_fail "Session command failed: $cmd_resp"
    else
      additional=0
      EXTRA_IDS=()
      while true; do
        r=$(api_call "POST" "/session/create" '{"expires_in":120}' "yes")
        st="${r%%|*}"
        body="${r#*|}"

        if [[ "$st" != "201" ]]; then
          break
        fi

        add_sid=$(extract_json_field "$body" "session_id")
        if [[ -z "$add_sid" ]]; then
          break
        fi

        EXTRA_IDS+=("$add_sid")
        ((additional++))
      done

      expected=$((POOL_SIZE - 1))
      if [[ "$additional" -eq "$expected" ]]; then
        record_pass
      else
        record_fail "Expected $expected additional sessions with one reserved; got $additional"
      fi

      for sid in "${EXTRA_IDS[@]}"; do
        curl -s -X DELETE -H "X-API-Key: $API_KEY" "$BASE_URL/session/$sid" > /dev/null 2>&1 || true
      done
    fi
  else
    record_fail "Failed to create primary session: $s1_resp"
  fi
fi

echo -e "\n${YELLOW}[CONVERSION]${NC} Invalid DOCX filename returns 400"
conversion_resp=$(api_call "POST" "/convert/docx-to-pdf" '{"filename":"../../bad.txt","file":"SGVsbG8="}' "yes")
conversion_status="${conversion_resp%%|*}"
conversion_body="${conversion_resp#*|}"
if [[ "$conversion_status" == "400" ]] && echo "$conversion_body" | grep -q 'safe .docx'; then
  record_pass
else
  record_fail "$conversion_resp"
fi

echo -e "\n${YELLOW}[USAGE]${NC} Usage captures failed requests by status"
usage_resp=$(api_call "GET" "/usage" "" "yes")
usage_status="${usage_resp%%|*}"
usage_body="${usage_resp#*|}"
if [[ "$usage_status" == "200" ]] && echo "$usage_body" | grep -q '"status":400'; then
  record_pass
else
  record_fail "$usage_resp"
fi

echo -e "\n${YELLOW}================================================${NC}"
TOTAL=$((PASS + FAIL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "${YELLOW}================================================${NC}"

exit $FAIL
