import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/ree.js';
import { fakeRes } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const q = o => ({ query: { start_date: '2026-11-04T00:00', end_date: '2026-11-04T23:59', time_trunc: 'day', ...o } });

for (const path of ['../secreto', 'otra/cosa', 'demanda/evolucion?x=1', 'https://evil.example', '']) {
  test(`rechaza la ruta ${JSON.stringify(path)} sin llamar a REData`, async () => {
    globalThis.fetch = () => assert.fail('no debe llamar a la red');
    const res = fakeRes();
    await handler(q({ path }), res);
    assert.equal(res.statusCode, 400);
  });
}

test('rechaza un time_trunc no válido', async () => {
  const res = fakeRes();
  await handler(q({ path: 'demanda/evolucion', time_trunc: 'week' }), res);
  assert.equal(res.statusCode, 400);
});

test('reenvía a REData y cachea las respuestas correctas', async () => {
  let url;
  globalThis.fetch = async u => { url = u; return new Response('{"ok":1}', { status: 200 }); };
  const res = fakeRes();
  await handler(q({ path: 'demanda/evolucion' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(url, /^https:\/\/apidatos\.ree\.es\/es\/datos\/demanda\/evolucion\?/);
  assert.match(res.headers['Cache-Control'], /s-maxage=300/);
});

test('no cachea los errores de REData', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 400 });
  const res = fakeRes();
  await handler(q({ path: 'demanda/evolucion' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('devuelve 502 si REData no responde', async () => {
  globalThis.fetch = async () => { throw new Error('caído'); };
  const res = fakeRes();
  await handler(q({ path: 'demanda/evolucion' }), res);
  assert.equal(res.statusCode, 502);
});
