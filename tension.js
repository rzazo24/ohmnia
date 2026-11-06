// Estimación propia de OhmnIA, no un dato oficial de REE. Lo usan la web y el cron, sin dependencias.
const pct = (x, d = 0) => (x * 100).toLocaleString('es-ES', { maximumFractionDigits: d });
const num = (x, d = 1) => x.toLocaleString('es-ES', { maximumFractionDigits: d });
const positivo = x => Number.isFinite(x) && x > 0;

// Porcentajes del último instante en que todas las tecnologías tienen dato. Si falta alguna, no se calcula.
export function mixDesdeSeries(series) {
  const listas = Object.values(series);
  if (!listas.length || listas.some(l => !l.length)) return null;
  const instantes = [...new Set(listas[0].map(p => p.t))].sort().reverse();
  for (const t of instantes) {
    const v = Object.fromEntries(Object.entries(series).map(([c, l]) => [c, l.find(p => p.t === t)?.v]));
    if (!Object.values(v).every(Number.isFinite)) continue;
    const total = Object.values(v).reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    return { t, solar: v.solar / total, sincronas: (v.nuclear + v.hidraulica + v.cicloCombinado) / total };
  }
  return null;
}

// senales: { demanda: {actual, pico}, precio: {actual, media}, desvio: {real, prevista}, mix: {solar, sincronas} }; cualquiera puede faltar.
export function evaluarTension(senales = {}, umbrales) {
  const { demanda, precio, desvio, mix } = senales;
  const activas = [], informativas = [];
  let evaluadas = 0;

  if (positivo(demanda?.actual) && positivo(demanda?.pico)) {
    evaluadas++;
    const r = demanda.actual / demanda.pico;
    if (r > umbrales.demandaSobrePico) activas.push({ clave: 'demanda', texto: `Demanda al ${pct(r)} % del pico de 30 días` });
  }
  if (Number.isFinite(precio?.actual) && positivo(precio?.media)) {
    // El precio refleja el mercado, no la seguridad de la red: se informa, pero no puntúa.
    const r = precio.actual / precio.media;
    if (r > umbrales.precioSobreMedia) informativas.push({ clave: 'precio', texto: `Precio a ${num(r)} veces la media del mes` });
  }
  if (positivo(desvio?.real) && positivo(desvio?.prevista)) {
    evaluadas++;
    const r = Math.abs(desvio.real - desvio.prevista) / desvio.prevista;
    if (r > umbrales.desvioPrevision) activas.push({ clave: 'desvio', texto: `Desvío del ${pct(r, 1)} % frente a la previsión` });
  }

  if (Number.isFinite(mix?.solar) && Number.isFinite(mix?.sincronas)) {
    evaluadas++;
    if (mix.solar > umbrales.solarInercia && mix.sincronas < umbrales.sincronasInercia) {
      activas.push({ clave: 'mix', texto: `Poca generación síncrona: solar al ${pct(mix.solar)} % y síncronas al ${pct(mix.sincronas)} %` });
    }
  }

  const puntos = activas.length;
  const nivel = !evaluadas ? null : puntos === 0 ? 'holgada' : puntos === 1 ? 'exigida' : 'tensionada';
  return { nivel, puntos, activas, informativas, parcial: evaluadas > 0 && evaluadas < 3, evaluadas };
}

export const UMBRALES_DIA = {
  cicloCombinado: 0.25,
  picoSobreMedia: 1.3, // pico frente a la potencia media de la semana
  solarInercia: 0.4,
  sincronasInercia: 0.3,
};

// datos: salida de resumirSeries por ruta. semana: energía diaria media de la semana anterior, en MWh, si se obtuvo.
export function senalesDia(datos, semana, u = UMBRALES_DIA) {
  const senales = [];
  const mix = (datos['generacion/estructura-generacion'] || []);
  const peso = (...nombres) => {
    const v = mix.filter(s => nombres.includes(s.serie)).map(s => s.pct).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) : null; // suma las presentes; null solo si no hay ninguna
  };

  const ciclo = peso('Ciclo combinado');
  if (ciclo !== null && ciclo > u.cicloCombinado) {
    senales.push({ clave: 'ciclo_combinado', texto: `El ciclo combinado aportó el ${pct(ciclo, 1)} % de la generación` });
  }

  // En REData el saldo es positivo si se importa y negativo si se exporta.
  const saldos = (datos['intercambios/todas-fronteras-programados'] || []).filter(s => s.serie === 'saldo');
  const saldo = saldos.reduce((a, s) => a + s.media, 0);
  if (saldos.length && saldo > 0) {
    senales.push({ clave: 'importador', texto: `España fue importadora neta en los intercambios programados (${num(saldo, 0)} MWh)` });
  }

  const real = (datos['demanda/demanda-tiempo-real'] || []).find(s => s.serie === 'Real');
  if (real && positivo(semana)) {
    const media = semana / 24; // MWh al día a MW medios
    if (real.max / media > u.picoSobreMedia) senales.push({ clave: 'pico', texto: `El pico de demanda fue el ${pct(real.max / media)} % de la potencia media de la semana` });
  }

  const solar = peso('Solar fotovoltaica', 'Solar térmica');
  // Si falta una síncrona, la suma saldría baja y daría una falsa alarma: se exigen las tres.
  const nombresSincronas = ['Nuclear', 'Hidráulica', 'Ciclo combinado'];
  const completas = nombresSincronas.every(n => Number.isFinite(mix.find(s => s.serie === n)?.pct));
  const sincronas = completas ? peso(...nombresSincronas) : null;
  if (solar !== null && sincronas !== null && solar > u.solarInercia && sincronas < u.sincronasInercia) {
    senales.push({ clave: 'poca_sincrona', tipo: 'inercia', texto: `Poca generación síncrona: solar al ${pct(solar, 1)} % y síncronas al ${pct(sincronas, 1)} %` });
  }
  return senales;
}
