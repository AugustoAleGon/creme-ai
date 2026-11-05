import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  readonly db: ReturnType<typeof drizzle>;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 2000,
      statement_timeout: 3000,
    });
    // Idle-client errors happen outside request promises; an unhandled event exits Node.
    this.pool.on('error', () => {
      this.logger.warn('An idle database connection was lost. The next request will reconnect.');
    });
    this.db = drizzle(this.pool);
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
