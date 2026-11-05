// Sirve el último resumen guardado en Vercel Blob (se expone como /resumenes/latest.json vía rewrite).
import { list } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const { blobs } = await list({ prefix: 'resumenes/latest.json', limit: 1 });
    if (!blobs.length) return res.status(404).json({ error: 'sin resumen todavía' });
    const r = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`blob HTTP ${r.status}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).send(await r.text());
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
