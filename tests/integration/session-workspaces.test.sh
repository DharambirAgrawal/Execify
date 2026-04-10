#!/bin/bash

# Integration Tests - Session Workspaces, Streaming, and Usage Tracking

BASE_URL="http://localhost:3000"
API_KEY="test-key-123"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

run_json_post() {
  local endpoint="$1"
  local data="$2"

  curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$BASE_URL$endpoint"
}

echo -e "\n${CYAN}================================================${NC}"
echo -e "${CYAN} INTEGRATION TESTS - SESSION WORKSPACES${NC}"
echo -e "${CYAN}================================================${NC}"

echo -e "\n${YELLOW}[SESSION]${NC} Create session"
create_response=$(run_json_post "/session/create" '{"expires_in":300}')
session_id=$(echo "$create_response" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p')

if [[ -n "$session_id" ]]; then
  echo -e "${GREEN}✓ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "Response: $create_response"
  ((FAIL++))
fi

echo -e "\n${YELLOW}[SESSION]${NC} Persist workspace across runs"
first_run=$(run_json_post "/run" "{\"type\":\"execute\",\"language\":\"python\",\"session_id\":\"$session_id\",\"code\":\"with open('/workspace/session-note.txt', 'w') as f:\\n    f.write('hello from session')\"}")
second_run=$(run_json_post "/run" "{\"type\":\"execute\",\"language\":\"python\",\"session_id\":\"$session_id\",\"code\":\"with open('/workspace/session-note.txt') as f:\\n    print(f.read())\"}")

if echo "$first_run" | grep -q '"exitCode":0' && echo "$second_run" | grep -q 'hello from session'; then
  echo -e "${GREEN}✓ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "First run: $first_run"
  echo "Second run: $second_run"
  ((FAIL++))
fi

echo -e "\n${YELLOW}[STREAM]${NC} Streaming execution emits stdout and done event"
stream_response=$(curl -sN -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"execute","language":"python","code":"print(\"stream ok\")"}' \
  "$BASE_URL/run/stream")

if echo "$stream_response" | grep -q '"type":"stdout"' && echo "$stream_response" | grep -q '"type":"done"' && echo "$stream_response" | grep -q 'stream ok'; then
  echo -e "${GREEN}✓ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "Response: $stream_response"
  ((FAIL++))
fi

echo -e "\n${YELLOW}[USAGE]${NC} Usage endpoint reflects tracked activity"
usage_response=$(curl -s -H "X-API-Key: $API_KEY" "$BASE_URL/usage")

if echo "$usage_response" | grep -q '"sessionCreate":' && echo "$usage_response" | grep -q '"run":' && echo "$usage_response" | grep -q '"streamRun":'; then
  echo -e "${GREEN}✓ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "Response: $usage_response"
  ((FAIL++))
fi

echo -e "\n${YELLOW}[SESSION]${NC} Delete session"
delete_response=$(curl -s -X DELETE \
  -H "X-API-Key: $API_KEY" \
  "$BASE_URL/session/$session_id")

if echo "$delete_response" | grep -q '"success":true'; then
  echo -e "${GREEN}✓ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "Response: $delete_response"
  ((FAIL++))
fi

echo -e "\n${YELLOW}================================================${NC}"
TOTAL=$((PASS + FAIL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "${YELLOW}================================================${NC}"

exit $FAIL