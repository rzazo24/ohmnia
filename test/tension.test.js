import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarTension, mixDesdeSeries, senalesDia } from '../tension.js';

const U = { demandaSobrePico: 0.97, precioSobreMedia: 1.5, desvioPrevision: 0.03, solarInercia: 0.4, sincronasInercia: 0.3, cicloCombinadoInfo: 0.45 };
const tranquila = { demanda: { actual: 30, pico: 40 }, precio: { actual: 100, media: 100 }, desvio: { real: 100, prevista: 100 }, mix: { solar: 0.1, sincronas: 0.7, cicloCombinado: 0.1 } };

test('0 puntos: Holgada', () => {
  const r = evaluarTension(tranquila, U);
  assert.deepEqual([r.nivel, r.puntos, r.parcial], ['holgada', 0, false]);
});

test('1 punto: Exigida, con el texto de la señal', () => {
  const r = evaluarTension({ ...tranquila, demanda: { actual: 39.2, pico: 40 } }, U);
  assert.equal(r.nivel, 'exigida');
  assert.equal(r.activas[0].texto, 'Demanda al 98 % del pico de 30 días');
});

test('poca generación síncrona puntúa y lo explica', () => {
  const r = evaluarTension({ ...tranquila, mix: { solar: 0.45, sincronas: 0.25, cicloCombinado: 0.1 } }, U);
  assert.deepEqual([r.nivel, r.activas[0].texto], ['exigida', 'Poca generación síncrona: solar al 45 % y síncronas al 25 %']);
});

test('el ciclo combinado informa como dependencia del gas, pero no puntúa', () => {
  const r = evaluarTension({ ...tranquila, mix: { solar: 0.1, sincronas: 0.7, cicloCombinado: 0.49 } }, U);
  assert.deepEqual([r.nivel, r.puntos], ['holgada', 0]);
  assert.equal(r.informativas[0].texto, 'Ciclo combinado al 49 % (dependencia del gas, informativo)');
  assert.deepEqual(evaluarTension({ ...tranquila, mix: { solar: 0.1, sincronas: 0.7, cicloCombinado: 0.45 } }, U).informativas, []);
});

test('3 puntos: Tensionada', () => {
  const r = evaluarTension({ demanda: { actual: 39, pico: 40 }, desvio: { real: 110, prevista: 100 }, mix: { solar: 0.45, sincronas: 0.25, cicloCombinado: 0.1 } }, U);
  assert.deepEqual([r.nivel, r.puntos], ['tensionada', 3]);
});

test('sin ESIOS se calcula con el resto e indica datos parciales', () => {
  const { mix, ...sinMix } = tranquila;
  const r = evaluarTension(sinMix, U);
  assert.deepEqual([r.nivel, r.parcial, r.evaluadas], ['holgada', true, 2]);
});

test('mixDesdeSeries usa el último instante común, con datos reales', () => {
  const p = (v, ...t) => t.map(x => ({ t: x, v }));
  const r = mixDesdeSeries({ hidraulica: p(4444, 'a', 'b'), nuclear: p(5184, 'a', 'b'), cicloCombinado: p(13980, 'a', 'b'), eolica: p(1805, 'a', 'b'), solar: p(117, 'a', 'b'), resto: p(2876, 'a') });
  assert.equal(r.t, 'a');
  assert.ok(Math.abs(r.sincronas - 23608 / 28406) < 1e-9);
  assert.ok(Math.abs(r.solar - 117 / 28406) < 1e-9);
  assert.ok(Math.abs(r.renovable - (4444 + 1805 + 117) / 28406) < 1e-9);
  assert.ok(Math.abs(r.porcentajes.nuclear - 5184 / 28406) < 1e-9);
  assert.equal(r.total, 28406);
  assert.ok(Math.abs(Object.values(r.porcentajes).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('mixDesdeSeries no resta el bombeo: la hidráulica negativa cuenta como 0', () => {
  const p = v => [{ t: 'a', v }];
  const r = mixDesdeSeries({ hidraulica: p(-1451), nuclear: p(6081), cicloCombinado: p(3632), eolica: p(7146), solar: p(8967), resto: p(2205) });
  assert.equal(r.total, 28031);
  assert.equal(r.porcentajes.hidraulica, 0);
  assert.ok(Math.abs(r.renovable - (7146 + 8967) / 28031) < 1e-9);
  assert.ok(Math.abs(r.sincronas - (6081 + 3632) / 28031) < 1e-9);
});

test('mixDesdeSeries no calcula si falta una tecnología', () => {
  assert.equal(mixDesdeSeries({ solar: [{ t: 'a', v: 1 }], nuclear: [] }), null);
});

test('medidas: valor, umbral y si se supera, para los medidores', () => {
  const r = evaluarTension({ demanda: { actual: 30, pico: 40 }, desvio: { real: 105, prevista: 100 }, mix: { solar: 0.45, sincronas: 0.35, cicloCombinado: 0.1 } }, U);
  const m = Object.fromEntries(r.medidas.map(x => [x.clave, x]));
  assert.deepEqual(Object.keys(m), ['demanda', 'desvio', 'solar', 'sincronas']);
  assert.equal(m.demanda.valor, 0.75); assert.equal(m.demanda.superado, false);
  assert.equal(m.desvio.superado, true); assert.ok(m.desvio.max >= m.desvio.valor);
  // Solar supera su umbral, pero la síncrona no: la señal no está activa y ninguna barra se marca.
  assert.equal(m.solar.superado, false); assert.equal(m.sincronas.superado, false);
  assert.equal(m.solar.conjunta, true);
  assert.equal(r.puntos, 1); // solo el desvío: la solar sola no basta
});

test('las barras de solar y síncronas se marcan juntas cuando la señal está activa', () => {
  const r = evaluarTension({ mix: { solar: 0.45, sincronas: 0.25, cicloCombinado: 0.1 } }, U);
  assert.deepEqual(r.medidas.map(m => m.superado), [true, true]);
});

test('2 puntos: Tensionada', () => {
  const r = evaluarTension({ ...tranquila, demanda: { actual: 39, pico: 40 }, desvio: { real: 110, prevista: 100 } }, U);
  assert.deepEqual([r.nivel, r.puntos], ['tensionada', 2]);
});

test('el precio informa, pero no puntúa', () => {
  const r = evaluarTension({ ...tranquila, precio: { actual: 160, media: 100 } }, U);
  assert.deepEqual([r.nivel, r.puntos], ['holgada', 0]);
  assert.equal(r.informativas.find(i => i.clave === 'precio').texto, 'Precio a 1,6 veces la media del mes (informativo, no puntúa)');
});

test('el umbral exacto no suma: debe superarse', () => {
  assert.equal(evaluarTension({ demanda: { actual: 97, pico: 100 }, precio: { actual: 150, media: 100 }, desvio: { real: 103, prevista: 100 } }, U).puntos, 0);
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
  assert.deepEqual(claves(d, 716897), ['dependencia_gas']);
});

test('en el resumen, el ciclo combinado se describe como dependencia del gas', () => {
  const [s] = senalesDia({ 'generacion/estructura-generacion': [serie('Ciclo combinado', 0.39)] });
  assert.equal(s.tipo, 'informativa');
  assert.match(s.texto, /^Dependencia del gas/);
  assert.doesNotMatch(s.texto, /tensi/i);
});

test('saldo positivo: importador', () => {
  assert.deepEqual(claves({ 'intercambios/todas-fronteras-programados': [saldo(50), saldo(-10)] }), ['importador']);
});

test('el pico alejado de la media semanal activa la señal; un valle bajo no', () => {
  const d = { 'demanda/demanda-tiempo-real': [{ serie: 'Real', max: 40000, min: 18000 }] };
  assert.deepEqual(claves(d, 720000), ['pico']);
  assert.deepEqual(claves(d, null), []);
});

test('poca generación síncrona, descrita sin hablar de escasez', () => {
  const d = { 'generacion/estructura-generacion': [serie('Ciclo combinado', 0.05), serie('Nuclear', 0.15), serie('Hidráulica', 0.05), serie('Solar fotovoltaica', 0.4), serie('Solar térmica', 0.02)] };
  const [s] = senalesDia(d);
  assert.equal(s.clave, 'poca_sincrona');
  assert.match(s.texto, /^Poca generación síncrona/);
});

test('la baja inercia no depende de que exista Solar térmica', () => {
  const d = { 'generacion/estructura-generacion': [serie('Ciclo combinado', 0.05), serie('Nuclear', 0.15), serie('Hidráulica', 0.05), serie('Solar fotovoltaica', 0.45)] };
  assert.deepEqual(claves(d), ['poca_sincrona']);
});

test('si falta una síncrona no da una falsa alarma de baja inercia', () => {
  const d = { 'generacion/estructura-generacion': [serie('Ciclo combinado', 0.05), serie('Hidráulica', 0.05), serie('Solar fotovoltaica', 0.45)] };
  assert.deepEqual(claves(d), []);
});

test('sin datos de un bloque no inventa señales', () => {
  assert.deepEqual(senalesDia({}), []);
  assert.deepEqual(claves({ 'generacion/estructura-generacion': [serie('Solar fotovoltaica', 0.5)] }), []);
});
