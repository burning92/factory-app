# EC2 배포 접속 테스트 및 HTTPS 다음 단계

## 접속 정보

- **Host:** ec2-3-39-194-223.ap-northeast-2.compute.amazonaws.com
- **User:** ubuntu
- **SSH 키:** `C:\Users\shwo1\Desktop\fcatory-app\factory.key\FactoryB.pem`
- **도메인:** factory.armoredfresh.com

---

## 1. 접속 테스트 방법

### 도메인이 이미 EC2 IP로 연결된 경우

브라우저에서 열기:

- **http://factory.armoredfresh.com**

### 도메인 연결 전이거나 확인용

EC2 공인 IP로 직접 접속 (nginx가 `server_name factory.armoredfresh.com` 이어도 IP로 접속 가능한 경우가 많음):

- **http://3.39.194.223**  
  (또는 AWS 콘솔에서 해당 인스턴스의 Public IPv4 주소 확인 후 사용)

호스트 헤더로 도메인 지정해서 테스트:

```powershell
curl -H "Host: factory.armoredfresh.com" http://3.39.194.223/
```

### DNS 설정 확인

도메인 factory.armoredfresh.com 이 EC2 공인 IP(3.39.194.223)를 가리키는지 확인:

```powershell
nslookup factory.armoredfresh.com
```

A 레코드가 EC2 IP와 같아야 브라우저에서 도메인으로 접속 가능합니다.

---

## 2. .env.production (Supabase) 반드시 설정

현재 서버에는 **placeholder** 값만 들어 있습니다. Supabase가 동작하려면 실제 값을 넣어야 합니다.

1. SSH 접속:
   ```powershell
   ssh -i "C:\Users\shwo1\Desktop\fcatory-app\factory.key\FactoryB.pem" ubuntu@ec2-3-39-194-223.ap-northeast-2.compute.amazonaws.com
   ```
2. 편집:
   ```bash
   nano /home/ubuntu/factory-app/.env.production
   ```
3. 다음 두 값을 Vercel/로컬 .env.local과 동일하게 설정:
   - `NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=실제_anon_key`
4. 저장 후 **재빌드 및 재시작** (NEXT_PUBLIC_* 는 빌드 시 포함됨):
   ```bash
   cd /home/ubuntu/factory-app
   npm run build
   pm2 restart factory-app
   ```

---

## 3. HTTPS (Certbot) 다음 단계

도메인 factory.armoredfresh.com 이 **이 EC2 IP로 이미 연결된 상태**에서 진행하세요.

1. Certbot 설치 (Ubuntu):
   ```bash
   sudo apt-get update
   sudo apt-get install -y certbot python3-certbot-nginx
   ```
2. 인증서 발급 및 nginx 자동 설정:
   ```bash
   sudo certbot --nginx -d factory.armoredfresh.com
   ```
   - 이메일 입력, 약관 동의, 리다이렉트(HTTP→HTTPS) 선택 시 2번 권장
3. 자동 갱신 테스트:
   ```bash
   sudo certbot renew --dry-run
   ```

이후에는 **https://factory.armoredfresh.com** 으로 접속하면 됩니다.

---

## 4. 유용한 명령어

| 목적 | 명령어 |
|------|--------|
| SSH 접속 | `ssh -i "factory.key\FactoryB.pem" ubuntu@ec2-3-39-194-223.ap-northeast-2.compute.amazonaws.com` |
| 앱 로그 | `pm2 logs factory-app` |
| 앱 재시작 | `pm2 restart factory-app` |
| 앱 상태 | `pm2 list` |
| nginx 설정 테스트 | `sudo nginx -t` |
| nginx 리로드 | `sudo systemctl reload nginx` |
