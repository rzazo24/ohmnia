# OhmnIA

Dashboard del sistema eléctrico español con datos de REData y resumen diario generado con Claude. Producción: https://ohmnia.vercel.app/

Responde en español. La interfaz y los textos de la app también van en español.

## Estructura

Sin build ni framework: Vercel sirve los ficheros estáticos y las funciones de `api/`.

- `index.html`: toda la web (HTML, CSS y JS en línea).
- `api/cron/resumen.js`: cron diario que descarga datos, llama a Claude y guarda en Vercel Blob.
- `api/resumen.js`: sirve el resumen; `vercel.json` lo expone en `/resumenes/latest.json`.
- `api/ree.js`: proxy opcional, sin usar (`USE_PROXY` en `false`, porque no hay problemas de CORS).
- `api/esios.js`: mix peninsular en tiempo real de ESIOS, con `ESIOS_TOKEN`; el token nunca llega al navegador.
- `api/version.js`: commit desplegado; la app lo usa para avisar de versiones nuevas.
- `tension.js`: cálculo del semáforo, compartido entre la web y el cron.
- `ayuda/index.html`: guía detallada en `/ayuda/`. Actualízala al cambiar bloques; sus anclas coinciden con las claves de `TABS`.
- `sw.js` y `manifest.webmanifest`: PWA, pensada sobre todo para iPhone.

## Comandos

- `npm test`: tests con el corredor de Node. Usan mocks y no llaman a servicios externos.
- `python3 -m http.server 8000`: web en local, sin las funciones de `api/`.
- `vercel dev`: para probar también las funciones.
- Comprobar la sintaxis del JS de `index.html`: extraer el `<script>` a un fichero temporal y usar `node --check`.

## REData

Cada endpoint admite solo ciertas granularidades y rangos, y la documentación no lo detalla. Comprueba cada endpoint antes de usarlo.

- Desde `curl`, `apidatos.ree.es` da 403 por Incapsula, así que hay que probar en el navegador. No intentes saltarte esa protección ni falsear el `User-Agent`.
- El 400 «Los datos solicitados no están disponibles» suele indicar una granularidad o un rango no admitidos, aunque el mensaje parezca un fallo temporal.

Comportamiento comprobado:

| Endpoint | Funciona con | No funciona con |
|---|---|---|
| `demanda/demanda-tiempo-real` | `hour`, incluidos días pasados | |
| `demanda/evolucion` | `day` | `hour` |
| `demanda/demanda-maxima-diaria` | `month` | `day` |
| `intercambios/todas-fronteras-fisicos` | `month` | `day` para ayer |
| `transporte/kilometros-lineas` | `year` cerrado, varios `month` cerrados | un solo mes, año en curso |
| `mercados/precios-mercados-tiempo-real` | `hour` en rangos de un mes | `day` y `month`; `hour` de enero a octubre |
| `mercados/coste-servicios-ajuste`, `energia-gestionada-servicios-ajuste` | varios `month` cerrados | `day` |
| `generacion/potencia-instalada` | | 500 en todas las pruebas; retirado de la web |
| `mercados/componentes-precio` | | `day`, `month` y `year`; retirado de la web |

Otros detalles:

- `demanda-tiempo-real` acepta 30 días con `hour`, pero la descarga es pesada: el pico se guarda en `localStorage` un día.
- En `todas-fronteras-programados`, cada país trae una serie `saldo`: positivo es importación y negativo, exportación.

- `demanda-maxima-diaria` devuelve energía (MWh), no potencia.
- El último punto de la serie «Real» de demanda es provisional, así que se usa el penúltimo (`settled`).
- Las series pueden tener distinta granularidad; `lineChart` coloca los puntos por fecha, no por posición.

## Convenciones

- Si un bloque muestra otro periodo que el elegido, el título lo indica: «(ayer)», «(mes anterior)», «(mes en curso)» o «(año en curso)».
- No uses `sw.js` para cachear datos de REData, para no mostrar cifras antiguas como actuales.
- El cron no debe sobrescribir el resumen anterior si falla o si faltan la demanda o la generación.
- El semáforo de tensión es una estimación propia; nunca se presenta como dato oficial.
- Las fechas de la web se calculan en Europe/Madrid (`madrid()`), no en la hora local del usuario.
- El resumen se publica sin revisión humana: el prompt exige usar solo cifras presentes en los datos.

## Semáforo de tensión

Web, con `UMBRALES` al principio del script de `index.html`: demanda real sobre el pico de 30 días (> 97 %) desvío frente a la prevista (> 3 %) y, con ESIOS, solar > 40 % con síncronas < 30 %. 0 puntos, Holgada; 1, Exigida; 2 o más, Tensionada. El PVPC sobre la media del mes (> 1,5 veces) y el ciclo combinado por encima de `cicloCombinadoInfo` (> 45 %), descrito como dependencia del gas, son informativos y no puntúan. REData no da el mix en tiempo real (`estructura-generacion` con `hour` da error), por eso se usa ESIOS.

ESIOS (cabecera `x-api-key`): indicadores peninsulares 546 hidráulica, 547 carbón, 548 fuel-gas, 549 nuclear, 550 ciclo combinado, 551 eólica, 552 solar (ya incluye 1294 térmica y 1295 fotovoltaica) y 555 resto. No uses 10351 y 10352 como total: no cuadran con las tecnologías. El KPI Renovable y el bloque «Mix en tiempo real (Península)» usan estos datos y vuelven a REData si fallan o tienen más de 30 minutos. El KPI suma hidráulica, eólica y solar; «resto» no cuenta porque mezcla tecnologías.

Cron, con `UMBRALES_DIA` en `tension.js`: ciclo combinado > 25 % (informativa, descrita como dependencia del gas, no como tensión), saldo importador, pico > 130 % de la potencia media semanal, y solar > 40 % con síncronas < 30 % («poca generación síncrona»). Se guardan en `tension` del JSON y no suman puntos del semáforo.

## Despliegue

- Cada push a `main` despliega a producción, aunque los tests fallen: el GitHub Action solo avisa. Pregunta antes de hacer push.
- El resumen usa Vercel Schedules (`schedules` en `vercel.json`, no `crons`), en hora de Madrid: `resumen-diario` a las 10:30 y dos reintentos a las 11:30 y a las 12:30, con hasta 15 minutos de margen en Hobby. La función actúa a la hora 10 y, a las 11 y a las 12, solo si no existe el resumen de ayer. `?force=1` salta esas comprobaciones. No vuelvas a `crons`: con tres entradas en la misma ruta, en la práctica solo parecía dispararse la de las 10:30 UTC.
- ESIOS: un valor negativo en el mix, como el bombeo en la hidráulica, cuenta como 0.
- El Blob store es privado, así que usa `access: 'private'`. La autenticación va por `BLOB_STORE_ID` y OIDC, sin `BLOB_READ_WRITE_TOKEN`.
- Las variables de entorno nuevas solo se aplican tras volver a desplegar.
