#!/usr/bin/env bash
# HACCP 전자일지 Drive 보관 동기화(EC2 cron 에서 실행).
# 같은 서버의 Next 앱(127.0.0.1:3000)으로 직접 호출해 nginx 시간 제한을 거치지 않는다.
# 비밀값은 이 파일에 쓰지 않고, 권한 600 인 환경 파일에서 읽는다.
#
# crontab 예시(서버 시간대가 UTC 라면 KST 03:30·12:30 = UTC 18:30·03:30):
#   30 18,3 * * * /home/ubuntu/app/scripts/haccp-archive/cron-sync.sh >> /home/ubuntu/logs/haccp-archive.log 2>&1
set -euo pipefail

ENV_FILE="${HACCP_ARCHIVE_ENV_FILE:-/home/ubuntu/.haccp-archive.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
: "${HACCP_ARCHIVE_SYNC_SECRET:?HACCP_ARCHIVE_SYNC_SECRET 가 없습니다}"
URL="${HACCP_ARCHIVE_SYNC_URL:-http://127.0.0.1:3000/api/internal/haccp-archive/sync}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] 시작"
status=$(curl -sS -o /tmp/haccp-archive-last.json -w '%{http_code}' --max-time 1500 \
  -X POST -H "Authorization: Bearer ${HACCP_ARCHIVE_SYNC_SECRET}" "$URL" || echo "000")
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] HTTP ${status}"
head -c 4000 /tmp/haccp-archive-last.json || true
echo
[ "$status" = "200" ]
