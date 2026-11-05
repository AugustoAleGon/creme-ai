import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const config = new DocumentBuilder()
    .setTitle('Creme Operations API')
    .setDescription('Local demonstration API. Set X-User-Id for each request; this is not production authentication. Try it out executes real operations and POST requests change the connected database. Start with GET readiness using u-pedro.')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: false },
  });
  return app;
}
