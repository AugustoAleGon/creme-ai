import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { HealthController } from './health.controller.js';
import { OperationsController } from './operations/operations.controller.js';
import { OperationsService } from './operations/operations.service.js';

@Module({ controllers: [HealthController, DocumentsController, OperationsController], providers: [DatabaseService, DocumentsService, OperationsService] })
export class AppModule {}
