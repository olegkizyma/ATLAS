import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server.js';

const agent = request(app);

test('orchestrator health', async (t) => {
  const res = await agent.get('/health').expect(200);
  assert.equal(res.body.status, 'ok');
});

test('orchestrator agents endpoint', async (t) => {
  const res = await agent.get('/agents').expect(200);
  assert.ok(res.body.atlas);
  assert.ok(res.body.tetyana);
  assert.ok(res.body.grisha);
});
