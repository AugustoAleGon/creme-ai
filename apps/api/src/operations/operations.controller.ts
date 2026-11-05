import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { OperationsService } from './operations.service.js';
import { parseAcceptance, parseEmployerDecision, parseSchedule } from './input.js';
import { ApiBadRequestResponse, ApiBody, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

@ApiTags('Operations')
@ApiHeader({ name: 'X-User-Id', required: true, description: 'Local caller selector, not authentication. Use u-pedro for the Norte coordinator.', schema: { type: 'string', default: 'u-pedro' } })
@ApiForbiddenResponse({ description: 'Unknown, inactive, or unauthorized caller.' })
@ApiNotFoundResponse({ description: 'Record missing or outside the caller scope.' })
@ApiBadRequestResponse({ description: 'Invalid request body.' })
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post('roster-assignments/:id/employer-decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record employer approval', description: 'Coordinator only. An identical repeat is a no-op.' })
  @ApiParam({ name: 'id', example: 'RA-4' })
  @ApiBody({ schema: {
    type: 'object', additionalProperties: false, required: ['evidence', 'decidedOn'],
    properties: { evidence: { type: 'string', enum: ['document', 'verbal'], example: 'document' }, decidedOn: { type: 'string', format: 'date', example: '2026-11-05' } },
  } })
  @ApiOkResponse({ description: 'Approval recorded.', example: { rosterAssignmentId: 'RA-4', decision: 'approved', evidence: 'document', decidedOn: '2026-11-05' } })
  employerDecision(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.operations.employerDecision(userId, id, parseEmployerDecision(body));
  }

  @Post('roster-assignments/:id/acceptance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record worker acceptance', description: 'Assigned worker: in_app. Coordinator on behalf of worker: verbal. Old terms remain historical evidence and do not pass readiness.' })
  @ApiParam({ name: 'id', example: 'RA-3' })
  @ApiBody({ schema: {
    type: 'object', additionalProperties: false, required: ['termsVersionId', 'method'],
    properties: { termsVersionId: { type: 'string', description: 'Use currentTermsVersionId from GET readiness.' }, method: { type: 'string', enum: ['in_app', 'verbal'], example: 'verbal' } },
  } })
  @ApiOkResponse({ description: 'Acceptance recorded or original evidence returned for an identical assignment/terms pair.' })
  acceptance(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.operations.acceptance(userId, id, parseAcceptance(body));
  }

  @Get('job-orders/:id/readiness')
  @ApiOperation({ summary: 'Inspect readiness and available appointments', description: 'Read-only. Returns currentTermsVersionId, assignment gates/reasons and appointment capacity.' })
  @ApiParam({ name: 'id', example: 'JO-2026-0142' })
  @ApiOkResponse({ description: 'Job order, current terms, assignments with employerApproval/acceptance/documents/qc gates, and appointments.' })
  readiness(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string) {
    return this.operations.readiness(userId, id);
  }

  @Post('appointments/:id/schedule')
  @HttpCode(200)
  @ApiOperation({ summary: 'Schedule a batch of workers', description: 'Coordinator only. Rechecks readiness and capacity. Each assignment returns scheduled, already_scheduled or refused; duplicate IDs are collapsed.' })
  @ApiParam({ name: 'id', example: 'APT-1' })
  @ApiBody({ schema: {
    type: 'object', additionalProperties: false, required: ['rosterAssignmentIds'],
    properties: { rosterAssignmentIds: { type: 'array', minItems: 1, items: { type: 'string' }, example: ['RA-1', 'RA-3'] } },
  } })
  @ApiOkResponse({ description: 'Partial batch results, including refusal reasons and remaining capacity.', example: { appointmentId: 'APT-1', remainingCapacity: 1, results: [{ rosterAssignmentId: 'RA-1', status: 'scheduled' }] } })
  schedule(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.operations.schedule(userId, id, parseSchedule(body));
  }
}
