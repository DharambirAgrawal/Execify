#!/bin/bash

# Algorithm Tests - LeetCode-like Problem Solving
# Tests Execify as a platform for running coding challenges and algorithmic solutions

BASE_URL="http://localhost:3000"
API_KEY="test-key-123"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

run_algorithm() {
  local name="$1"
  local code="$2"
  local language="$3"
  local expected_output="$4"
  
  echo -e "\n${CYAN}[ALGORITHM]${NC} $name"
  
  # Escape the code for JSON
  code=$(echo "$code" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  
  response=$(curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"execute\", \"language\": \"$language\", \"code\": \"$code\"}" \
    "$BASE_URL/run")
  
  if echo "$response" | grep -q "$expected_output"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASS++))
  else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Expected: $expected_output"
    echo "Response: $response" | head -c 200
    ((FAIL++))
  fi
}

echo -e "\n${CYAN}================================================${NC}"
echo -e "${CYAN} ALGORITHM TESTS - LEETCODE STYLE${NC}"
echo -e "${CYAN}================================================${NC}"

# === ARRAY ALGORITHMS ===
echo -e "\n${YELLOW}--- Array Algorithms ---${NC}"

run_algorithm "Two Sum" 'def twoSum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []

result = twoSum([2, 7, 11, 15], 9)
print(result)' "python" "\[0, 1\]"

run_algorithm "Reverse Array" 'arr = [1, 2, 3, 4, 5]
arr.reverse()
print(arr)' "python" "\[5, 4, 3, 2, 1\]"

run_algorithm "Array Max Element" 'print(max([1, 5, 3, 9, 2]))' "python" "9"

run_algorithm "Array Sum" 'print(sum([1, 2, 3, 4, 5]))' "python" "15"

# === STRING ALGORITHMS ===
echo -e "\n${YELLOW}--- String Algorithms ---${NC}"

run_algorithm "Reverse String" 's = "hello"
print(s[::-1])' "python" "olleh"

run_algorithm "Palindrome Check" 'def is_palindrome(s):
    s = s.lower().replace(" ", "")
    return s == s[::-1]

print(is_palindrome("A man a plan a canal Panama"))' "python" "True"

run_algorithm "String Frequency Count" 'from collections import Counter
text = "hello"
freq = Counter(text)
print(dict(freq))' "python" "l.*2"

# === SORTING ALGORITHMS ===
echo -e "\n${YELLOW}--- Sorting Algorithms ---${NC}"

run_algorithm "Bubble Sort" 'def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(0, n-i-1):
            if arr[j] > arr[j+1]:
                arr[j], arr[j+1] = arr[j+1], arr[j]
    return arr

print(bubble_sort([5, 2, 8, 1, 9]))' "python" "\[1, 2, 5, 8, 9\]"

run_algorithm "Quick Sort (Python)" 'def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[0]
    left = [x for x in arr[1:] if x < pivot]
    right = [x for x in arr[1:] if x >= pivot]
    return quick_sort(left) + [pivot] + quick_sort(right)

print(quick_sort([3, 6, 8, 1, 9, 2]))' "python" "\[1, 2, 3, 6, 8, 9\]"

run_algorithm "Node Sort" 'const arr = [5, 2, 8, 1, 9];
arr.sort((a, b) => a - b);
console.log(arr);' "node" "1.*2.*5.*8.*9"

# === SEARCH ALGORITHMS ===
echo -e "\n${YELLOW}--- Search Algorithms ---${NC}"

run_algorithm "Binary Search" 'def binary_search(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1

print(binary_search([1, 3, 5, 7, 9], 5))' "python" '"stdout":"2'

run_algorithm "Linear Search" 'arr = [10, 20, 30, 40, 50]
idx = arr.index(30)
print(idx)' "python" '"stdout":"2'

# === MATHEMATICAL ALGORITHMS ===
echo -e "\n${YELLOW}--- Mathematical Algorithms ---${NC}"

run_algorithm "Factorial" 'def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))' "python" "120"

run_algorithm "Fibonacci" 'def fib(n):
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return b

print(fib(6))' "python" "8"

run_algorithm "Prime Check" 'def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n**0.5) + 1):
        if n % i == 0:
            return False
    return True

print(is_prime(17))' "python" "True"

run_algorithm "GCD" 'import math
print(math.gcd(48, 18))' "python" "6"

# === NODE.JS ALGORITHMS ===
echo -e "\n${YELLOW}--- JavaScript Algorithms ---${NC}"

run_algorithm "JS Array Filter" 'const arr = [1, 2, 3, 4, 5];
const evens = arr.filter(x => x % 2 === 0);
console.log(evens);' "node" "2.*4"

run_algorithm "JS Map" 'const arr = [1, 2, 3];
const squared = arr.map(x => x * x);
console.log(squared);' "node" "1.*4.*9"

run_algorithm "JS Reduce" 'const arr = [1, 2, 3, 4, 5];
const sum = arr.reduce((a, b) => a + b, 0);
console.log(sum);' "node" "15"

# === SUMMARY ===
echo -e "\n${CYAN}================================================${NC}"
TOTAL=$((PASS + FAIL))
PASS_PCT=$((PASS * 100 / TOTAL))
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo -e "Success Rate: ${GREEN}${PASS_PCT}%${NC}"
echo -e "${CYAN}================================================${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "\n${GREEN}🎯 All algorithm tests passed!${NC}"
  echo -e "${GREEN}Execify is ready for LeetCode-style problems.${NC}"
fi

exit $FAIL
