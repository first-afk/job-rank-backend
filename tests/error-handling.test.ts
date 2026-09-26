// Audience: maintainers. Offline HTTP regression for the real app and shared handler.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';

const realRequest = http.request;
const realConnect = net.Socket.prototype.connect;
const ports = new Set<number>();
let deniedConnections = 0;
const deny = () => { deniedConnections++; throw new Error('Outbound network disabled'); };
globalThis.fetch = deny;
http.request = deny as typeof http.request;
https.request = deny as typeof https.request;
net.Socket.prototype.connect = function (...args: any[]) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  if (!options || typeof options !== 'object' || options.host !== '127.0.0.1' || !ports.has(Number(options.port))) return deny();
  return realConnect.apply(this, args as any);
} as typeof net.Socket.prototype.connect;

// Never read the copied .env; override every required setting before app import.
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'test', PORT: '3000',
  FRONTEND_URL: 'http://127.0.0.1', SUPABASE_URL: 'https://synthetic.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', SUPABASE_SECRET_KEY: 'synthetic-secret',
  OPENROUTER_API_KEY: 'synthetic-openrouter', JOBSDB_API_KEY: 'synthetic-jobs',
});
const { app } = await import('../src/app.js');
const { errorHandler, AppError } = await import('../src/middleware/error-handling.js');
const { candidateDocumentUpload } = await import('../src/modules/candidate/candidate_upload.middleware.js');
const canary = 'PRIVATE_BODY_CANARY_20260926';

async function withServer(application: express.Express, check: (port: number) => Promise<void>) {
  const server = application.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const port = (server.address() as net.AddressInfo).port;
    ports.add(port);
    try { await check(port); } finally { ports.delete(port); }
  } finally {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
}

function request(port: number, path: string, body?: string, contentType = 'application/json') {
  return new Promise<{ status: number; text: string; json: any }>((resolve, reject) => {
    const req = realRequest({ hostname: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'content-type': contentType, 'content-length': Buffer.byteLength(body) } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => text += chunk);
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode!, text, json }); });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('HTTP test timed out')));
    req.end(body);
  });
}

test('installed app returns safe auth and JSON errors over HTTP', async () => {
  await withServer(app, async port => {
    const cases = [
      ['/v1/me', undefined, 401, 'UNAUTHENTICATED'],
      ['/v1/me', `{"private":"${canary}",BROKEN`, 400, 'INVALID_JSON'],
      ['/v1/me', JSON.stringify({ private: canary, text: 'x'.repeat(1024 * 1024) }), 413, 'PAYLOAD_TOO_LARGE'],
    ] as const;
    const results = [];
    for (const [path, body, status, code] of cases) {
      const response = await request(port, path, body);
      results.push({ expected: { status, code }, actual: { status: response.status, code: response.json?.error?.code }, leaksCanary: response.text.includes(canary) });
    }
    assert.deepEqual(results.map(r => r.actual), results.map(r => r.expected));
    assert.ok(results.every(r => !r.leaksCanary));
  });
});

test('shared handler maps application, Zod, Multer, and unknown errors without a logger', async () => {
  const fixture = express();
  fixture.get('/forbidden', () => { throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is inactive.'); });
  fixture.get('/not-found', () => { throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.'); });
  fixture.get('/validation', () => { z.object({ count: z.number() }).parse({ count: canary }); });
  fixture.get('/unknown', () => { throw new Error(canary); });
  fixture.get('/forged-status', () => { throw { status: 401, message: canary }; });
  fixture.post('/upload', multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 } }).single('file'), (_req, res) => res.sendStatus(204));
  fixture.post('/candidate-upload', candidateDocumentUpload.single('file'), (_req, res) => res.sendStatus(204));
  fixture.use(errorHandler);
  await withServer(fixture, async port => {
    for (const [path, expectedStatus, expectedCode] of [
      ['/forbidden', 403, 'ACCOUNT_INACTIVE'], ['/not-found', 404, 'ACCOUNT_NOT_FOUND'],
      ['/validation', 422, 'VALIDATION_ERROR'], ['/unknown', 500, 'INTERNAL_SERVER_ERROR'],
      ['/forged-status', 500, 'INTERNAL_SERVER_ERROR'],
    ] as const) {
      const response = await request(port, path);
      assert.equal(response.status, expectedStatus, path);
      assert.equal(response.json?.error?.code, expectedCode, path);
      assert.ok(!response.text.includes(canary), path);
    }
    for (const [field, content, status, code] of [['file', canary, 413, 'UPLOAD_TOO_LARGE'], ['wrong', 'x', 400, 'INVALID_UPLOAD']] as const) {
      const multipart = `--fixture\r\nContent-Disposition: form-data; name="${field}"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--fixture--\r\n`;
      const response = await request(port, '/upload', multipart, 'multipart/form-data; boundary=fixture');
      assert.equal(response.status, status);
      assert.equal(response.json?.error?.code, code);
      assert.ok(!response.text.includes(canary));
    }
    const multipart = `--fixture\r\nContent-Disposition: form-data; name="file"; filename="test.exe"\r\nContent-Type: application/octet-stream\r\n\r\n${canary}\r\n--fixture--\r\n`;
    const unsupported = await request(port, '/candidate-upload', multipart, 'multipart/form-data; boundary=fixture');
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.json?.error?.code, 'UNSUPPORTED_DOCUMENT_TYPE');
    assert.ok(!unsupported.text.includes(canary));
  });
});

test('logs contain only safe classification and headersSent delegates once', async () => {
  const entries: unknown[] = [];
  const fixture = express();
  fixture.use((req, _res, next) => { req.log = { error: (...args: unknown[]) => entries.push(args) } as any; next(); });
  fixture.use(express.json());
  fixture.get('/unknown', () => { throw new Error(canary); });
  const sentError = new Error('synthetic stream failure');
  let delegated = 0;
  fixture.get('/sent', (_req, res, next) => { res.write('started'); next(sentError); });
  fixture.use(errorHandler);
  fixture.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { assert.equal(error, sentError); delegated++; res.end(' ended'); });
  await withServer(fixture, async port => {
    assert.equal((await request(port, '/unknown')).status, 500);
    assert.equal((await request(port, '/', `{${canary}`)).status, 400);
    assert.equal((await request(port, '/sent')).text, 'started ended');
  });
  assert.equal(delegated, 1);
  assert.ok(entries.length >= 2);
  assert.ok(!JSON.stringify(entries).includes(canary));
  assert.equal(deniedConnections, 0, 'No unexpected network attempts');
});
