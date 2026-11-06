import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarTension, senalesDia } from '../tension.js';

const U = { demandaSobrePico: 0.9, precioSobreMedia: 1.5, desvioPrevision: 0.03 };
const tranquila = { demanda: { actual: 30, pico: 40 }, precio: { actual: 100, media: 100 }, desvio: { real: 100, prevista: 100 } };

test('0 puntos: Holgada', () => {
  const r = evaluarTension(tranquila, U);
  assert.deepEqual([r.nivel, r.puntos, r.parcial], ['holgada', 0, false]);
});

test('1 punto: Exigida, con el texto de la señal', () => {
  const r = evaluarTension({ ...tranquila, demanda: { actual: 37.2, pico: 40 } }, U);
  assert.equal(r.nivel, 'exigida');
  assert.equal(r.activas[0].texto, 'Demanda al 93 % del pico de 30 días');
});

test('2 puntos: Tensionada', () => {
  const r = evaluarTension({ ...tranquila, demanda: { actual: 39, pico: 40 }, desvio: { real: 110, prevista: 100 } }, U);
  assert.deepEqual([r.nivel, r.puntos], ['tensionada', 2]);
});

test('el precio informa, pero no puntúa', () => {
  const r = evaluarTension({ ...tranquila, precio: { actual: 160, media: 100 } }, U);
  assert.deepEqual([r.nivel, r.puntos], ['holgada', 0]);
  assert.equal(r.informativas[0].texto, 'Precio a 1,6 veces la media del mes');
});

test('el umbral exacto no suma: debe superarse', () => {
  assert.equal(evaluarTension({ demanda: { actual: 90, pico: 100 }, precio: { actual: 150, media: 100 }, desvio: { real: 103, prevista: 100 } }, U).puntos, 0);
});

test('el desvío cuenta en los dos sentidos', () => {
  assert.equal(evaluarTension({ desvio: { real: 90, prevista: 100 } }, U).puntos, 1);
});

test('datos parciales: calcula con la señal disponible y lo indica', () => {
  const r = evaluarTension({ desvio: { real: 110, prevista: 100 } }, U);
  assert.deepEqual([r.nivel, r.parcial, r.evaluadas], ['exigida', true, 1]);
});

test('solo con el precio no da estado', () => {
  assert.equal(evaluarTension({ precio: { actual: 160, media: 100 } }, U).nivel, null);
});

test('sin datos no da ningún estado', () => {
  const r = evaluarTension({}, U);
  assert.deepEqual([r.nivel, r.parcial], [null, false]);
  assert.equal(evaluarTension({ demanda: { actual: NaN, pico: 40 }, precio: { actual: 1, media: 0 } }, U).nivel, null);
});

const serie = (s, pct) => ({ serie: s, pct, media: 0 });
const saldo = media => ({ serie: 'saldo', grupo: 'x', media });
const claves = (d, semana) => senalesDia(d, semana).map(s => s.clave);

test('datos reales del 04/11: ciclo combinado sí, exportador no', () => {
  const d = {
    'generacion/estructura-generacion': [serie('Ciclo combinado', 0.3038), serie('Nuclear', 0.1902), serie('Hidráulica', 0.0897), serie('Solar fotovoltaica', 0.1934), serie('Solar térmica', 0.0088)],
    'intercambios/todas-fronteras-programados': [saldo(10074.7), saldo(-35111.8), saldo(-15340), saldo(-1103.4)],
    'demanda/demanda-tiempo-real': [{ serie: 'Real', max: 36512, min: 22664 }],
  };
  assert.deepEqual(claves(d, 716897), ['ciclo_combinado']);
});

test('saldo positivo: importador', () => {
  assert.deepEqual(claves({ 'intercambios/todas-fronteras-programados': [saldo(50), saldo(-10)] }), ['importador']);
});

test('pico y valle alejados de la media semanal', () => {
  const d = { 'demanda/demanda-tiempo-real': [{ serie: 'Real', max: 40000, min: 18000 }] };
  assert.deepEqual(claves(d, 720000), ['pico', 'valle']);
  assert.deepEqual(claves(d, null), []);
});

test('poca generación síncrona, descrita sin hablar de escasez', () => {
  const d = { 'generacion/estructura-generacion': [serie('Ciclo combinado', 0.05), serie('Nuclear', 0.15), serie('Hidráulica', 0.05), serie('Solar fotovoltaica', 0.4), serie('Solar térmica', 0.02)] };
  const [s] = senalesDia(d);
  assert.equal(s.clave, 'poca_sincrona');
  assert.match(s.texto, /^Poca generación síncrona/);
});

test('sin datos de un bloque no inventa señales', () => {
  assert.deepEqual(senalesDia({}), []);
  assert.deepEqual(claves({ 'generacion/estructura-generacion': [serie('Solar fotovoltaica', 0.5)] }), []);
});
