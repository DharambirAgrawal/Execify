# Execify Deployment Guide

## Local Setup

```bash
npm install
docker build -t execify-sandbox ./docker
cp .env.example .env 2>/dev/null || true
npm start
```

## Production Settings

Set these in `.env`:

```env
WORKER_READONLY=true
POOL_SIZE=5
WORKER_MEMORY_MB=512
WORKER_CPUS=1
EXECUTION_TIMEOUT_MS=30000
```

## Verification

```bash
curl http://localhost:3000/health
./tests/run-all-tests.sh
```

## Notes

- Keep `Plan.md` in the root as requested.
- Keep root clean; place docs under `docs/` only.
- Use `tests/README.md` for test execution details.
