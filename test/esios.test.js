import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/esios.js';
import { fakeRes } from './helpers.js';

const realFetch = globalThis.fetch;
const TOKEN = 'token-secreto';
afterEach(() => { globalThis.fetch = realFetch; process.env.ESIOS_TOKEN = TOKEN; });
process.env.ESIOS_TOKEN = TOKEN;

const VALORES = { 546: 4444, 547: 229, 548: 0, 549: 5184, 550: 13980, 551: 1805, 552: 117, 555: 2647 };
const respuesta = (t, geo = 'Península') => async url => {
  const id = /indicators\/(\d+)/.exec(url)[1];
  return new Response(JSON.stringify({ indicator: { values: [{ datetime_utc: t, value: VALORES[id], geo_name: geo }] } }));
};

test('devuelve porcentajes y envía el token solo a ESIOS', async () => {
  let cabecera, destino;
  const base = respuesta(new Date().toISOString());
  globalThis.fetch = async (u, o) => { cabecera = o.headers['x-api-key']; destino = u; return base(u); };
  const res = fakeRes(); await handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(cabecera, TOKEN);
  assert.match(destino, /^https:\/\/api\.esios\.ree\.es\//);
  assert.ok(Math.abs(res.body.sincronas - 23608 / 28406) < 1e-9);
  assert.equal(res.body.antiguo, false);
  assert.ok(!JSON.stringify(res.body).includes(TOKEN));
});

test('marca como antiguo un dato de hace más de 30 minutos', async () => {
  globalThis.fetch = respuesta(new Date(Date.now() - 31 * 60e3).toISOString());
  const res = fakeRes(); await handler({}, res);
  assert.equal(res.body.antiguo, true);
});

test('ignora valores que no son de la península', async () => {
  globalThis.fetch = respuesta(new Date().toISOString(), 'Canarias');
  const res = fakeRes(); await handler({}, res);
  assert.equal(res.statusCode, 502);
});

test('sin token responde 503 sin llamar a ESIOS', async () => {
  delete process.env.ESIOS_TOKEN;
  globalThis.fetch = () => assert.fail('no debe llamar a la red');
  const res = fakeRes(); await handler({}, res);
  assert.equal(res.statusCode, 503);
});

test('si ESIOS falla, no filtra detalles ni cachea', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  const res = fakeRes(); await handler({}, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: 'ESIOS no disponible' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
