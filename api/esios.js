// Mix peninsular en tiempo real de ESIOS. El token se queda en el servidor; la web solo recibe los porcentajes.
import { mixDesdeSeries } from '../tension.js';

// Las tecnologías suman el total. «Solar» (552) ya incluye térmica y fotovoltaica.
const INDICADORES = { hidraulica: 546, carbon: 547, fuelGas: 548, nuclear: 549, cicloCombinado: 550, eolica: 551, solar: 552, resto: 555 };
const ANTIGUEDAD_MAXIMA = 30 * 60 * 1000;

async function serie(id, qs) {
  const r = await fetch(`https://api.esios.ree.es/indicators/${id}?${qs}`, {
    headers: { 'x-api-key': process.env.ESIOS_TOKEN, Accept: 'application/json; application/vnd.esios-api-v1+json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`ESIOS ${id}: HTTP ${r.status}`);
  const { indicator } = await r.json();
  return indicator.values.filter(v => v.geo_name === 'Península').map(v => ({ t: v.datetime_utc, v: v.value }));
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!process.env.ESIOS_TOKEN) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'ESIOS no configurado' });
  }
  try {
    const fin = new Date(), ini = new Date(fin.getTime() - 3600e3);
    const qs = new URLSearchParams({ start_date: ini.toISOString(), end_date: fin.toISOString() });
    const claves = Object.keys(INDICADORES);
    const series = await Promise.all(claves.map(c => serie(INDICADORES[c], qs)));
    const mix = mixDesdeSeries(Object.fromEntries(claves.map((c, i) => [c, series[i]])));
    if (!mix) throw new Error('sin un instante común');
    const antiguo = fin.getTime() - new Date(mix.t).getTime() > ANTIGUEDAD_MAXIMA;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
    return res.status(200).json({ ...mix, ambito: 'Península', fuente: 'ESIOS', antiguo });
  } catch (e) {
    console.error(e); // Los mensajes no incluyen el token.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'ESIOS no disponible' });
  }
}
