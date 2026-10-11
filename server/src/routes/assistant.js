import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, cleanString } from '../utils/validation.js';
import { ask, assistantMode } from '../services/assistant.js';
import { pool } from '../db.js';
const router = Router();
const recent = new Map(); // userId -> timestamps; keeps accidental loops from burning API credit

router.get('/status', (_req, res) => res.json({ data: { mode: assistantMode(), model: assistantMode() === 'claude' ? (process.env.ANTHROPIC_MODEL || 'claude-opus-5-5') : null } }));

router.post('/ask', asyncHandler(async (req, res) => {
  const question = cleanString(req.body.question);
  if (question.length < 2 || question.length > 600) return badRequest(res, 'Ask a question between 2 and 600 characters.', 'question');
  const userId = Number(req.user.sub);
  const now = Date.now();
  const window = (recent.get(userId) || []).filter(t => now - t < 60000);
  if (window.length >= 20) return res.status(429).json({ error: 'RATE_LIMITED', message: 'You are asking too quickly. Please wait a moment.' });
  window.push(now); recent.set(userId, window);
  const history = Array.isArray(req.body.history)
    ? req.body.history.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 2000) })).slice(-8)
    : [];
  // The API requires history to start with a user turn and alternate.
  while (history.length && history[0].role !== 'user') history.shift();
  const clean = history.filter((m, i) => i === 0 || m.role !== history[i - 1].role);
  if (clean.length && clean[clean.length - 1].role === 'user') clean.pop();
  const [[account]] = await pool.execute('SELECT business_name AS businessName FROM users WHERE id = ?', [userId]);
  res.json({ data: await ask(userId, question, clean, account?.businessName || '') });
}));
export default router;
