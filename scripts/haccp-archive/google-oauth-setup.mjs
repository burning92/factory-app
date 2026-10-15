#!/usr/bin/env node
// HACCP 전자일지 Drive 보관용 Google 갱신 토큰을 한 번 발급한다(내 PC에서 실행).
// - 권한 범위는 drive.file 하나: 이 앱이 만든 파일·폴더만 읽고 쓸 수 있다. 기존 Drive 파일은 볼 수 없다.
// - 결과 토큰은 화면에만 한 번 출력한다. 파일로 저장하지 않는다. EC2 환경변수에만 넣는다.
//
// 사용법(PowerShell):
//   $env:GOOGLE_OAUTH_CLIENT_ID="..."; $env:GOOGLE_OAUTH_CLIENT_SECRET="..."; node scripts/haccp-archive/google-oauth-setup.mjs
import http from "node:http";
import crypto from "node:crypto";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
if (!clientId || !clientSecret) {
  console.error("GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET 환경변수를 먼저 설정하세요.");
  process.exit(1);
}

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const verifier = crypto.randomBytes(48).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const state = crypto.randomBytes(16).toString("hex");

const server = http.createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const redirectUri = `http://127.0.0.1:${port}/callback`;

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  prompt: "consent",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
}).toString();

console.log("\n아래 주소를 브라우저에서 열고, Drive를 보관할 Google 계정으로 로그인해 허용하세요.\n");
console.log(authUrl.toString());
console.log("\n(이 창은 허용이 끝날 때까지 기다립니다. 127.0.0.1 에서만 응답을 받습니다.)\n");

const code = await new Promise((resolve, reject) => {
  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", redirectUri);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400).end("state 불일치");
      reject(new Error("state 불일치"));
      return;
    }
    const error = url.searchParams.get("error");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(error ? `거부됨: ${error}` : "완료. 이 창을 닫고 터미널을 확인하세요.");
    if (error) reject(new Error(error));
    else resolve(url.searchParams.get("code"));
  });
});
server.close();

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  }),
});
const json = await res.json();
if (!res.ok || !json.refresh_token) {
  console.error("토큰 발급 실패:", json.error ?? res.status, json.error_description ?? "");
  process.exit(1);
}
if (!String(json.scope ?? "").split(" ").every((s) => s === SCOPE)) {
  console.error("요청하지 않은 권한이 포함되어 중단합니다:", json.scope);
  process.exit(1);
}
console.log("발급 완료. 아래 값을 EC2 환경변수 GOOGLE_OAUTH_REFRESH_TOKEN 에만 넣으세요(Git·채팅에 올리지 마세요).\n");
console.log(json.refresh_token);
console.log("");
