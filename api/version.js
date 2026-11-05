// Identifica el despliegue en curso; la app lo usa para avisar de que hay una versión nueva.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ version: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
