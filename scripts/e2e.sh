#!/usr/bin/env bash
# 빌드 → 미리보기 서버 → 교실 흐름 테스트 → 서버 종료
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build >/dev/null
(cd client && npx vite preview --port 4173 --strictPort --outDir ../dist >/dev/null 2>&1) &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null || true; pkill -f "vite preview --port 4173" 2>/dev/null || true' EXIT
for i in $(seq 1 20); do curl -s -o /dev/null localhost:4173 && break; sleep 0.5; done
node scripts/e2e.cjs
