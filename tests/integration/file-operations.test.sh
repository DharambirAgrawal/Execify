#!/bin/bash

# Integration Tests - File I/O and Commands
# Tests writing files, reading files, zipping, and workspace operations

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
  local check_pattern="$3"
  local secondary_pattern="$4"
  
  echo -e "\n${BLUE}[TEST]${NC} $name"
  
  response=$(curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$BASE_URL/run")
  
  if echo "$response" | grep -q '"exitCode":0' && echo "$response" | grep -q "$check_pattern"; then
    if [ -n "$secondary_pattern" ] && ! echo "$response" | grep -q "$secondary_pattern"; then
      echo -e "${RED}✗ FAIL${NC}"
      echo "Response: $response" | head -c 150
      ((FAIL++))
      return 1
    fi
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASS++))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Response: $response" | head -c 150
    ((FAIL++))
    return 1
  fi
}

echo -e "\n${YELLOW}================================================${NC}"
echo -e "${YELLOW} INTEGRATION TESTS - FILE I/O & COMMANDS${NC}"
echo -e "${YELLOW}================================================${NC}"

# === FILE WRITE TESTS ===
echo -e "\n${YELLOW}--- File Write Operations ---${NC}"

test_case "Write: Simple Text File" '{
  "type": "execute",
  "language": "python",
  "code": "with open(\"/workspace/test.txt\", \"w\") as f:\n    f.write(\"Hello\")\nprint(\"written\")"
}' '"name":"test.txt"' '"stdout":"written'

test_case "Write: JSON File" '{
  "type": "execute",
  "language": "python",
  "code": "import json\nwith open(\"/workspace/data.json\", \"w\") as f:\n    json.dump({\"test\": \"data\"}, f)\nprint(\"written\")"
}' '"name":"data.json"' '"stdout":"written'

test_case "Write: CSV File" '{
  "type": "execute",
  "language": "python",
  "code": "import csv\nwith open(\"/workspace/data.csv\", \"w\", newline=\"\") as f:\n    w = csv.writer(f)\n    w.writerow([\"a\", \"b\"])\nprint(\"written\")"
}' '"name":"data.csv"' '"stdout":"written'

test_case "Write: Markdown File" '{
  "type": "execute",
  "language": "python",
  "code": "with open(\"/workspace/README.md\", \"w\") as f:\n    f.write(\"# Title\\n## Content\")\nprint(\"written\")"
}' '"name":"README.md"' '"stdout":"written'

test_case "Write: Node.js File" '{
  "type": "execute",
  "language": "node",
  "code": "const fs = require(\"fs\");\nfs.writeFileSync(\"/workspace/output.txt\", \"Node output\");\nconsole.log(\"written\");"
}' '"name":"output.txt"' '"stdout":"written'

# === FILE READ TESTS ===
echo -e "\n${YELLOW}--- File Read Operations ---${NC}"

test_case "Read: List Directory" '{
  "type": "execute",
  "language": "python",
  "code": "import os\nwith open(\"/workspace/list-me.txt\", \"w\") as f:\n    f.write(\"hello\")\nprint(os.listdir(\"/workspace\"))"
}' '"list-me.txt"'

test_case "Read: Read Text File" '{
  "type": "execute",
  "language": "python",
  "code": "with open(\"/workspace/test.txt\", \"w\") as f:\n    f.write(\"Hello\")\nwith open(\"/workspace/test.txt\", \"r\") as f:\n    print(f.read())"
}' '"stdout":"Hello'

test_case "Read: Read JSON File" '{
  "type": "execute",
  "language": "python",
  "code": "import json\nwith open(\"/workspace/data.json\", \"w\") as f:\n    json.dump({\"test\": \"data\"}, f)\nwith open(\"/workspace/data.json\") as f:\n    print(json.load(f))"
}' "'test': 'data'"

test_case "Read: Node.js Read" '{
  "type": "execute",
  "language": "node",
  "code": "const fs = require(\"fs\");\nfs.writeFileSync(\"/workspace/output.txt\", \"Node output\");\nconsole.log(fs.readFileSync(\"/workspace/output.txt\", \"utf8\"));"
}' '"stdout":"Node output'

# === ZIP TESTS ===
echo -e "\n${YELLOW}--- ZIP Operations ---${NC}"

test_case "ZIP: Create ZIP Archive" '{
  "type": "execute",
  "language": "python",
  "code": "import subprocess\nwith open(\"/workspace/test.txt\", \"w\") as f:\n    f.write(\"Hello\")\nwith open(\"/workspace/data.json\", \"w\") as f:\n    f.write(\"{\\\"test\\\": \\\"data\\\"}\")\nsubprocess.run([\"zip\", \"-j\", \"/workspace/archive.zip\", \"/workspace/test.txt\", \"/workspace/data.json\"], check=True)\nprint(\"zipped\")"
}' 'zipped'

# === CLEANUP & VERIFY ===
echo -e "\n${YELLOW}--- Cleanup ---${NC}"

test_case "Cleanup: Delete File" '{
  "type": "execute",
  "language": "python",
  "code": "import os\nwith open(\"/workspace/test.txt\", \"w\") as f:\n    f.write(\"Hello\")\nos.remove(\"/workspace/test.txt\")\nprint(os.path.exists(\"/workspace/test.txt\"))"
}' '"stdout":"False'

# === SUMMARY ===
echo -e "\n${YELLOW}================================================${NC}"
TOTAL=$((PASS + FAIL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "${YELLOW}================================================${NC}"

exit $FAIL
