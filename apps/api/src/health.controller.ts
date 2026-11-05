import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@creme/contracts';
import { sql } from 'drizzle-orm';
import { DatabaseService } from './database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async health(): Promise<HealthResponse> {
    try {
      await this.database.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return { status: 'ok', database: 'connected' };
  }
}
