/**
 * First-time setup for a real (non-demo) restaurant: creates the restaurant,
 * its stations and the first manager account. Everything else — checklists,
 * employees, pilot periods — is done by the manager inside the app.
 *
 * Usage:
 *   MANAGER_PASSWORD='...' npm run setup -- \
 *     --restaurant "Your Restaurant" --timezone America/Indiana/Indianapolis \
 *     --station "Bagel Prep" --manager-username jsmith --manager-name "J. Smith"
 *
 * The password is read from the MANAGER_PASSWORD environment variable so it
 * never lands in shell history or source control. If it is not set, a random
 * password is generated and printed once.
 */
import './_env';
import { parseArgs } from 'node:util';
import { createPool, transaction } from '../src/lib/db';
import { generatePassword, hashPassword, PASSWORD_MIN_LENGTH } from '../src/lib/passwords';
import { isValidTimeZone } from '../src/lib/time';

const { values } = parseArgs({
  options: {
    restaurant: { type: 'string' },
    timezone: { type: 'string' },
    station: { type: 'string', multiple: true },
    'manager-username': { type: 'string' },
    'manager-name': { type: 'string' },
  },
});

async function main() {
  const name = values.restaurant?.trim();
  const tz = values.timezone?.trim();
  const stations = (values.station ?? []).map((s) => s.trim()).filter(Boolean);
  const username = values['manager-username']?.trim().toLowerCase();
  const displayName = values['manager-name']?.trim();
  if (!name || !tz || stations.length === 0 || !username || !displayName) {
    throw new Error('Required: --restaurant, --timezone, at least one --station, --manager-username, --manager-name');
  }
  if (!isValidTimeZone(tz)) throw new Error(`Unknown time zone "${tz}". Use an IANA name such as America/Chicago.`);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username: 3–40 characters, letters, numbers, dot, dash or underscore.');

  let password = process.env.MANAGER_PASSWORD ?? '';
  const generated = !password;
  if (generated) password = generatePassword();
  if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`MANAGER_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);

  const pool = createPool();
  try {
    await transaction(async (db) => {
      const existing = await db.query('select id from restaurants where not is_demo');
      if (existing.rows[0]) throw new Error('A restaurant is already set up. StationOps runs one location per database.');
      const r = await db.query<{ id: number }>('insert into restaurants (name, timezone) values ($1, $2) returning id', [name, tz]);
      for (const s of stations) await db.query('insert into stations (restaurant_id, name) values ($1, $2)', [r.rows[0].id, s]);
      await db.query(
        `insert into users (restaurant_id, username, display_name, role, password_hash) values ($1, $2, $3, 'manager', $4)`,
        [r.rows[0].id, username, displayName, await hashPassword(password)],
      );
    }, pool);
  } finally {
    await pool.end();
  }

  console.log(`Created ${name} (${tz}) with ${stations.length} station(s) and manager "${username}".`);
  if (generated) console.log(`Generated password for ${username}: ${password}\nShare it privately; it is not stored anywhere in readable form.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
