# OhmnIA

Dashboard del sistema eléctrico español con datos de [REData](https://www.ree.es/es/apidatos) y [ESIOS](https://api.esios.ree.es/) (Red Eléctrica) y un resumen diario generado con la API de Claude. Se despliega en Vercel.

**Web:** [ohmnia.vercel.app](https://ohmnia.vercel.app/)

## Qué incluye

- **Seis pestañas:** Balance, Demanda, Generación, Intercambios, Red y Mercados.
- **Cuatro indicadores:** demanda en tiempo real, porcentaje renovable, emisiones y precio.
- **Selector de periodo:** Hoy, Mes y Año.
- **Resumen «Ayer en la red»:** un texto de unas 150 palabras que se genera cada mañana.
- **Semáforo de tensión:** una estimación propia, que no es un dato oficial de REE, con demanda, desvío de previsión y generación síncrona.
- **Guía:** explicación de cada bloque en [`/ayuda/`](https://ohmnia.vercel.app/ayuda/).
- **PWA:** se puede instalar en el móvil y avisa de versiones nuevas.

## Estructura

| Fichero | Función |
|---|---|
| `index.html` | La web completa: consulta REData desde el navegador y dibuja los gráficos |
| `api/cron/resumen.js` | Descarga los datos de ayer, pide el resumen a Claude y lo guarda en Vercel Blob |
| `api/resumen.js` | Sirve el último resumen, expuesto en `/resumenes/latest.json` |
| `api/esios.js` | Mix peninsular en tiempo real de ESIOS; el token no llega al navegador |
| `tension.js` | Cálculo del semáforo, compartido entre la web y el cron |
| `ayuda/index.html` | Guía detallada |
| `api/ree.js` | Proxy opcional hacia REData (se activa con `USE_PROXY` en `index.html`) |
| `vercel.json` | Programación del resumen, duración máxima de la función y rewrite del resumen |

## Despliegue

1. Importa el repositorio en Vercel. No hace falta configurar el build.
2. Crea un Blob store privado y conéctalo al proyecto.
3. Añade las variables de entorno de la tabla.
4. Vuelve a desplegar para que se apliquen.

| Variable | Obligatoria | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí | Llamada a Claude |
| `CRON_SECRET` | Sí | Protege el endpoint del cron. Genérala con `openssl rand -hex 32` |
| `BLOB_STORE_ID` | Sí* | La añade Vercel al conectar el store |
| `BLOB_READ_WRITE_TOKEN` | Sí* | Alternativa a `BLOB_STORE_ID` |
| `ESIOS_TOKEN` | No | Token personal de ESIOS. Sin él, el semáforo se calcula con datos parciales |
| `CLAUDE_MODEL` | No | Cambia el modelo (por defecto, `claude-opus-5-5`) |

\* Basta con una de las dos.

## Resumen diario

Se lanza con Vercel Schedules en hora de Madrid: a las 10:30 y, como reintento, a las 11:30 y a las 12:30, con hasta 15 minutos de margen. Cada ejecución, también la de las 10:30, solo actúa si el resumen de ayer aún no existe, así que un duplicado no lo repite. Con `?force=1` se regenera igualmente.

Para lanzarlo a mano:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://TU-DOMINIO/api/cron/resumen?force=1"
```

El campo `fallos` de la respuesta lista las fuentes que no devolvieron datos. Si faltan la demanda o la generación, no se publica y se conserva el resumen anterior.

## Desarrollo local

```bash
python3 -m http.server 8000
```

Con este servidor funciona la web, pero no las funciones de `api/`, así que el resumen dará 404. Para probarlas, usa `vercel dev`.

## Tests

```bash
npm test
```

Usan datos simulados y no llaman a servicios externos.

## Limitaciones de REData

Cada endpoint admite solo ciertas granularidades y rangos, y varios no responden con datos del día en curso. Por eso algunos bloques muestran el dato de ayer o del mes anterior, indicado en su título.

- El último punto de la demanda real es provisional, así que se muestra el penúltimo.
- El resumen usa los intercambios programados, porque los físicos dan error por días.

El mix en tiempo real no está en REData, por eso esa señal usa ESIOS.

## Licencia

El código se distribuye bajo la licencia [MIT](LICENSE). Los datos pertenecen a Red Eléctrica y se rigen por sus propias condiciones de uso.
