#!/bin/bash

# Complex/Stress Algorithm Tests
# Covers heavier compute patterns and validates timeout/memory protections.

BASE_URL="http://localhost:3000"
API_KEY="test-key-123"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

run_check() {
  local name="$1"
  local code="$2"
  local language="$3"
  local expect_pattern="$4"

  echo -e "\n${CYAN}[STRESS]${NC} $name"

  code=$(echo "$code" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  response=$(curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"execute\",\"language\":\"$language\",\"code\":\"$code\"}" \
    "$BASE_URL/run")

  if echo "$response" | grep -q "$expect_pattern"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASS++))
  else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Expected pattern: $expect_pattern"
    echo "Response: $response" | head -c 240
    ((FAIL++))
  fi
}

echo -e "\n${CYAN}================================================${NC}"
echo -e "${CYAN} COMPLEX/STRESS ALGORITHM TESTS${NC}"
echo -e "${CYAN}================================================${NC}"

echo -e "\n${YELLOW}--- Complex But Valid Workloads ---${NC}"

run_check "Dynamic Programming: LCS" 'def lcs(a, b):
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    print(dp[n][m])

lcs("AGGTAB" * 20, "GXTXAYB" * 20)' "python" '"stdout":"80'

run_check "Graph: Dijkstra (dense-ish)" 'import heapq

N = 300
graph = [[] for _ in range(N)]
for i in range(N):
    for j in range(i + 1, min(N, i + 4)):
        w = (i * j) % 17 + 1
        graph[i].append((j, w))
        graph[j].append((i, w))

dist = [10**18] * N
dist[0] = 0
pq = [(0, 0)]

while pq:
    d, u = heapq.heappop(pq)
    if d != dist[u]:
        continue
    for v, w in graph[u]:
        nd = d + w
        if nd < dist[v]:
            dist[v] = nd
            heapq.heappush(pq, (nd, v))

print(dist[-1])' "python" '"exitCode":0'

run_check "CPU-heavy but finite: prime counting" 'def is_prime(x):
    if x < 2:
        return False
    if x % 2 == 0:
        return x == 2
    i = 3
    while i * i <= x:
        if x % i == 0:
            return False
        i += 2
    return True

count = 0
for n in range(2, 120000):
    if is_prime(n):
        count += 1
print(count)' "python" '"stdout":"11301'

echo -e "\n${YELLOW}--- Safety Boundaries (Expected Block) ---${NC}"

run_check "Timeout guard on unbounded CPU" 'while True:
    pass' "python" '"errorType":"timeout"'

run_check "Memory guard on oversized allocation" 'a = [0] * (1000 * 1000 * 1000)
print(len(a))' "python" '"errorType"'

echo -e "\n${CYAN}================================================${NC}"
TOTAL=$((PASS + FAIL))
PASS_PCT=$((PASS * 100 / TOTAL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "Success Rate: ${GREEN}${PASS_PCT}%${NC}"
echo -e "${CYAN}================================================${NC}"

exit $FAIL
