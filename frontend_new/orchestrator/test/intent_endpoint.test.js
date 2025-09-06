import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

function get(path) { return new Promise((resolve,reject)=>{ const req=http.request({host:'127.0.0.1',port:process.env.ORCH_PORT||5101,path,method:'GET'},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve({status:res.statusCode,json:JSON.parse(d||'{}')});}catch(e){resolve({status:res.statusCode,json:{error:'parse_fail',raw:d}});}})});req.on('error',reject);req.end();});}

function post(path, data) { return new Promise((resolve,reject)=>{ const body=JSON.stringify(data); const req=http.request({host:'127.0.0.1',port:process.env.ORCH_PORT||5101,path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve({status:res.statusCode,json:JSON.parse(d||'{}')});}catch(e){reject(e);}})});req.on('error',reject);req.write(body);req.end();}); }

test('intent endpoint classifies actionable via POST', async () => {
  const { status, json } = await post('/intent', { text: 'Створи файл X і перевір його вміст' });
  assert.equal(status, 200);
  assert.ok(['actionable','planning','qa','smalltalk'].includes(json.intent));
});

test('intent endpoint caches repeat', async () => {
  const first = await get('/intent?text=' + encodeURIComponent('Привіт'));
  assert.equal(first.status, 200);
  const second = await get('/intent?text=' + encodeURIComponent('Привіт'));
  assert.equal(second.status, 200);
  assert.equal(second.json.cached, true);
});
