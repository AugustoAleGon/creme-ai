import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { DocumentsService } from './documents.service.js';
import { parseReview, parseSubmission } from './input.js';

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('mobile/submissions')
  submit(@Headers('x-user-id') userId: string | undefined, @Body() body: unknown) {
    return this.documents.submit(userId, parseSubmission(body));
  }

  @Post('document-versions/:id/review')
  @HttpCode(200)
  review(@Headers('x-user-id') userId: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.review(userId, id, parseReview(body));
  }
}
