import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

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

test('pipeline staged mode splits execution across /chat then /chat/continue', async () => {
  if ((process.env.EXECUTION_MODE || 'staged') !== 'staged') {
    console.warn('Skipping staged test because EXECUTION_MODE != staged');
    return;
  }
  const sid = 'staged-test-1';
  const first = await post('/chat', { message: 'Створи файл example.txt з текстом HELLO', sessionId: sid });
  assert.equal(first.status, 200);
  const firstPhases = first.json.response.map(r=>r.phase);
  assert.ok(firstPhases.includes('atlas_plan'));
  assert.ok(firstPhases.includes('grisha_precheck'));
  assert.ok(!firstPhases.includes('execution'), 'execution not yet');
  const cont = await post('/chat/continue', { sessionId: sid });
  assert.equal(cont.status, 200);
  const contPhases = cont.json.response.map(r=>r.phase);
  assert.ok(contPhases.includes('execution'));
  assert.ok(contPhases.includes('grisha_verdict'));
});
