# nginx 502 원인 요약 (factory.armoredfresh.com POST만 502)

## 가능한 원인

1. **Connection 'upgrade' 고정**
   - `proxy_set_header Connection 'upgrade';` 를 쓰면 nginx가 업스트림(Next.js)에 항상 `Connection: upgrade` 로 요청함.
   - POST/GET 같은 일반 HTTP는 업그레이드하지 않는데, 업스트림이 upgrade를 기대하지 않으면 연결이 비정상 종료되거나 502가 날 수 있음.
   - 일반 페이지(GET)는 캐시/짧은 응답으로 타이밍에 따라 성공할 수 있고, POST(동기화)는 응답이 길어지거나 연결 처리 방식이 달라 502가 더 잘 날 수 있음.

2. **업스트림 타임아웃**
   - `proxy_read_timeout` 등이 없으면 기본 60초. 동기화가 길어지면 업스트림이 끊고 nginx가 502를 반환할 수 있음.

3. **443 서버블록 없음/다름**
   - 현재 repo 설정은 80만 있음. 실제 HTTPS(443)는 다른 파일에서 처리 중일 수 있음. 443 블록에 잘못된 `proxy_pass` 또는 위와 같은 Connection 설정이 있으면 POST만 502가 날 수 있음.

4. **요청 본문/버퍼**
   - POST body가 크거나 버퍼 설정이 부족하면 업스트림 전달 중 끊길 수 있음. `client_max_body_size` 등으로 완화 가능.

**정리:** 일반 페이지는 보이는데 특정 API POST만 502인 경우, **Connection 'upgrade' 고정**과 **타임아웃/버퍼 부족** 가능성이 큼. Next.js 일반 HTTP에는 upgrade를 쓰지 않고, proxy timeouts와 body size를 넉넉히 주는 것이 좋음.
