#!/bin/bash

# Unit Tests - Basic Code Execution
# Tests core Python and Node.js execution functionality

BASE_URL="http://localhost:3000"
API_KEY="test-key-123"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_case() {
  local name="$1"
  local method="$2"
  local endpoint="$3"
  local data="$4"
  local check_pattern="$5"
  
  echo -e "\n${YELLOW}[TEST]${NC} $name"
  
  response=$(curl -s -X "$method" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$BASE_URL$endpoint")
  
  if echo "$response" | grep -q "$check_pattern"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASS++))
  else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Response: $response" | head -c 100
    ((FAIL++))
  fi
}

echo -e "\n${YELLOW}================================================${NC}"
echo -e "${YELLOW} UNIT TESTS - BASIC EXECUTION${NC}"
echo -e "${YELLOW}================================================${NC}"

# === PYTHON TESTS ===
echo -e "\n${YELLOW}--- Python Execution ---${NC}"

test_case "Python: Print Statement" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "print(\"hello world\")"
}' '"stdout":"hello world'

test_case "Python: Math Operations" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "print(10 + 20)"
}' '"stdout":"30'

test_case "Python: String Operations" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "s = \"Execify\"; print(s.lower())"
}' '"stdout":"execify'

test_case "Python: List Operations" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "lst = [1, 2, 3]; print(sum(lst))"
}' '"stdout":"6'

test_case "Python: Dictionary Operations" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "d = {\"a\": 1, \"b\": 2}; print(d[\"a\"])"
}' '"stdout":"1'

test_case "Python: Function Definition" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "def add(x, y): return x + y\nprint(add(5, 3))"
}' '"stdout":"8'

test_case "Python: Loops" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "for i in range(3): print(i)"
}' '"stdout":"0.*1.*2'

test_case "Python: JSON Operations" "POST" "/run" '{
  "type": "execute",
  "language": "python",
  "code": "import json; d = {\"key\": \"value\"}; print(json.dumps(d))"
}' '\\"key\\": \\"value\\"'

# === NODE TESTS ===
echo -e "\n${YELLOW}--- Node.js Execution ---${NC}"

test_case "Node: Console Log" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "console.log(\"hello world\");"
}' '"stdout":"hello world'

test_case "Node: Math Operations" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "console.log(10 + 20);"
}' '"stdout":"30'

test_case "Node: String Operations" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "const s = \"Execify\"; console.log(s.toLowerCase());"
}' '"stdout":"execify'

test_case "Node: Array Operations" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "const arr = [1, 2, 3]; console.log(arr.reduce((a, b) => a + b));"
}' '"stdout":"6'

test_case "Node: Object Operations" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "const obj = {a: 1, b: 2}; console.log(obj.a);"
}' '"stdout":"1'

test_case "Node: Function Definition" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "function add(x, y) { return x + y; } console.log(add(5, 3));"
}' '"stdout":"8'

test_case "Node: Loops" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "for (let i = 0; i < 3; i++) console.log(i);"
}' '"stdout":"0.*1.*2'

test_case "Node: JSON Operations" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "const obj = {key: \"value\"}; console.log(JSON.stringify(obj));"
}' '\\"key\\":\\"value\\"'

test_case "Node: Promise/Async" "POST" "/run" '{
  "type": "execute",
  "language": "node",
  "code": "Promise.resolve(42).then(v => console.log(v));"
}' '"stdout":"42'

# === SUMMARY ===
echo -e "\n${YELLOW}================================================${NC}"
TOTAL=$((PASS + FAIL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "${YELLOW}================================================${NC}"

exit $FAIL
