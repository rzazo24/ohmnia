// Cron diario: descarga los datos de ayer de REData, pide un resumen a Claude y lo guarda en Vercel Blob.
// Vercel Cron va en UTC: se dispara a las 08:30 y 09:30 UTC y solo se ejecuta cuando en Madrid son las 10.
import Anthropic from '@anthropic-ai/sdk';
import { put } from '@vercel/blob';

const BASE = 'https://apidatos.ree.es/es/datos';
const TZ = 'Europe/Madrid';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

// [ruta, granularidad]. 'hour' permite sacar máximos/mínimos intradía.
const FUENTES = [
  ['balance/balance-electrico', 'day'],
  ['demanda/evolucion', 'day'], // REData devuelve 400 con 'hour' en este endpoint
  ['demanda/demanda-tiempo-real', 'hour'], // series cada 5 min: da el pico y el valle
  ['generacion/estructura-generacion', 'day'],
  ['generacion/evolucion-renovable-no-renovable', 'day'],
  ['generacion/no-renovables-detalle-emisiones-CO2', 'day'],
  ['intercambios/todas-fronteras-programados', 'day'], // los físicos dan error por días
  ['mercados/precios-mercados-tiempo-real', 'hour'],
];

const partes = (d, opts) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', ...opts })
    .formatToParts(d).map(p => [p.type, p.value]));

function ayerEnMadrid() {
  const p = partes(new Date(Date.now() - 24 * 3600 * 1000), { year: 'numeric', month: '2-digit', day: '2-digit' });
  return { iso: `${p.year}-${p.month}-${p.day}`, es: `${p.day}/${p.month}/${p.year}` };
}

// Mismo aplanado que index.html, pero reduciendo cada serie a estadísticos para no inflar el prompt.
function resumirSeries(json) {
  const out = [];
  const add = (o, grupo) => {
    const a = o.attributes || {};
    const v = (a.values || []).map(x => +x.value).filter(Number.isFinite);
    if (!v.length) return;
    out.push({
      serie: a.title || o.type, grupo, total: a.total,
      min: Math.min(...v), max: Math.max(...v),
      media: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2),
      pct: a.values.length === 1 ? a.values[0].percentage : undefined,
    });
  };
  for (const g of json.included || []) {
    const a = g.attributes || {};
    if (Array.isArray(a.content)) a.content.forEach(c => add(c, a.title)); else add(g);
  }
  return out;
}

async function descargar(ruta, trunc, dia) {
  const qs = new URLSearchParams({ start_date: `${dia}T00:00`, end_date: `${dia}T23:59`, time_trunc: trunc });
  const r = await fetch(`${BASE}/${ruta}?${qs}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'OhmnIA-dashboard/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return resumirSeries(await r.json());
}

const SYSTEM = `Eres analista del sistema eléctrico español y redactas el resumen diario de un dashboard público.
Recibirás estadísticos de REData (Red Eléctrica) del día anterior. Escribe un único párrafo en español de unas 150 palabras (entre 130 y 170), sin títulos, listas ni markdown.
Cubre lo más relevante: demanda (total del día, y pico y valle en MW, que son el max y el min de la serie «Real» de demanda-tiempo-real; ignora sus series Prevista y Programada y no cites horas), mix de generación y peso de las renovables, emisiones de CO₂, intercambios internacionales (son programados, no físicos: dilo así) y precios de mercado.
Usa solo cifras presentes en los datos, con sus unidades; no inventes ni extrapoles. Si falta algún bloque de datos, no lo menciones. Tono sobrio y periodístico.`;

export default async function handler(req, res) {
  try {
    return await ejecutar(req, res);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

async function ejecutar(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  // Doble cron UTC (verano/invierno): solo seguimos cuando en Madrid es la hora 10. ?force=1 salta la guarda.
  const ahora = partes(new Date(), { hour: '2-digit', minute: '2-digit' });
  if (ahora.hour !== '10' && req.query.force !== '1') {
    return res.status(200).json({ saltado: true, horaMadrid: `${ahora.hour}:${ahora.minute}` });
  }

  const ayer = ayerEnMadrid();
  const resultados = await Promise.allSettled(FUENTES.map(([ruta, t]) => descargar(ruta, t, ayer.iso)));
  const datos = {}, fallos = [];
  resultados.forEach((r, i) => {
    const ruta = FUENTES[i][0];
    if (r.status === 'fulfilled' && r.value.length) datos[ruta] = r.value; else fallos.push(ruta);
  });
  // Sin datos no pisamos el resumen anterior.
  if (Object.keys(datos).length === 0) return res.status(502).json({ error: 'REData sin datos', fallos });

  const client = new Anthropic(); // ANTHROPIC_API_KEY del entorno
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: `Fecha de los datos: ${ayer.es}\n\n${JSON.stringify(datos)}` }],
  });
  if (msg.stop_reason === 'refusal') return res.status(502).json({ error: 'Claude rechazó la petición', detalle: msg.stop_details });
  const texto = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!texto) return res.status(502).json({ error: 'respuesta vacía', stop_reason: msg.stop_reason });

  const cuerpo = JSON.stringify({ texto, fecha: ayer.es, publicado: `${ahora.hour}:${ahora.minute}`, modelo: msg.model, fuentes_sin_datos: fallos });
  const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 };
  await put('resumenes/latest.json', cuerpo, opts);
  await put(`resumenes/${ayer.iso}.json`, cuerpo, opts); // histórico

  return res.status(200).json({ ok: true, fecha: ayer.es, palabras: texto.split(/\s+/).length, fallos });
}
