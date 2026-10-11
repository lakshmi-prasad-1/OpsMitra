import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const whoami = () => (typeof process.getuid === 'function' ? `uid ${process.getuid()}` : 'this user');

/**
 * Make sure the folder for the SQLite file exists and is writable, or fail with a message that says what to fix.
 * Never deletes, moves or rewrites anything.
 */
export function prepareDatabaseDirectory(databasePath) {
  const directory = dirname(databasePath);
  try {
    mkdirSync(directory, { recursive: true });
    if (!statSync(directory).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    accessSync(directory, constants.W_OK | constants.X_OK);
    for (const file of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (existsSync(file)) accessSync(file, constants.R_OK | constants.W_OK);
    }
  } catch (error) {
    const reason = error.code === 'ENOTDIR' ? `${directory} (or a parent of it) is a file, not a folder` : `${whoami()} cannot write to ${directory} (${error.code || error.message})`;
    throw new Error(
      `Cannot open the database at ${databasePath}: ${reason}. ` +
      'On a hosted volume (Railway, Fly, Docker) the mount is often owned by root: use the provided Docker entrypoint (it fixes ownership and then runs the app as the unprivileged user), ' +
      'or make the folder writable for the user running the server. The database file was not touched.',
      { cause: error }
    );
  }
}
