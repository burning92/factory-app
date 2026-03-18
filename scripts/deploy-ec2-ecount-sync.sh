#!/bin/bash
# EC2에서 실행: 이카운트 sync 배포 및 검증
# 사용법: bash scripts/deploy-ec2-ecount-sync.sh

set -e
cd /home/ubuntu/factory-app || exit 1

echo "=== 1. git pull ==="
git pull origin main

echo ""
echo "=== 2. npm ci ==="
npm ci

echo ""
echo "=== 3. npm run build ==="
if ! npm run build; then
  echo "BUILD_FAILED"
  exit 1
fi

echo ""
echo "=== 4. pm2 restart ==="
pm2 restart factory-app

echo ""
echo "=== 5. pm2 status ==="
pm2 status

echo ""
echo "=== 6. route 파일 존재 여부 ==="
find src/app/api -type f 2>/dev/null | grep -E "ecount-inventory|sync" || echo "NOT_FOUND"

echo ""
echo "=== 7. curl POST (sync API) ==="
curl -i -s -X POST https://factory.armoredfresh.com/api/internal/ecount-inventory/sync \
  -H "Content-Type: application/json" \
  -H "x-sync-token: af_factory_sync_2026_J7mP4qX9vN2kR8tH5cL1zW6sY3uD0eFa" \
  -d '{"masterRows":[],"inventoryRows":[]}' | head -30

echo ""
echo "=== 8. curl GET (라우트 확인) ==="
curl -s -o /dev/null -w "%{http_code}" https://factory.armoredfresh.com/api/internal/ecount-inventory/sync
echo ""
