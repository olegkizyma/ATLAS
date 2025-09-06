import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

// This is a placeholder probing provider state endpoint to ensure it responds

function get(path) { return new Promise((resolve,reject)=>{ const req = http.request({host:'127.0.0.1', port: process.env.ORCH_PORT||5101, path, method:'GET'}, res=>{ let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve({status:res.statusCode, json:JSON.parse(d||'{}')}); }catch(e){ reject(e);} });}); req.on('error',reject); req.end(); }); }

test('providers state endpoint returns JSON', async () => {
  const { status, json } = await get('/providers/state');
  assert.equal(status, 200);
  assert.ok(json, 'json returned');
});
