#!/bin/bash
# EC2에서 실행: 이카운트 sync 배포 및 검증
# 사용법: bash scripts/deploy-ec2-ecount-sync.sh

set -e
cd /home/ubuntu/factory-app || exit 1

echo "=== 1. git pull ==="
git fetch origin
# 서버에서 npm이 lockfile을 건드리면 pull이 거부되므로, 마지막 커밋 기준으로 되돌린 뒤 병합
git checkout -- package-lock.json 2>/dev/null || true
git pull origin main
echo "HEAD: $(git rev-parse --short HEAD) $(git log -1 --oneline)"

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
echo "=== 7. curl GET (sync 라우트 확인) ==="
# POST 는 재고 현재고 표를 통째로 바꾸므로 배포 확인에 쓰지 않는다
curl -s -o /dev/null -w "%{http_code}" https://factory.armoredfresh.com/api/internal/ecount-inventory/sync
echo ""
