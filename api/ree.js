// Proxy hacia REData. Uso: /api/ree?path=demanda/evolucion&start_date=...&end_date=...&time_trunc=day
const BASE = 'https://apidatos.ree.es/es/datos';
const CATEGORIAS = new Set(['balance', 'demanda', 'generacion', 'intercambios', 'transporte', 'mercados']);

export default async function handler(req, res) {
  const { path = '', start_date, end_date, time_trunc } = req.query;

  // Solo categorías conocidas y caracteres seguros: evita usar el proxy como relay abierto.
  if (!/^[a-zA-Z0-9\-_/]+$/.test(path) || !CATEGORIAS.has(path.split('/')[0])) {
    return res.status(400).json({ error: 'path no válido' });
  }
  if (!start_date || !end_date || !['hour', 'day', 'month', 'year'].includes(time_trunc)) {
    return res.status(400).json({ error: 'faltan start_date, end_date o time_trunc válido' });
  }

  const url = `${BASE}/${path}?${new URLSearchParams({ start_date, end_date, time_trunc })}`;
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'OhmnIA-dashboard/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 5 min en el edge de Vercel; los errores no se cachean.
    res.setHeader('Cache-Control', r.ok ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
    return res.status(r.status).send(body);
  } catch (e) {
    return res.status(502).json({ error: 'REData no responde', detalle: String(e.message || e) });
  }
}
