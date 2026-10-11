import jwt from 'jsonwebtoken';

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, bearerToken] = header.split(' ');
  const cookieToken = cookieValue(req.headers.cookie, 'opsmitra_session');
  const token = scheme === 'Bearer' ? bearerToken : cookieToken;
  const cookieAuth = scheme !== 'Bearer' && Boolean(cookieToken);
  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
  }
  if (cookieAuth && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-opsmitra-request'] !== '1') {
    return res.status(403).json({ error: 'CSRF_VALIDATION_FAILED', message: 'The request could not be verified. Refresh the page and try again.' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Your session is invalid or expired. Please sign in again.' });
  }
}

/** Like requireAuth, but never rejects: sets req.user when a valid session exists. Used by /auth/session. */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, bearerToken] = header.split(' ');
  const token = scheme === 'Bearer' ? bearerToken : cookieValue(req.headers.cookie, 'opsmitra_session');
  try { if (token && process.env.JWT_SECRET) req.user = jwt.verify(token, process.env.JWT_SECRET); } catch { /* treated as signed out */ }
  next();
}
