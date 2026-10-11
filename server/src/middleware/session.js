import { pool } from '../db.js';

/**
 * Runs after requireAuth. Confirms the account still exists and the token has not been revoked
 * (password change / "sign out everywhere" bump users.token_version).
 */
export async function requireActiveUser(req, res, next) {
  try {
    const [rows] = await pool.execute('SELECT id, name, email, token_version AS tokenVersion, is_demo AS isDemo FROM users WHERE id = ?', [Number(req.user.sub)]);
    const account = rows[0];
    if (!account || Number(account.tokenVersion) !== Number(req.user.tv ?? 0)) {
      return res.status(401).json({ error: 'SESSION_REVOKED', message: 'Your session has ended. Please sign in again.' });
    }
    req.account = { id: Number(account.id), name: account.name, email: account.email, isDemo: Number(account.isDemo) === 1 };
    return next();
  } catch (error) { return next(error); }
}
