import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('API explorer', () => {
  let app: INestApplication;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    // Documentation must be available without opening a database connection.
    process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/swagger_test';
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('serves Swagger UI and its local assets', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(response.text).toContain('swagger-ui');
    await request(app.getHttpServer()).get('/api/docs/swagger-ui-bundle.js').expect(200);
  });

  it('describes all seven routes with executable business request inputs', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const paths = response.body.paths;
    expect(Object.keys(paths).sort()).toEqual([
      '/api/appointments/{id}/schedule', '/api/document-versions/{id}/review',
      '/api/health', '/api/job-orders/{id}/readiness', '/api/mobile/submissions',
      '/api/roster-assignments/{id}/acceptance', '/api/roster-assignments/{id}/employer-decision',
    ]);
    for (const path of Object.keys(paths).filter((path) => path !== '/api/health')) {
      const operation = paths[path].post ?? paths[path].get;
      expect(operation.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'X-User-Id', in: 'header', required: true }),
      ]));
      if (path.includes('{id}')) {
        expect(operation.parameters).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'id', in: 'path', required: true, schema: expect.objectContaining({ example: expect.any(String) }) }),
        ]));
      }
      if (paths[path].post) {
        expect(operation.requestBody.required).toBe(true);
        expect(operation.requestBody.content['application/json'].schema).toHaveProperty('properties');
      }
      expect(operation.responses).toHaveProperty('403');
    }
    expect(paths['/api/mobile/submissions'].post.responses).toHaveProperty('201');
    expect(paths['/api/document-versions/{id}/review'].post.requestBody.content['application/json'].schema)
      .toHaveProperty('oneOf');
  });

  it('preserves health failures and business input validation', async () => {
    const health = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(health.body.message).toBe('Database unavailable');
    const invalid = await request(app.getHttpServer())
      .post('/api/appointments/APT-1/schedule').send({ rosterAssignmentIds: [] }).expect(400);
    expect(invalid.body.message).toBe('Invalid operations request');
  });
});
