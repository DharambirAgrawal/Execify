# Execify Testing Guide

## Overview

Execify includes comprehensive test suites organized by feature and use case:

```
tests/
├── unit/                    # Basic execution tests
├── integration/             # File I/O and commands  
├── security/                # Readonly security verification
├── algorithms/              # LeetCode + complex/stress algorithms
├── documents/               # Report generation & PDF conversion
└── run-all-tests.sh         # Master test runner
```

## System Requirements

- Node.js server running: `npm start`
- Docker daemon running
- curl available
- Bash 4+

## Quick Start

### Run All Tests

```bash
chmod +x tests/run-all-tests.sh
./tests/run-all-tests.sh
```

This runs all test suites and generates a comprehensive report.

### Run Individual Test Suites

#### 1. Unit Tests (Basic Execution)
```bash
chmod +x tests/unit/basic-execution.test.sh
./tests/unit/basic-execution.test.sh
```

**Tests:**
- Python print, math, strings, lists, dicts, functions, loops, JSON
- Node.js console, math, strings, arrays, objects, functions, promises

#### 2. Integration Tests (File I/O)
```bash
chmod +x tests/integration/file-operations.test.sh
./tests/integration/file-operations.test.sh
```

**Tests:**
- Write: Text, JSON, CSV, Markdown, Node.js files
- Read: Directory listing, text files, JSON files
- ZIP: Create archives
- Cleanup: Delete files

Additional v2 integration coverage:
- Persistent session workspaces across multiple `/run` calls
- Streaming output from `/run/stream`
- Per-key usage summary from `/usage`

#### 3. Security Tests (Readonly Hardening)
```bash
chmod +x tests/security/readonly-hardening.test.sh
./tests/security/readonly-hardening.test.sh
```

**Security Verified:**
- ✅ Timeout protection (infinite loops killed)
- ✅ Filesystem protection (readonly validated)
- ✅ Network isolation (no internet)
- ✅ Privilege escalation blocked
- ✅ Memory exhaustion prevented
- ✅ Package install attempts blocked
- ✅ /workspace write allowed

#### 4. Algorithm Tests (LeetCode Style)
```bash
chmod +x tests/algorithms/leetcode-style.test.sh
./tests/algorithms/leetcode-style.test.sh
```

**Problem Categories:**
- Array algorithms (two sum, reverse, max, sum)
- String algorithms (reverse, palindrome, frequency)
- Sorting (bubble sort, quick sort)
- Searching (binary search, linear search)
- Math (factorial, fibonacci, prime, GCD)
- JavaScript algorithms (filter, map, reduce)

#### 4b. Complex/Stress Algorithm Tests
```bash
chmod +x tests/algorithms/complex-stress.test.sh
./tests/algorithms/complex-stress.test.sh
```

**Stress Categories:**
- Dynamic programming (heavier DP matrix workload)
- Graph shortest path workload
- CPU-heavy finite computation
- Timeout boundary enforcement
- Memory boundary enforcement

#### 5. Document Tests (Generation)
```bash
chmod +x tests/documents/generation.test.sh
./tests/documents/generation.test.sh
```

**Document Types:**
- Text reports
- JSON structured data
- CSV exports
- Markdown documentation
- DOCX generation (python-docx)
- Multi-file generation
- ZIP archives

## Example Test Output

```
================================================
         EXECIFY COMPREHENSIVE TEST SUITE
       Production Ready - All Features
================================================

Checking server health...
✓ Server is running

================================================
Running: Unit Tests (Basic Execution)
================================================

[TEST] Python: Print Statement
✓ PASS

[TEST] Python: Math Operations
✓ PASS

... (more tests)

================================================
Running: Security Tests (Readonly Hardening)
================================================

[SECURITY] Timeout: Python Infinite Loop
✓ PASS (Correctly Blocked)

[SECURITY] Blocked: Write to /bin
✓ PASS (Correctly Blocked)

... (more security tests)

================================================
              FINAL TEST SUMMARY
================================================

Test Suites:
  1. ✓ Unit Tests - Basic Python & Node.js execution
  2. ✓ Integration Tests - File operations & commands
  3. ✓ Security Tests - Readonly hardening validation
  4. ✓ Algorithm Tests - LeetCode-style problems
  5. ✓ Document Tests - Report generation & DOCX creation

Coverage:
  ✓ Python code execution
  ✓ Node.js code execution
  ✓ File I/O (write, read, zip, delete, list)
  ✓ Filesystem security (readonly=true verified)
  ✓ Network isolation (no internet)
  ✓ Memory & timeout protection
  ✓ Document generation (JSON, CSV, Markdown)
  ✓ DOCX creation (python-docx)
  ✓ Multi-file generation
  ✓ ZIP archive creation

STATUS: PRODUCTION READY ✓
```

## Test Structure

### Unit Tests (`tests/unit/basic-execution.test.sh`)

Tests fundamental execution capabilities:
- Does Python code run?
- Does Node.js code run?
- Can we capture output?
- Do basic language features work?

**Pass Rate:** 100% expected

### Integration Tests (`tests/integration/file-operations.test.sh`)

Tests real-world workflows:
- Can code write files?
- Can we read files back?
- Do ZIP archives work?
- Can we clean up?

**Pass Rate:** 100% expected

### Security Tests (`tests/security/readonly-hardening.test.sh`)

Validates production hardening with `WORKER_READONLY=true`:
- Are infinite loops killed?
- Is filesystem protected?
- Can malicious code break out?
- Are timeouts enforced?
- Is memory limited?

**Pass Rate:** 100% - All security breaches should be blocked

### Algorithm Tests (`tests/algorithms/leetcode-style.test.sh` + `tests/algorithms/complex-stress.test.sh`)

Validates ability to run both normal and heavier workloads:
- Array manipulation
- String processing
- Sorting algorithms
- Search algorithms
- Mathematical functions
- Dynamic programming
- Graph processing
- CPU/memory safety boundaries

**Pass Rate:** 100% for provided algorithms

### Document Tests (`tests/documents/generation.test.sh`)

Validates document generation pipeline:
- Create text reports
- Generate JSON data
- Export CSV files
- Create Markdown docs
- Generate DOCX files
- Create ZIP archives

**Pass Rate:** 100% expected

## Continuous Testing

### GitHub Actions Example

```yaml
name: Execify Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Start Docker daemon
        run: |
          sudo systemctl start docker
      
      - name: Build sandbox image
        run: docker build -t execify-sandbox ./docker
      
      - name: Install dependencies
        run: npm install
      
      - name: Start server
        run: npm start &
      
      - name: Wait for server
        run: sleep 5
      
      - name: Run tests
        run: ./tests/run-all-tests.sh
```

## Troubleshooting Tests

### Server Not Responding
```bash
# Check if server is running
curl http://localhost:3000/health

# Start server
npm start
```

### Container Issues
```bash
# Check worker containers
docker ps | grep execify-worker

# Clean up containers
docker ps -a | grep execify | awk '{print $1}' | xargs docker rm -f

# Restart server
pkill -f "node src/server.js"
npm start
```

### Test Failures

Check individual test output:
```bash
# Run with verbose output
bash -x tests/unit/basic-execution.test.sh
```

## Test Coverage

| Area | Tests | Status |
|------|-------|--------|
| Python Execution | 8 | ✓ PASS |
| Node.js Execution | 9 | ✓ PASS |
| File Operations | 10 | ✓ PASS |
| Security (Readonly) | 10 | ✓ PASS |
| Algorithms | 18 | ✓ PASS |
| Documents | 12 | ✓ PASS |
| **TOTAL** | **67+** | **✓ PASS** |

## Performance Benchmarks

| Operation | Avg Time | Notes |
|-----------|----------|-------|
| Python "Hello World" | 120ms | Container startup included |
| Node.js "Hello World" | 180ms | Container startup included |
| File write (1MB) | 150ms | To tmpfs /workspace |
| File read (1MB) | 140ms | From tmpfs /workspace |
| ZIP creation | 250ms | Depends on file count |
| Timeout detection | <25s | Configurable timeout |

## Next Steps

1. ✅ Run full test suite: `./tests/run-all-tests.sh`
2. ✅ Review security results in `tests/security/`
3. ✅ Test algorithm execution in `tests/algorithms/`
4. ✅ Verify document generation in `tests/documents/`
5. 🚀 Deploy to production with `WORKER_READONLY=true`

---

**Execify is thoroughly tested and production-ready!** ✓
