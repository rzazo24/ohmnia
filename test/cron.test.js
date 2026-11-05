import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRes } from './helpers.js';

const puts = [];
let respuesta;
mock.module('@vercel/blob', { exports: { put: async (ruta, cuerpo, opts) => { puts.push({ ruta, cuerpo, opts }); } } });
mock.module('@anthropic-ai/sdk', { exports: { default: class { beta = { messages: { create: async () => respuesta } }; } } });
const { default: handler, ayerEnMadrid, resumirSeries } = await import('../api/cron/resumen.js');

const realFetch = globalThis.fetch;
const datos = { included: [{ type: 'Demanda', attributes: { title: 'Demanda', values: [{ value: 10, percentage: 1 }, { value: 30, percentage: 1 }] } }] };
const req = (query = {}, secreto = 's3creto') => ({ query, headers: { authorization: `Bearer ${secreto}` } });
const ahora = iso => mock.timers.enable({ apis: ['Date'], now: new Date(iso).getTime() });

beforeEach(() => {
  process.env.CRON_SECRET = 's3creto';
  puts.length = 0;
  respuesta = { stop_reason: 'end_turn', model: 'm', content: [{ type: 'text', text: 'Resumen de prueba' }] };
  globalThis.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
});
afterEach(() => { mock.timers.reset(); globalThis.fetch = realFetch; });

test('rechaza un secreto incorrecto', async () => {
  const res = fakeRes();
  await handler(req({}, 'malo'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(puts.length, 0);
});

test('rechaza todo si CRON_SECRET no está definido', async () => {
  delete process.env.CRON_SECRET;
  const res = fakeRes();
  await handler({ query: {}, headers: { authorization: 'Bearer undefined' } }, res);
  assert.equal(res.statusCode, 401);
});

test('en invierno se ejecuta a las 09:30 UTC y salta las 08:30', async () => {
  ahora('2026-01-15T08:30:00Z');
  let res = fakeRes(); await handler(req(), res);
  assert.equal(res.body.saltado, true);
  mock.timers.reset(); ahora('2026-01-15T09:30:00Z');
  res = fakeRes(); await handler(req(), res);
  assert.equal(res.body.ok, true);
});

test('en verano se ejecuta a las 08:30 UTC y salta las 09:30', async () => {
  ahora('2026-07-15T09:30:00Z');
  let res = fakeRes(); await handler(req(), res);
  assert.equal(res.body.saltado, true);
  mock.timers.reset(); ahora('2026-07-15T08:30:00Z');
  res = fakeRes(); await handler(req(), res);
  assert.equal(res.body.ok, true);
});

test('guarda latest e histórico en privado con el formato que lee la web', async () => {
  ahora('2026-11-05T09:30:00Z');
  const res = fakeRes(); await handler(req(), res);
  assert.deepEqual(puts.map(p => p.ruta), ['resumenes/latest.json', 'resumenes/2026-11-04.json']);
  assert.equal(puts[0].opts.access, 'private');
  const j = JSON.parse(puts[0].cuerpo);
  assert.equal(j.texto, 'Resumen de prueba');
  assert.equal(j.fecha, '04/11/2026');
  assert.equal(j.publicado, '10:30');
});

test('sigue con las fuentes que responden y lista las que fallan', async () => {
  ahora('2026-11-05T09:30:00Z');
  let n = 0;
  globalThis.fetch = async () => (n++ === 0 ? new Response('{}', { status: 400 }) : new Response(JSON.stringify(datos)));
  const res = fakeRes(); await handler(req(), res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.fallos.length, 1);
});

for (const [nombre, preparar, codigo] of [
  ['REData no devuelve nada', () => { globalThis.fetch = async () => new Response('{}', { status: 403 }); }, 502],
  ['Claude rechaza la petición', () => { respuesta = { stop_reason: 'refusal', content: [] }; }, 502],
  ['Claude responde vacío', () => { respuesta = { stop_reason: 'end_turn', content: [] }; }, 502],
  ['Claude da error', () => { respuesta = null; }, 500],
]) {
  test(`no pisa el resumen anterior si ${nombre}`, async () => {
    ahora('2026-11-05T09:30:00Z');
    preparar();
    const res = fakeRes(); await handler(req(), res);
    assert.equal(res.statusCode, codigo);
    assert.equal(puts.length, 0);
  });
}

test('ayerEnMadrid usa la fecha de Madrid, no la UTC', () => {
  ahora('2026-11-04T23:30:00Z'); // ya es día 5 en Madrid
  assert.deepEqual(ayerEnMadrid(), { iso: '2026-11-04', es: '04/11/2026' });
});

test('resumirSeries calcula estadísticos y aplana attributes.content', () => {
  const r = resumirSeries({ included: [
    datos.included[0],
    { attributes: { title: 'Grupo', content: [{ attributes: { title: 'Hija', values: [{ value: 5, percentage: 0.5 }] } }] } },
    { attributes: { title: 'Vacía', values: [] } },
  ] });
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].min, r[0].max, r[0].media], [10, 30, 20]);
  assert.deepEqual([r[1].serie, r[1].grupo, r[1].pct], ['Hija', 'Grupo', 0.5]);
});
