// Prueba las funciones de fechas de index.html, que viven en un <script> dentro de la página.
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ini = html.indexOf('const pad ='), fin = html.indexOf('/* ---------- API');
assert.ok(ini > 0 && fin > ini, 'no se encuentra el bloque de periodos en index.html');
const fns = now => {
  const ctx = { Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(now); } } };
  vm.runInNewContext(html.slice(ini, fin) + ';this.f={range,yesterday,lastMonth,closedMonths,ayerEs,current};', ctx);
  return ctx.f;
};
afterEach(() => mock.timers.reset());

test('lastMonth devuelve el mes anterior completo', () => {
  const r = fns(new Date(2026, 10, 5, 12)).lastMonth();
  assert.deepEqual({ ...r }, { start: '2026-10-01T00:00', end: '2026-10-31T23:59', trunc: 'month' });
});

test('lastMonth cruza el cambio de año', () => {
  const r = fns(new Date(2026, 0, 15, 12)).lastMonth();
  assert.equal(r.start, '2025-12-01T00:00');
  assert.equal(r.end, '2025-12-31T23:59');
});

test('lastMonth funciona el día 31 y en años bisiestos', () => {
  const r = fns(new Date(2028, 2, 31, 12)).lastMonth();
  assert.equal(r.start, '2028-02-01T00:00');
  assert.equal(r.end, '2028-02-29T23:59');
});

test('ayerEs usa el formato que guarda el cron', () => {
  assert.equal(fns(new Date(2026, 10, 1, 12)).ayerEs(), '31/10/2026');
});

test('current ignora los valores futuros', () => {
  const n = Date.now(), v = d => ({ v: d, t: new Date(n + d * 3600e3).toISOString() });
  const f = fns(new Date(2026, 10, 5, 12));
  assert.equal(f.current({ values: [v(-2), v(-1), v(1), v(2)] }).v, -1);
  assert.equal(f.current({ values: [v(1), v(2)] }).v, 2);
});

test('closedMonths empieza en enero', () => {
  const r = fns(new Date(2026, 10, 5, 12)).closedMonths();
  assert.equal(r.start, '2026-01-01T00:00');
  assert.equal(r.end, '2026-10-31T23:59');
});

test('closedMonths nunca pide un solo mes en febrero', () => {
  const r = fns(new Date(2026, 1, 10, 12)).closedMonths();
  assert.equal(r.start, '2025-01-01T00:00');
  assert.equal(r.end, '2026-01-31T23:59');
});

test('yesterday devuelve el día anterior completo, también en cambio de mes', () => {
  const r = fns(new Date(2026, 10, 1, 12)).yesterday();
  assert.equal(r.start, '2026-10-31T00:00');
  assert.equal(r.end, '2026-10-31T23:59');
  assert.equal(r.trunc, 'day');
});
