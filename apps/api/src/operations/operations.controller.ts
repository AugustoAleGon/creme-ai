import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { OperationsService } from './operations.service.js';
import { parseAcceptance, parseEmployerDecision, parseSchedule } from './input.js';

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post('roster-assignments/:id/employer-decision')
  @HttpCode(200)
  employerDecision(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.operations.employerDecision(userId, id, parseEmployerDecision(body));
  }

  @Post('roster-assignments/:id/acceptance')
  @HttpCode(200)
  acceptance(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.operations.acceptance(userId, id, parseAcceptance(body));
  }

  @Get('job-orders/:id/readiness')
  readiness(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string) {
    return this.operations.readiness(userId, id);
  }

  @Post('appointments/:id/schedule')
  @HttpCode(200)
  schedule(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.operations.schedule(userId, id, parseSchedule(body));
  }
}
