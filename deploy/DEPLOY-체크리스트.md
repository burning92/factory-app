# 배포 체크리스트 — 당신이 할 일

코드/스크립트는 이미 준비되어 있습니다. **아래만 하면 됩니다.**

---

## 1. 코드 반영 (로컬 PC)

```powershell
cd C:\Users\shwo1\Desktop\fcatory-app
git add .
git commit -m "메시지"
git push origin main
```

---

## 2. EC2 배포 실행 (둘 중 하나만 하면 됨)

### 방법 A — 한 번에 (PowerShell에서)

로컬에서 아래 한 줄 실행하면, EC2 접속 + pull + 빌드 + 재시작까지 자동으로 됩니다.

```powershell
cd C:\Users\shwo1\Desktop\fcatory-app
.\scripts\deploy-remote.ps1
```

- SSH 키 경로가 다르면 `scripts/deploy-remote.ps1` 안의 `$SSH_KEY` 를 수정하세요.

### 방법 B — 직접 EC2 접속해서

1. SSH 접속:
   ```powershell
   ssh -i "C:\Users\shwo1\Desktop\fcatory-app\factory.key\FactoryB.pem" ubuntu@ec2-3-39-194-223.ap-northeast-2.compute.amazonaws.com
   ```
2. 배포 스크립트 실행:
   ```bash
   cd /home/ubuntu/factory-app
   bash scripts/deploy-ec2-ecount-sync.sh
   ```

---

## 3. 최초 1회만 (이미 했으면 생략)

| 할 일 | 설명 |
|--------|------|
| **EC2에 pm2로 앱 등록** | 서버에서 `cd /home/ubuntu/factory-app && npm run build` 후 `pm2 start npm --name factory-app -- start` 한 번만 실행 (pm2 없으면 `npm i -g pm2`) |
| **.env.production** | EC2의 `/home/ubuntu/factory-app/.env.production` 에 Supabase URL/Anon Key 설정 (가이드: `deploy/EC2-접속-및-HTTPS-가이드.md`) |
| **nginx 설정** | `deploy/APPLY-NGINX-EC2.md` 따라 적용 |
| **HTTPS** | `deploy/EC2-접속-및-HTTPS-가이드.md` 의 Certbot 절차 |

---

## 4. 배포 후 확인

- 브라우저: **https://factory.armoredfresh.com**
- 문제 있으면: EC2에서 `pm2 logs factory-app` 으로 로그 확인
