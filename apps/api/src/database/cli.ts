import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { SeedRefusal, seedDatabase } from './seed.js';

const usage = 'Usage: database <migrate|seed>\nSeed applies migrations, initializes an empty database, and preserves existing seeded data on replay.\n';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(usage);
    return;
  }
  if (args.length !== 1 || !['migrate', 'seed'].includes(args[0] ?? '')) throw new Error(usage);
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error('DATABASE_URL is required.');
  const url = new URL(configured);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol.');
  const client = new Client({ connectionString: configured, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    // Serialize schema installation across CLI processes; connection close releases the lock.
    await client.query("SELECT pg_advisory_lock(hashtext('creme:database-cli'))");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    if (args[0] === 'seed') {
      const result = await seedDatabase(db);
      process.stdout.write(result === 'created' ? 'Seed data created.\n' : 'Seed already applied; existing data preserved.\n');
    } else {
      process.stdout.write('Database migrations applied.\n');
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  // Driver errors can contain credentials or document values. Never echo them.
  process.stderr.write(error instanceof SeedRefusal ? `${error.message}\n` : `Database command failed. Check arguments, DATABASE_URL and database availability.\n${usage}`);
  process.exitCode = 1;
});
