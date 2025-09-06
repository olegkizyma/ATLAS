import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

// Simple helper to POST JSON
function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      host: '127.0.0.1',
      port: process.env.ORCH_PORT || 5101,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d='';
      res.on('data', c=> d+=c);
      res.on('end', ()=>{
        try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Assumes orchestrator already running in immediate mode (EXECUTION_MODE=immediate)

test('pipeline immediate mode returns execution + verdict in single /chat call', async (t) => {
  if ((process.env.EXECUTION_MODE || 'staged') !== 'immediate') {
    console.warn('Skipping immediate mode test because EXECUTION_MODE != immediate');
    return;
  }
  const userMessage = 'Створи файл demo.txt зі словом TEST і підтвердь виконання';
  const { status, json } = await post('/chat', { message: userMessage, sessionId: 'immediate-test-1' });
  assert.equal(status, 200, 'HTTP 200 expected');
  assert.ok(json.success, 'success flag');
  const phases = json.response.map(r => r.phase);
  // Expect at least atlas_plan, grisha_precheck, execution, grisha_verdict
  const required = ['atlas_plan','grisha_precheck','execution','grisha_verdict'];
  for (const ph of required) {
    assert.ok(phases.includes(ph), `phase ${ph} present`);
  }
  const verdict = json.response.find(r => r.phase === 'grisha_verdict');
  assert.ok(verdict.verification && typeof verdict.verification.confidence === 'number', 'verdict has verification');
});
