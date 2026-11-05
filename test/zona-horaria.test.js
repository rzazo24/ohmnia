// Va en su propio fichero porque fija la zona horaria de todo el proceso.
process.env.TZ = 'Pacific/Auckland';
const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { readFileSync } = await import('node:fs');
const { default: vm } = await import('node:vm');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bloque = html.slice(html.indexOf('const pad ='), html.indexOf('/* ---------- API'));
const instante = new Date('2026-11-05T12:00:00Z'); // día 6 en Auckland, día 5 en Madrid
const ctx = { Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(instante); } } };
vm.runInNewContext(bloque + ';this.f={range,yesterday,lastMonth};', ctx);

test('el usuario de otra zona horaria pide el mismo día que en Madrid', () => {
  assert.notEqual(instante.getDate(), 5); // el proceso está realmente en otra zona
  assert.equal(ctx.f.range('hoy').start, '2026-11-05T00:00');
  assert.equal(ctx.f.range('hoy').end, '2026-11-05T13:00');
  assert.equal(ctx.f.yesterday().start, '2026-11-04T00:00');
  assert.equal(ctx.f.lastMonth().start, '2026-10-01T00:00');
});
