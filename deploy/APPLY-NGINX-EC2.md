# EC2에서 nginx 설정 적용 순서

아래는 **EC2에 SSH 접속한 뒤** 실행할 명령입니다.  
설정 파일 경로(`/etc/nginx/sites-available/` 등)는 서버 구조에 맞게 수정하세요.

```bash
# 1) 프로젝트에서 최신 설정 복사 (경로는 실제 EC2 경로로)
sudo cp /home/ubuntu/factory-app/deploy/nginx-factory-app.conf /etc/nginx/sites-available/factory.armoredfresh.com.conf

# 2) sites-enabled에 심볼릭 링크가 없다면
# sudo ln -sf /etc/nginx/sites-available/factory.armoredfresh.com.conf /etc/nginx/sites-enabled/

# 3) 설정 문법 검사
sudo nginx -t

# 4) nginx 리로드
sudo systemctl reload nginx

# 5) POST 테스트 (200 또는 401 기대)
curl -i -X POST https://factory.armoredfresh.com/api/internal/ecount-inventory/sync \
  -H "Content-Type: application/json" \
  -H "x-sync-token: YOUR_TOKEN" \
  -d '{"masterRows":[],"inventoryRows":[]}'
```

**참고:**  
- SSL 인증서 경로가 다르면 `nginx-factory-app.conf` 안의 `ssl_certificate` / `ssl_certificate_key` 를 수정한 뒤 복사하세요.  
- 기존에 443을 다른 server 블록에서 쓰고 있다면, 해당 파일을 비활성화하거나 이 설정과 병합해야 합니다.
