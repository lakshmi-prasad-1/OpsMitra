export async function recordAuthAttempt(db, clientKey) {
  const upsert = db.driver === 'sqlite'
    ? `INSERT INTO auth_attempt_limits (client_key, window_started_at, attempt_count)
       VALUES (?, datetime('now'), 1)
       ON CONFLICT(client_key) DO UPDATE SET
         attempt_count = CASE WHEN window_started_at <= datetime('now', '-15 minutes') THEN 1 ELSE attempt_count + 1 END,
         window_started_at = CASE WHEN window_started_at <= datetime('now', '-15 minutes') THEN datetime('now') ELSE window_started_at END`
    : `INSERT INTO auth_attempt_limits (client_key, window_started_at, attempt_count)
       VALUES (?, UTC_TIMESTAMP(), 1)
       ON DUPLICATE KEY UPDATE
         attempt_count = IF(window_started_at <= UTC_TIMESTAMP() - INTERVAL 15 MINUTE, 1, attempt_count + 1),
         window_started_at = IF(window_started_at <= UTC_TIMESTAMP() - INTERVAL 15 MINUTE, UTC_TIMESTAMP(), window_started_at)`;
  await db.execute(upsert, [clientKey]);
  const [rows] = await db.execute('SELECT attempt_count AS attemptCount FROM auth_attempt_limits WHERE client_key = ?', [clientKey]);
  if (!rows.length) throw new Error('Authentication rate-limit counter was not persisted.');
  return Number(rows[0].attemptCount);
}