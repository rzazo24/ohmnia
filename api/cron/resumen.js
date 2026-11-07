// Cron diario: descarga los datos de ayer de REData, pide un resumen a Claude y lo guarda en Vercel Blob.
// Vercel Cron va en UTC (08:30, 09:30 y 10:30): se ejecuta a las 10 de Madrid y, a las 11 y a las 12,
// reintenta solo si el resumen de ayer aún no existe.
import Anthropic from '@anthropic-ai/sdk';
import { get, put } from '@vercel/blob';
import { senalesDia } from '../../tension.js';

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

// Sin estos datos el resumen quedaría cojo: mejor no publicar y conservar el anterior.
const OBLIGATORIAS = ['demanda/evolucion', 'generacion/estructura-generacion'];

const partes = (d, opts) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', ...opts })
    .formatToParts(d).map(p => [p.type, p.value]));

export function ayerEnMadrid() {
  const p = partes(new Date(Date.now() - 24 * 3600 * 1000), { year: 'numeric', month: '2-digit', day: '2-digit' });
  return { iso: `${p.year}-${p.month}-${p.day}`, es: `${p.day}/${p.month}/${p.year}` };
}

// Mismo aplanado que index.html, pero reduciendo cada serie a estadísticos para no inflar el prompt.
export function resumirSeries(json) {
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

async function descargar(ruta, trunc, dia, hasta = dia) {
  const qs = new URLSearchParams({ start_date: `${dia}T00:00`, end_date: `${hasta}T23:59`, time_trunc: trunc });
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
Usa solo cifras presentes en los datos, con sus unidades; no inventes ni extrapoles. No calcules ratios ni porcentajes propios; los saldos de intercambios son la única suma permitida. No indiques ámbito geográfico (peninsular, nacional) salvo que aparezca en los datos. Si falta algún bloque de datos, no lo menciones. Tono sobrio y periodístico.
Si el bloque tension trae señales, dedica una frase a explicarlas; si no hay ninguna, no menciones la tensión. No la califiques de «riesgo de apagón». Las señales con tipo informativa, como la dependencia del gas, descríbelas como tales y nunca como tensión. Son una estimación propia de OhmnIA, no un dato oficial de REE.`;

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
  // ?force=1 salta las comprobaciones de horario.
  const ahora = partes(new Date(), { hour: '2-digit', minute: '2-digit' });
  const ayer = ayerEnMadrid();
  const horaMadrid = `${ahora.hour}:${ahora.minute}`;
  if (req.query.force !== '1' && ahora.hour !== '10') {
    if (!['11', '12'].includes(ahora.hour)) return res.status(200).json({ saltado: true, horaMadrid });
    const previo = await get(`resumenes/${ayer.iso}.json`, { access: 'private', useCache: false });
    if (previo) {
      await previo.stream?.cancel();
      return res.status(200).json({ saltado: true, horaMadrid, motivo: 'ya publicado' });
    }
  }

  const resultados = await Promise.allSettled(FUENTES.map(([ruta, t]) => descargar(ruta, t, ayer.iso)));
  const datos = {}, fallos = [];
  resultados.forEach((r, i) => {
    const ruta = FUENTES[i][0];
    if (r.status === 'fulfilled' && r.value.length) datos[ruta] = r.value; else fallos.push(ruta);
  });
  // Con datos incompletos no pisamos el resumen anterior.
  const faltan = OBLIGATORIAS.filter(r => !datos[r]);
  if (faltan.length) return res.status(502).json({ error: 'faltan datos obligatorios de REData', faltan, fallos });

  // Media de los 7 días anteriores a ayer. Si falla, se omiten solo las señales de pico y valle.
  const dia = n => new Date(Date.parse(`${ayer.iso}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
  const semana = await descargar('demanda/evolucion', 'day', dia(7), dia(1)).then(s => s[0]?.media).catch(() => null);
  const tension = { señales: senalesDia(datos, semana), fuente: 'estimación de OhmnIA, no dato oficial de REE' };

  const client = new Anthropic(); // ANTHROPIC_API_KEY del entorno
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low' },
    // Haiku no admite el fallback de servidor.
    ...(/haiku/.test(MODEL) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    messages: [{ role: 'user', content: `Fecha de los datos: ${ayer.es}\n\n${JSON.stringify(datos)}\n\nBloque tension: ${JSON.stringify(tension)}` }],
  });
  if (msg.stop_reason === 'refusal') return res.status(502).json({ error: 'Claude rechazó la petición', detalle: msg.stop_details });
  const texto = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!texto) return res.status(502).json({ error: 'respuesta vacía', stop_reason: msg.stop_reason });

  const cuerpo = JSON.stringify({ texto, fecha: ayer.es, publicado: `${ahora.hour}:${ahora.minute}`, modelo: msg.model, fuentes_sin_datos: fallos, tension });
  const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 };
  await put('resumenes/latest.json', cuerpo, opts);
  await put(`resumenes/${ayer.iso}.json`, cuerpo, opts); // histórico

  return res.status(200).json({ ok: true, fecha: ayer.es, palabras: texto.split(/\s+/).length, fallos, modelo: msg.model, uso: msg.usage });
}
