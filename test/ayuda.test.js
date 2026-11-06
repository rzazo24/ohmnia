import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const web = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ayuda = readFileSync(new URL('../ayuda/index.html', import.meta.url), 'utf8');
const anclas = new Set([...ayuda.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));

test('la guía tiene una sección por cada pestaña', () => {
  const tabs = web.slice(web.indexOf('const TABS'), web.indexOf('/* ---------- estado y UI'));
  const claves = [...tabs.matchAll(/^  (\w+): \['/gm)].map(m => m[1]);
  assert.equal(claves.length, 6);
  for (const c of claves) assert.ok(anclas.has(c), `falta #${c}`);
});

test('los enlaces del índice apuntan a secciones existentes', () => {
  for (const m of ayuda.matchAll(/href="#([^"]+)"/g)) assert.ok(anclas.has(m[1]), `falta #${m[1]}`);
});
