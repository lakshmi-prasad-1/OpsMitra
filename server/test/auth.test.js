import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../src/middleware/auth.js';

const secret = 'auth-middleware-test-secret-with-at-least-32-characters';
process.env.JWT_SECRET = secret;
const token = jwt.sign({ sub: '12', email: 'owner@example.com', name: 'Owner' }, secret, { expiresIn: '1h' });

function invokeAuth({ method = 'GET', headers = {} } = {}) {
  const result = { status: 200, body: null, continued: false };
  const req = { method, headers };
  const res = {
    status(status) { result.status = status; return this; },
    json(body) { result.body = body; return this; }
  };
  requireAuth(req, res, () => { result.continued = true; result.user = req.user; });
  return result;
}

test('bearer tokens remain accepted for API clients', () => {
  const result = invokeAuth({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(result.continued, true);
  assert.equal(result.user.sub, '12');
});

test('HttpOnly cookie sessions authenticate safe requests', () => {
  const result = invokeAuth({ headers: { cookie: `other=value; opsmitra_session=${token}` } });
  assert.equal(result.continued, true);
});

test('cookie-authenticated mutations require the custom request header', () => {
  const rejected = invokeAuth({ method: 'POST', headers: { cookie: `opsmitra_session=${token}` } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, 'CSRF_VALIDATION_FAILED');

  const accepted = invokeAuth({ method: 'PATCH', headers: { cookie: `opsmitra_session=${token}`, 'x-opsmitra-request': '1' } });
  assert.equal(accepted.continued, true);
});

test('missing and invalid sessions are rejected', () => {
  assert.equal(invokeAuth().status, 401);
  assert.equal(invokeAuth({ headers: { cookie: 'opsmitra_session=invalid' } }).status, 401);
});