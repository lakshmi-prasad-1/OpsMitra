import 'dotenv/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const dbDriver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const databaseTodaySql = dbDriver === 'sqlite' ? "SELECT DATE('now', 'localtime') AS today" : "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today";
let pool;

if (dbDriver === 'sqlite') {
  const [{ default: Database }, { mkdirSync, readFileSync }] = await Promise.all([
    import('better-sqlite3'), import('node:fs')
  ]);
  const databasePath = resolve(process.env.SQLITE_PATH || resolve(serverDirectory, 'data/opsmitra.sqlite'));
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.exec(readFileSync(resolve(serverDirectory, 'sql/schema.sqlite.sql'), 'utf8'));

  // Ordered, one-time schema upgrades. Each file runs in its own transaction and is recorded,
  // so existing workspaces keep their data while new columns/tables are added.
  const { readdirSync } = await import('node:fs');
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const migrationsDirectory = resolve(serverDirectory, 'sql/sqlite-migrations');
  const applied = new Set(database.prepare('SELECT name FROM schema_migrations').all().map(row => row.name));
  for (const file of readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    database.exec('BEGIN');
    try {
      database.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
      database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new Error(`Database migration ${file} failed: ${error.message}`);
    }
  }

  let queue = Promise.resolve();
  function reserve() {
    const ready = queue;
    let release;
    queue = new Promise(resolveQueue => { release = resolveQueue; });
    return { ready, release };
  }
  function resultFor(sql, params = []) {
    const statement = database.prepare(sql.replace(/\s+FOR UPDATE\s*$/i, ''));
    const values = params.map(value => typeof value === 'boolean' ? Number(value) : value);
    if (statement.reader) return [statement.all(...values), []];
    const result = statement.run(...values);
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }, []];
  }
  async function execute(sql, params = []) {
    const slot = reserve();
    await slot.ready;
    try { return resultFor(sql, params); }
    catch (error) {
      if (String(error.code || '').startsWith('SQLITE_CONSTRAINT_UNIQUE') || String(error.code || '').startsWith('SQLITE_CONSTRAINT_PRIMARYKEY')) error.code = 'ER_DUP_ENTRY';
      throw error;
    } finally { slot.release(); }
  }
  pool = {
    driver: 'sqlite',
    execute,
    query: async sql => {
      const indexMatch = String(sql).match(/^SHOW INDEX FROM ([a-z_]+)$/i);
      if (!indexMatch) return execute(sql);
      const table = indexMatch[1];
      const slot = reserve();
      await slot.ready;
      try {
        const indexes = database.pragma(`index_list(${table})`);
        const rows = indexes.flatMap(index => database.pragma(`index_info(${index.name})`).map((column, position) => ({
          Table: table, Key_name: index.name, Seq_in_index: position + 1, Non_unique: index.unique ? 0 : 1, Column_name: column.name
        })));
        return [rows, []];
      } finally { slot.release(); }
    },
    async getConnection() {
      const slot = reserve();
      await slot.ready;
      let active = true;
      return {
        async beginTransaction() { database.exec('BEGIN IMMEDIATE'); },
        execute(sql, params = []) {
          if (!active) throw new Error('SQLite connection is already released.');
          try { return Promise.resolve(resultFor(sql, params)); }
          catch (error) {
            if (String(error.code || '').startsWith('SQLITE_CONSTRAINT_UNIQUE') || String(error.code || '').startsWith('SQLITE_CONSTRAINT_PRIMARYKEY')) error.code = 'ER_DUP_ENTRY';
            return Promise.reject(error);
          }
        },
        async commit() { database.exec('COMMIT'); },
        async rollback() { if (database.inTransaction) database.exec('ROLLBACK'); },
        release() { if (active) { active = false; slot.release(); } }
      };
    },
    async close() { await execute('PRAGMA optimize'); database.close(); }
  };
} else if (dbDriver === 'mysql') {
  const { default: mysql } = await import('mysql2/promise');
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'opsmitra',
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true,
    dateStrings: true
  });
  pool.driver = 'mysql';
} else {
  throw new Error(`Unsupported DB_DRIVER "${dbDriver}". Use "sqlite" or "mysql".`);
}

export { pool };
