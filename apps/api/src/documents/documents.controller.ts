import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { DocumentsService } from './documents.service.js';
import { parseReview, parseSubmission } from './input.js';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { documentType } from '../database/schema.js';

@ApiTags('Documents')
@ApiForbiddenResponse({ description: 'Unknown, inactive, unauthorized caller, or reviewer independence violation.' })
@ApiNotFoundResponse({ description: 'Record missing or outside caller scope.' })
@ApiBadRequestResponse({ description: 'Invalid request body.' })
@ApiConflictResponse({ description: 'Submission key reused with different content, or document already reviewed.' })
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('mobile/submissions')
  @ApiOperation({ summary: 'Submit a worker document', description: 'Assigned worker only. Repeating the same clientSubmissionId and payload returns the original result. fileRef is a reference, not a file upload.' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'Assigned worker user ID. Local demonstration selector, not authentication.', schema: { type: 'string', default: 'w-2' } })
  @ApiBody({ schema: {
    type: 'object', additionalProperties: false,
    required: ['clientSubmissionId', 'rosterAssignmentId', 'documentType', 'fields', 'fileRef'],
    properties: {
      clientSubmissionId: { type: 'string', example: 'swagger-submission-1' },
      rosterAssignmentId: { type: 'string', example: 'RA-2' },
      documentType: { type: 'string', enum: documentType.enumValues, example: 'passport' },
      fields: { type: 'object', minProperties: 1, additionalProperties: { type: 'string', minLength: 1 }, example: { number: 'DEMO-123' } },
      fileRef: { type: 'string', example: 'demo/passport.pdf' },
    },
  } })
  @ApiCreatedResponse({ description: 'Document version created, or original submission receipt replayed.' })
  submit(@Headers('x-user-id') userId: string | undefined, @Body() body: unknown) {
    return this.documents.submit(userId, parseSubmission(body));
  }

  @Post('document-versions/:id/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject a document', description: 'Independent QC reviewer in the same branch. Rejection requires a nonblank reason. The capturist cannot review their own version.' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'Local QC reviewer selector, not authentication.', schema: { type: 'string', default: 'u-luis' } })
  @ApiParam({ name: 'id', example: 'DOC-w-2-passport-1' })
  @ApiBody({ schema: {
    type: 'object', additionalProperties: false, required: ['decision'],
    properties: { decision: { type: 'string', enum: ['approve', 'reject'], example: 'approve' }, reason: { type: 'string', minLength: 1 } },
    oneOf: [
      { properties: { decision: { enum: ['approve'] } } },
      { properties: { decision: { enum: ['reject'] } }, required: ['reason'] },
    ],
  } })
  @ApiOkResponse({ description: 'QC result recorded.', example: { documentVersionId: 'DOC-w-2-passport-1', status: 'approved' } })
  review(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.review(userId, id, parseReview(body));
  }
}
