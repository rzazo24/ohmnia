// Estimación propia de OhmnIA, no un dato oficial de REE. Lo usan la web y el cron, sin dependencias.
const pct = (x, d = 0) => (x * 100).toLocaleString('es-ES', { maximumFractionDigits: d });
const num = (x, d = 1) => x.toLocaleString('es-ES', { maximumFractionDigits: d });
const positivo = x => Number.isFinite(x) && x > 0;

// senales: { demanda: {actual, pico}, precio: {actual, media}, desvio: {real, prevista} }; cualquiera puede faltar.
export function evaluarTension(senales = {}, umbrales) {
  const { demanda, precio, desvio } = senales;
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

  const puntos = activas.length;
  const nivel = !evaluadas ? null : puntos === 0 ? 'holgada' : puntos === 1 ? 'exigida' : 'tensionada';
  return { nivel, puntos, activas, informativas, parcial: evaluadas === 1, evaluadas };
}

export const UMBRALES_DIA = {
  cicloCombinado: 0.25,
  picoSobreMedia: 1.3, // pico frente a la potencia media de la semana
  valleSobreMedia: 0.7,
  solarInercia: 0.4,
  sincronasInercia: 0.3,
};

// datos: salida de resumirSeries por ruta. semana: energía diaria media de la semana anterior, en MWh, si se obtuvo.
export function senalesDia(datos, semana, u = UMBRALES_DIA) {
  const senales = [];
  const mix = (datos['generacion/estructura-generacion'] || []);
  const peso = (...nombres) => {
    const v = mix.filter(s => nombres.includes(s.serie)).map(s => s.pct);
    return v.length === nombres.length && v.every(Number.isFinite) ? v.reduce((a, b) => a + b, 0) : null;
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
    if (real.min / media < u.valleSobreMedia) senales.push({ clave: 'valle', texto: `El valle de demanda fue el ${pct(real.min / media)} % de la potencia media de la semana` });
  }

  const solar = peso('Solar fotovoltaica', 'Solar térmica');
  const sincronas = peso('Nuclear', 'Hidráulica', 'Ciclo combinado');
  if (solar !== null && sincronas !== null && solar > u.solarInercia && sincronas < u.sincronasInercia) {
    senales.push({ clave: 'poca_sincrona', tipo: 'inercia', texto: `Poca generación síncrona: solar al ${pct(solar, 1)} % y síncronas al ${pct(sincronas, 1)} %` });
  }
  return senales;
}
