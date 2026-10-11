/** Create date keys ending on the database-local date, independent of the Node host timezone. */
export function dateKeysEndingAt(databaseDate, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(databaseDate)) || !Number.isInteger(days) || days < 1 || days > 366) {
    throw new TypeError('A valid YYYY-MM-DD date and a day count from 1 to 366 are required.');
  }
  const [year, month, day] = databaseDate.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  if (cursor.getUTCFullYear() !== year || cursor.getUTCMonth() !== month - 1 || cursor.getUTCDate() !== day) {
    throw new TypeError('The database date is invalid.');
  }
  const keys = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(cursor);
    date.setUTCDate(date.getUTCDate() - offset);
    keys.push(date.toISOString().slice(0, 10));
  }
  return keys;
}
