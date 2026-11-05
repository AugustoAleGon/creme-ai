import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createServer, connect, type Socket, type AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  let app: INestApplication;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database.');
    }
    process.env.DATABASE_URL = testUrl;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('confirms API connectivity to real PostgreSQL through Drizzle', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'connected' });
  });

  it('returns 503 without exposing connection details when PostgreSQL is unavailable', async () => {
    const testUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://creme:secret@127.0.0.1:1/creme_test';
    const unavailableApp = await createApp();
    process.env.DATABASE_URL = testUrl;
    try {
      await unavailableApp.init();
      const response = await request(unavailableApp.getHttpServer()).get('/api/health');
      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Database unavailable');
      expect(JSON.stringify(response.body)).not.toContain('secret');
    } finally {
      await unavailableApp.close();
    }
  });

  it('stays available after an established idle database connection is lost', async () => {
    const originalTestUrl = process.env.DATABASE_URL!;
    const target = new URL(originalTestUrl);
    const sockets = new Set<Socket>();
    const proxy = createServer((client) => {
      const upstream = connect(Number(target.port || 5432), target.hostname);
      for (const socket of [client, upstream]) {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => { client.destroy(); upstream.destroy(); });
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const proxyUrl = new URL(originalTestUrl);
    proxyUrl.hostname = '127.0.0.1';
    proxyUrl.port = String((proxy.address() as AddressInfo).port);
    process.env.DATABASE_URL = proxyUrl.toString();
    const disruptedApp = await createApp();
    process.env.DATABASE_URL = originalTestUrl;

    try {
      await disruptedApp.init();
      await request(disruptedApp.getHttpServer()).get('/api/health').expect(200);
      // Close only this test's proxy, never the database or another app's sockets.
      await new Promise<void>((resolve) => {
        proxy.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      const response = await request(disruptedApp.getHttpServer()).get('/api/health');
      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Database unavailable');
    } finally {
      for (const socket of sockets) socket.destroy();
      if (proxy.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await disruptedApp.close();
    }
  });
});
