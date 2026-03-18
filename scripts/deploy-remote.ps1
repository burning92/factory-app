# ============================================================
# 로컬(Windows)에서 실행: EC2에 SSH 접속 후 자동 배포
# 사용 전: 1) git push 완료 2) 아래 SSH_KEY 경로 확인
# ============================================================

$SSH_KEY = "C:\Users\shwo1\Desktop\fcatory-app\factory.key\FactoryB.pem"
$SSH_HOST = "ubuntu@ec2-3-39-194-223.ap-northeast-2.compute.amazonaws.com"

$remoteCmd = "cd /home/ubuntu/factory-app && bash scripts/deploy-ec2-ecount-sync.sh"

Write-Host "=== EC2 원격 배포 시작 ===" -ForegroundColor Cyan
Write-Host "Host: $SSH_HOST"
Write-Host "실행: $remoteCmd"
Write-Host ""

& ssh -i $SSH_KEY $SSH_HOST $remoteCmd

Write-Host ""
Write-Host "=== 완료. https://factory.armoredfresh.com 확인 ===" -ForegroundColor Green
