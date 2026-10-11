const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status, code, field, extra } = {}) { super(message); this.status = status; this.code = code; this.field = field; this.extra = extra; }
}

/** Low-level request. Returns the parsed JSON envelope ({ data, meta }). The HttpOnly cookie carries the session. */
async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-OpsMitra-Request'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: 'include' });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the OpsMitra server. Check that it is running and try again.', { status: 0, code: 'NETWORK' });
  }
  const json = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register') && !path.startsWith('/auth/demo')) {
      window.dispatchEvent(new CustomEvent('opsmitra:unauthorized'));
    }
    throw new ApiError(json?.message || `Request failed (${response.status}).`, { status: response.status, code: json?.error, field: json?.field, extra: json });
  }
  return json;
}

export const api = {
  get: (path, opts) => request(path, opts).then(j => j?.data ?? j),
  /** For paginated lists: { data, meta }. */
  page: (path, opts) => request(path, opts).then(j => ({ rows: j?.data ?? [], meta: j?.meta ?? null })),
  post: (path, body = {}) => request(path, { method: 'POST', body }).then(j => j?.data ?? j),
  patch: (path, body = {}) => request(path, { method: 'PATCH', body }).then(j => j?.data ?? j),
  del: path => request(path, { method: 'DELETE' })
};

/** Build "?a=1&b=2" skipping empty values. */
export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== 'all') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function newRequestKey() {
  return globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}
