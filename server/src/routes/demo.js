import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { seedWorkspace, wipeWorkspace } from '../services/demoSeed.js';
const router = Router();

// Load the sample business into an account that has no products yet.
router.post('/seed', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize seed attempts for the same owner so double-clicks cannot race into duplicate inserts.
    const [owners] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [ownerId]);
    if (!owners.length) { await connection.rollback(); return res.status(401).json({ error: 'ACCOUNT_NOT_FOUND', message: 'This account no longer exists. Please sign in again.' }); }
    const [[existing]] = await connection.execute('SELECT COUNT(*) AS count FROM products WHERE owner_id = ?', [ownerId]);
    if (Number(existing.count) > 0) { await connection.rollback(); return res.status(409).json({ error: 'WORKSPACE_NOT_EMPTY', message: 'Sample data can only be loaded when this workspace has no product records, including inactive products. Your current records were not changed.' }); }
    const summary = await seedWorkspace(connection, ownerId);
    await connection.commit();
    res.status(201).json({ data: { message: 'Sample workspace loaded.', ...summary } });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

// Restore a demo workspace to its original sample data. Real accounts can never be wiped this way.
router.post('/reset', asyncHandler(async (req, res) => {
  if (!req.account?.isDemo) return res.status(403).json({ error: 'DEMO_ONLY', message: 'Only demo workspaces can be reset.' });
  const ownerId = req.account.id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await wipeWorkspace(connection, ownerId);
    const summary = await seedWorkspace(connection, ownerId);
    await connection.commit();
    res.json({ data: { message: 'Demo data restored.', ...summary } });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));
export default router;
