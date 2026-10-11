import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, cleanString } from '../utils/validation.js';
import { recordAuthAttempt } from '../services/authRateLimit.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { requireActiveUser } from '../middleware/session.js';
import { seedWorkspace } from '../services/demoSeed.js';
const router = Router();
const SESSION_COOKIE = 'opsmitra_session';
const MAX_ATTEMPTS = Number(process.env.AUTH_MAX_ATTEMPTS || 30);
const RESET_MINUTES = 30;
let cleanupCounter = 0;
function configuredJwtSecret() {
  const secret = process.env.JWT_SECRET;
  return secret && secret.length >= 32 && !secret.startsWith('replace_with_') ? secret : null;
}
function requireJwtConfiguration(_req, res, next) {
  if (!configuredJwtSecret()) return res.status(503).json({ error: 'AUTH_NOT_CONFIGURED', message: 'JWT_SECRET is not configured. Set a random secret of at least 32 characters in server/.env, then restart the API.' });
  return next();
}
async function throttle(req, res, next) {
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  const clientKey = createHash('sha256').update(address).digest('hex');
  try {
    const attempts = await recordAuthAttempt(pool, clientKey);
    if (++cleanupCounter % 256 === 0) {
      const cleanupSql = pool.driver === 'sqlite'
        ? "DELETE FROM auth_attempt_limits WHERE window_started_at < datetime('now', '-1 day')"
        : 'DELETE FROM auth_attempt_limits WHERE window_started_at < UTC_TIMESTAMP() - INTERVAL 1 DAY';
      pool.execute(cleanupSql).catch(() => {});
    }
    if (attempts > MAX_ATTEMPTS) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
    return next();
  } catch {
    return res.status(503).json({ error: 'AUTH_RATE_LIMIT_UNAVAILABLE', message: 'Sign-in is temporarily unavailable. Please try again shortly.' });
  }
}
function tokenFor(user) {
  const secret = configuredJwtSecret();
  if (!secret) {
    const error = new Error('JWT_SECRET is not configured. Set a random secret of at least 32 characters in server/.env.');
    error.status = 503; error.code = 'AUTH_NOT_CONFIGURED'; throw error;
  }
  return jwt.sign({ sub: String(user.id), email: user.email, name: user.name, tv: Number(user.tokenVersion || 0) }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}
function sessionCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api' };
}
const userColumns = 'id, name, email, token_version AS tokenVersion, is_demo AS isDemo, business_name AS businessName, business_type AS businessType, business_phone AS businessPhone, business_address AS businessAddress, gstin, created_at AS createdAt';
const publicUser = row => ({ id: Number(row.id), name: row.name, email: row.email, isDemo: Number(row.isDemo || 0) === 1, businessName: row.businessName ?? null, businessType: row.businessType ?? null, businessPhone: row.businessPhone ?? null, businessAddress: row.businessAddress ?? null, gstin: row.gstin ?? null, createdAt: row.createdAt });
async function loadUser(id) { const [rows] = await pool.execute(`SELECT ${userColumns} FROM users WHERE id = ?`, [id]); return rows[0] || null; }
function authResponse(req, res, status, row) {
  const token = tokenFor(row);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  const data = { user: publicUser(row) };
  if (req.get('x-opsmitra-auth-mode') === 'bearer') data.token = token;
  res.status(status).json({ data });
}
function passwordProblem(password) {
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return 'Password must be at least 8 characters and at most 72 UTF-8 bytes.';
  return null;
}

router.post('/register', throttle, requireJwtConfiguration, asyncHandler(async (req, res) => {
  const name = cleanString(req.body.name);
  const email = cleanString(req.body.email).toLowerCase();
  const businessName = cleanString(req.body.businessName).slice(0, 160) || null;
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Name must be between 2 and 120 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Enter a valid email address.' });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: 'VALIDATION_ERROR', message: problem });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute('INSERT INTO users (name, email, password_hash, business_name) VALUES (?, ?, ?, ?)', [name, email, passwordHash, businessName]);
    authResponse(req, res, 201, await loadUser(result.insertId));
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'An account with this email already exists.' }); throw error; }
}));

router.post('/login', throttle, requireJwtConfiguration, asyncHandler(async (req, res) => {
  const email = cleanString(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (Buffer.byteLength(password, 'utf8') > 72) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
  const [rows] = await pool.execute('SELECT id, password_hash FROM users WHERE email = ? LIMIT 1', [email]);
  const found = rows[0];
  if (!found || !(await bcrypt.compare(password, found.password_hash))) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
  authResponse(req, res, 200, await loadUser(found.id));
}));

// One-click isolated demo workspace with 90 days of realistic sample data.
router.post('/demo', throttle, requireJwtConfiguration, asyncHandler(async (req, res) => {
  const stamp = randomBytes(5).toString('hex');
  const passwordHash = await bcrypt.hash(randomUUID(), 4);
  const connection = await pool.getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    // Expire abandoned demo workspaces so the database does not grow without bound.
    await connection.execute("DELETE FROM users WHERE is_demo = 1 AND created_at < datetime('now', '-2 days')");
    const [created] = await connection.execute("INSERT INTO users (name, email, password_hash, is_demo, business_name, business_type, business_phone, business_address, gstin) VALUES (?, ?, ?, 1, ?, 'Retail / Kirana', '+91 98765 43210', '12, Market Road, Chennai 600001', '33ABCDE1234F1Z5')", ['Demo Owner', `demo-${stamp}@opsmitra.demo`, passwordHash, 'Sri Lakshmi Provisions']);
    userId = Number(created.insertId);
    await seedWorkspace(connection, userId);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  authResponse(req, res, 201, await loadUser(userId));
}));

router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.status(204).end();
});

// Password recovery. There is no email service in the prototype, so (outside production) the
// one-time link is returned in the response and printed to the API log instead of being mailed.
router.post('/forgot-password', throttle, asyncHandler(async (req, res) => {
  const email = cleanString(req.body.email).toLowerCase();
  const generic = { message: 'If an account exists for that email, a reset link has been prepared.' };
  const [rows] = await pool.execute('SELECT id FROM users WHERE email = ? AND is_demo = 0', [email]);
  if (!rows.length) return res.json({ data: generic });
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  await pool.execute("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', ?))", [rows[0].id, hash, `+${RESET_MINUTES} minutes`]);
  const flag = process.env.PROTOTYPE_RESET_LINKS;
  const showLink = flag === 'true' || (process.env.NODE_ENV !== 'production' && flag !== 'false');
  const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const resetLink = `${origin}/reset-password/${token}`;
  if (showLink) console.log(`[OpsMitra prototype] Password reset link for ${email}: ${resetLink}`);
  res.json({ data: { ...generic, ...(showLink ? { resetLink, prototypeNotice: 'Email delivery is not configured in this prototype, so the link is shown here.' } : {}) } });
}));

router.post('/reset-password', throttle, asyncHandler(async (req, res) => {
  const token = cleanString(req.body.token);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const problem = passwordProblem(password);
  if (problem) return badRequest(res, problem, 'password');
  const hash = createHash('sha256').update(token).digest('hex');
  const [rows] = await pool.execute("SELECT id, user_id AS userId FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')", [hash]);
  if (!rows.length) return res.status(400).json({ error: 'RESET_LINK_INVALID', message: 'This reset link is invalid or has expired. Request a new one.' });
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.execute('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [passwordHash, rows[0].userId]);
  await pool.execute("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL", [rows[0].userId]);
  res.json({ data: { message: 'Password updated. You can sign in with your new password.' } });
}));

// Quiet "who am I?" for the browser app: 200 with user:null when signed out (no 401 noise in the console).
router.get('/session', optionalAuth, asyncHandler(async (req, res) => {
  if (!req.user) return res.json({ data: { user: null } });
  const row = await loadUser(Number(req.user.sub));
  if (!row || Number(row.tokenVersion) !== Number(req.user.tv ?? 0)) return res.json({ data: { user: null } });
  res.json({ data: { user: publicUser(row) } });
}));

// Everything below needs a signed-in, non-revoked session.
router.use(requireJwtConfiguration, requireAuth, requireActiveUser);

router.get('/me', asyncHandler(async (req, res) => {
  const user = await loadUser(req.account.id);
  res.json({ data: { user: publicUser(user) } });
}));

router.patch('/profile', asyncHandler(async (req, res) => {
  const current = await loadUser(req.account.id);
  const pick = (key, fallback, max) => req.body[key] === undefined ? fallback : (cleanString(req.body[key]).slice(0, max) || null);
  const name = req.body.name === undefined ? current.name : cleanString(req.body.name);
  if (name.length < 2 || name.length > 120) return badRequest(res, 'Name must be between 2 and 120 characters.', 'name');
  const gstin = req.body.gstin === undefined ? current.gstin : (cleanString(req.body.gstin).toUpperCase() || null);
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) return badRequest(res, 'GSTIN must be 15 letters/digits.', 'gstin');
  await pool.execute('UPDATE users SET name = ?, business_name = ?, business_type = ?, business_phone = ?, business_address = ?, gstin = ? WHERE id = ?',
    [name, pick('businessName', current.businessName, 160), pick('businessType', current.businessType, 80), pick('businessPhone', current.businessPhone, 32), pick('businessAddress', current.businessAddress, 300), gstin, req.account.id]);
  const user = await loadUser(req.account.id);
  authResponse(req, res, 200, user); // refresh the cookie so the token carries the new name
}));

router.post('/change-password', asyncHandler(async (req, res) => {
  if (req.account.isDemo) return res.status(403).json({ error: 'DEMO_RESTRICTED', message: 'Passwords cannot be changed in a demo workspace.' });
  const current = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  const problem = passwordProblem(next);
  if (problem) return badRequest(res, problem, 'newPassword');
  const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.account.id]);
  if (Buffer.byteLength(current, 'utf8') > 72 || !(await bcrypt.compare(current, rows[0].password_hash))) return res.status(400).json({ error: 'INVALID_CREDENTIALS', message: 'Your current password is incorrect.', field: 'currentPassword' });
  await pool.execute('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [await bcrypt.hash(next, 12), req.account.id]);
  authResponse(req, res, 200, await loadUser(req.account.id)); // other devices are signed out, this one stays signed in
}));

router.post('/logout-all', asyncHandler(async (req, res) => {
  await pool.execute('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.account.id]);
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.status(204).end();
}));
export default router;
