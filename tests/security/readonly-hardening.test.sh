#!/bin/bash

# Security Tests - Production Hardening with WORKER_READONLY=true
# Tests that security features work properly in readonly mode

BASE_URL="http://localhost:3000"
API_KEY="test-key-123"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
NC='\033[0m'

test_security() {
  local name="$1"
  local code="$2"
  local language="$3"
  local should_fail="$4"  # 1 = should fail, 0 = should succeed
  
  echo -e "\n${PURPLE}[SECURITY]${NC} $name"
  
  response=$(curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"execute\", \"language\": \"$language\", \"code\": \"$code\"}" \
    "$BASE_URL/run")
  
  if [ "$should_fail" = "1" ]; then
    if echo "$response" | grep -q '"errorType"'; then
      echo -e "${GREEN}✓ PASS (Correctly Blocked)${NC}"
      ((PASS++))
    else
      echo -e "${RED}✗ FAIL (Should have blocked)${NC}"
      ((FAIL++))
    fi
  else
    if echo "$response" | grep -q '"exitCode":0'; then
      echo -e "${GREEN}✓ PASS${NC}"
      ((PASS++))
    else
      echo -e "${RED}✗ FAIL${NC}"
      ((FAIL++))
    fi
  fi
}

echo -e "\n${PURPLE}================================================${NC}"
echo -e "${PURPLE} SECURITY TESTS - READONLY=true${NC}"
echo -e "${PURPLE}================================================${NC}"

# === TIMEOUT PROTECTION ===
echo -e "\n${YELLOW}--- Timeout Protection ---${NC}"

test_security "Timeout: Python Infinite Loop" "while True: pass" "python" 1

test_security "Timeout: Node Infinite Loop" "while (true) {}" "node" 1

# === FILESYSTEM PROTECTION ===
echo -e "\n${YELLOW}--- Filesystem Protection (Readonly) ---${NC}"

test_security "Blocked: Modify /etc/passwd" "import os; os.rename('/etc/passwd', '/etc/passwd.bak')" "python" 1

test_security "Blocked: Write to /bin" "with open('/bin/malware.sh', 'w') as f: f.write('bad')" "python" 1

test_security "Blocked: Node Modify System" "const fs = require('fs'); fs.writeFileSync('/etc/config', 'hack');" "node" 1

# === NETWORK ISOLATION ===
echo -e "\n${YELLOW}--- Network Isolation (No Internet) ---${NC}"

test_security "Blocked: Curl External URL" "import subprocess; subprocess.run(['curl', 'https://evil.com'])" "python" 1

test_security "Blocked: DNS Resolution" "import socket; socket.gethostbyname('evil.com')" "python" 1

# === WORKSPACE WRITE IS ALLOWED ===
echo -e "\n${YELLOW}--- Workspace (Write Allowed) ---${NC}"

test_security "Allowed: Write to /workspace" "with open('/workspace/test.txt', 'w') as f: f.write('test')" "python" 0

test_security "Allowed: Node Write to /workspace" "const fs = require('fs'); fs.writeFileSync('/workspace/test.json', '{}');" "node" 0

# === PRIVILEGE ESCALATION ATTEMPTS ===
echo -e "\n${YELLOW}--- Privilege Escalation Protection ---${NC}"

test_security "Blocked: sudo Access" "import subprocess; subprocess.run(['sudo', 'id'])" "python" 1

test_security "Blocked: setuid" "import os; os.system('chmod u+s /tmp/malware')" "python" 1

# === DEPENDENCY ATTACKS ===
echo -e "\n${YELLOW}--- Dependency Protection ---${NC}"

test_security "Blocked: pip install (No Package Manager)" "import subprocess; subprocess.run(['pip', 'install', 'malware'])" "python" 1

test_security "Blocked: npm install (No Internet)" "const cp = require('child_process'); cp.execSync('npm install malware');" "node" 1

# === MEMORY EXHAUSTION ===
echo -e "\n${YELLOW}--- Memory Protection ---${NC}"

test_security "Memory Limited: Allocate Too Much" "data = [0] * (1000 * 1000 * 1000)" "python" 1

# === SUMMARY ===
echo -e "\n${PURPLE}================================================${NC}"
TOTAL=$((PASS + FAIL))
PASS_PCT=$((PASS * 100 / TOTAL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "Success Rate: ${GREEN}${PASS_PCT}%${NC}"
echo -e "${PURPLE}================================================${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "\n${GREEN}🔒 All security tests passed!${NC}"
  echo -e "${GREEN}Production READONLY mode is working correctly.${NC}"
fi

exit $FAIL
