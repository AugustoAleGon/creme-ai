import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@creme/contracts';
import { sql } from 'drizzle-orm';
import { DatabaseService } from './database.service.js';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and database connectivity' })
  @ApiOkResponse({ description: 'API and database available.', example: { status: 'ok', database: 'connected' } })
  @ApiServiceUnavailableResponse({ description: 'Database unavailable; connection details are not exposed.' })
  async health(): Promise<HealthResponse> {
    try {
      await this.database.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return { status: 'ok', database: 'connected' };
  }
}
