// Sirve el último resumen guardado en Vercel Blob (se expone como /resumenes/latest.json vía rewrite).
// El store es privado: la web solo accede a él a través de esta función.
import { get } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const r = await get('resumenes/latest.json', { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return res.status(404).json({ error: 'sin resumen todavía' });
    const cuerpo = await new Response(r.stream).text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).send(cuerpo);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'no se pudo leer el resumen' });
  }
}
