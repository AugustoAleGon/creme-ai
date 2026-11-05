import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController, DocumentsController], providers: [DatabaseService, DocumentsService] })
export class AppModule {}
