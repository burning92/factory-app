#!/bin/bash
# EC2에서 실행: admin 메뉴 배포/런타임 검증
# 사용법: ssh 접속 후 cd /home/ubuntu/factory-app && bash scripts/verify-ec2-admin-menu.sh

set -e
cd /home/ubuntu/factory-app || exit 1

echo "=== 1. EC2 현재 commit hash ==="
git rev-parse HEAD

echo ""
echo "=== 2. Header.tsx displayMenuItems / 관리 로직 존재 여부 ==="
grep -n "displayMenuItems\|관리 (사업장/사용자)" src/app/components/Header.tsx || echo "NOT_FOUND"

echo ""
echo "=== 3. npm run build (실행) ==="
npm run build

echo ""
echo "=== 4. pm2 restart factory-app ==="
pm2 restart factory-app

echo ""
echo "=== 5. pm2 status ==="
pm2 status

echo ""
echo "=== 6. Next 빌드 산출물에 Header 포함 여부 ==="
ls -la .next/static/chunks/*.js 2>/dev/null | head -5
