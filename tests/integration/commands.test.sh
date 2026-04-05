#!/bin/bash

# Integration Tests - Named Commands
# Validates command endpoint behavior for required commands.

BASE_URL="http://localhost:3000"
API_KEY="test-key-123"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

test_case() {
  local name="$1"
  local data="$2"
  local expected="$3"

  echo -e "\n${BLUE}[COMMAND TEST]${NC} $name"

  response=$(curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$BASE_URL/run")

  if echo "$response" | grep -q "$expected"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASS++))
  else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Response: $response" | head -c 220
    ((FAIL++))
  fi
}

echo -e "\n${YELLOW}================================================${NC}"
echo -e "${YELLOW} INTEGRATION TESTS - COMMAND ENDPOINTS${NC}"
echo -e "${YELLOW}================================================${NC}"

test_case "write_file" '{
  "type": "command",
  "command": "write_file",
  "params": {
    "filename": "cmd-a.txt",
    "content": "Y21kLWNvbnRlbnQ=",
    "encoding": "base64"
  }
}' '"success":true'

test_case "read_file" '{
  "type": "command",
  "command": "read_file",
  "params": {
    "filename": "cmd-a.txt"
  }
}' '"content":"Y21kLWNvbnRlbnQ="'

test_case "list_dir" '{
  "type": "command",
  "command": "list_dir",
  "params": {}
}' 'cmd-a.txt'

test_case "zip_files" '{
  "type": "command",
  "command": "zip_files",
  "params": {
    "filenames": ["cmd-a.txt"],
    "output_name": "cmd-a.zip"
  }
}' '"zip_file":"cmd-a.zip"'

test_case "delete_file" '{
  "type": "command",
  "command": "delete_file",
  "params": {
    "filename": "cmd-a.txt"
  }
}' '"success":true'

test_case "clear_workspace" '{
  "type": "command",
  "command": "clear_workspace",
  "params": {}
}' '"success":true'

test_case "write_file blocked extension" '{
  "type": "command",
  "command": "write_file",
  "params": {
    "filename": "danger.sh",
    "content": "ZWNobyBoaQ==",
    "encoding": "base64"
  }
}' '"error":"Extension not allowed for command file: .sh"'

test_case "fetch_url (whitelist)" '{
  "type": "command",
  "command": "fetch_url",
  "params": {
    "url": "https://jsonplaceholder.typicode.com/posts/1",
    "method": "GET"
  }
}' '"status":200'

echo -e "\n${YELLOW}================================================${NC}"
TOTAL=$((PASS + FAIL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "${YELLOW}================================================${NC}"

exit $FAIL