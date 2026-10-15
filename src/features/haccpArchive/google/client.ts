/** Google REST 호출: OAuth 갱신 토큰으로 접근 토큰을 받아 쓰고, 일시 오류는 지수 대기 후 재시도한다. */

export type GoogleCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export class GoogleApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GoogleClient {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly credentials: GoogleCredentials,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  private async token(force = false): Promise<string> {
    if (!force && this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      refresh_token: this.credentials.refreshToken,
      grant_type: "refresh_token",
    });
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      // 토큰 응답 본문에는 비밀값이 없지만, 오류 사유만 남긴다
      const reason = /"error"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? String(res.status);
      throw new GoogleApiError(`Google 인증 실패(${reason}). 갱신 토큰이 만료되었거나 취소되었습니다.`, res.status, "");
    }
    const json = JSON.parse(text) as { access_token: string; expires_in: number };
    this.accessToken = json.access_token;
    this.expiresAt = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    let refreshed = false;
    for (let attempt = 1; ; attempt += 1) {
      const token = await this.token();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, headers });
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS) throw error;
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.token(true);
        continue;
      }
      if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        await res.text().catch(() => "");
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new GoogleApiError(`Google API 오류 ${res.status}: ${text.slice(0, 300)}`, res.status, text);
      }
      return res;
    }
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(url, init);
    return (await res.json()) as T;
  }
}

export function readGoogleCredentials(env: NodeJS.ProcessEnv = process.env): GoogleCredentials | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID ?? "";
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
  const refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN ?? "";
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}
