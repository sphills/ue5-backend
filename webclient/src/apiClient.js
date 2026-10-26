// The WebClient's only way to read or change game data: HTTP calls to the Game API.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class GameApi {
  /**
   * @param {object} o
   * @param {string} o.baseUrl     e.g. http://127.0.0.1:4000
   * @param {string} [o.token]     the player's Game API session token
   * @param {string} [o.clientIp]  forwarded so the API rate-limits per player, not per WebClient
   * @param {string} [o.userAgent]
   * @param {string} [o.requestId]
   */
  constructor({ baseUrl, token = null, clientIp, userAgent, requestId, timeoutMs = 8000, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.clientIp = clientIp;
    this.userAgent = userAgent;
    this.requestId = requestId;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.clientIp) headers['x-forwarded-for'] = this.clientIp;
    if (this.userAgent) headers['user-agent'] = `${this.userAgent.slice(0, 200)} (via WebClient)`;
    if (this.requestId) headers['x-request-id'] = this.requestId;

    let res;
    try {
      res = await this.fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ApiError(503, 'API_UNAVAILABLE', 'Game services are not reachable right now', { cause: err.name });
    }

    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(502, 'BAD_API_RESPONSE', 'Game services sent an unexpected response');
    }
    if (!res.ok) {
      const e = data?.error ?? {};
      throw new ApiError(res.status, e.code ?? 'API_ERROR', e.message ?? `Game API answered ${res.status}`, e.details);
    }
    return data;
  }

  // accounts & sessions
  register(input) {
    return this.request('POST', '/v1/auth/register', { ...input, client: 'web' });
  }
  login(username, password) {
    return this.request('POST', '/v1/auth/login', { username, password, client: 'web' });
  }
  logout() {
    return this.request('POST', '/v1/auth/logout');
  }
  me() {
    return this.request('GET', '/v1/me');
  }
  sessions() {
    return this.request('GET', '/v1/me/sessions');
  }
  revokeSession(id) {
    return this.request('DELETE', `/v1/me/sessions/${encodeURIComponent(id)}`);
  }
  changePassword(currentPassword, newPassword) {
    return this.request('POST', '/v1/me/password', { currentPassword, newPassword });
  }
  history(limit = 20) {
    return this.request('GET', `/v1/me/history?limit=${limit}`);
  }

  // inventory
  inventory() {
    return this.request('GET', '/v1/inventory');
  }
  move(input) {
    return this.request('POST', '/v1/inventory/move', input);
  }
  split(input) {
    return this.request('POST', '/v1/inventory/split', input);
  }
  sell(input) {
    return this.request('POST', '/v1/inventory/sell', input);
  }
  discard(input) {
    return this.request('POST', '/v1/inventory/discard', input);
  }
  sort(input) {
    return this.request('POST', '/v1/inventory/sort', input);
  }
}
