import { createApp } from './app.js';

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be an integer between 1 and 65535.');
}

const app = await createApp();
await app.listen(port, '127.0.0.1');
console.log(`API listening on http://127.0.0.1:${port}/api`);
