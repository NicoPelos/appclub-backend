# Spec: deuda de cuotas y vigencia de precios (piloto #263)

> **Estado:** describe lo que el código hace **hoy** (rama `test/263-caracterizacion-cuotas`, base `0b498aa`).
> Todavía no está revisada por Nico: cada regla tiene que quedar clasificada como *intencional*, *accidental* o *ya no aplica* (paso 2 del método de #263).
> Los tests de caracterización que fijan cada duda llevan su código en el nombre (`D1:`, `D2:`, …).
> Las cosas que parecen error están aparte, en [Dudas](#dudas). No se corrigió nada.

Alcance: `src/resources/cuotas/services/`

| Servicio | Export | Quién lo usa |
|---|---|---|
| `calcularDeuda.service.js` | `calcularDeuda({ socioId, clubId })` | `GET /api/socios/:id/deuda`, jobs de morosidad/recordatorio, advertencias, export a Sheets |
| `exencion.service.js` | `estaExentoEnPeriodo({ clubId, socioId, etiquetaId, periodo, session? })` | check-in de Muro Libre y de Escuelita |
| `findPrecioVigente.service.js` | `findPrecioVigente({ clubId, etiquetaId, date, session? })` | calcularDeuda, registrarCobro, crearCargoPuntual, preferencia MP, getDeudaStaff |
| `resolverPreciosPorPeriodo.service.js` | `resolverPreciosPorPeriodo({ clubId, etiquetaId, periodos, session? })`, `buscarPreciosVigentes({ clubId, etiquetaId, fechas, session? })` | calcularDeuda (precio de cada mes) y registrarCobro en `modoPrecio: 'historico'` (#285) |
| `resolverVigenciaPrecio.service.js` | `resolverVigenciaPrecio({ clubId, etiquetaId, desde, hasta, excludeId?, confirmado?, session? })` + `BusinessError`, `RequiereConfirmacionError` | `createPrecio` y `updatePrecio` (dentro de una transacción) |

Tipos que importan:

- `Suscripcion.fechaDesde` y `fechaHasta` son **strings `YYYY-MM`** (`fechaHasta` puede ser `null`, que significa abierta).
- `Cuota.periodo` es un string `YYYY-MM`.
- `Precios.vigenteDesde` y `vigenteHasta` son **`Date`** (instantes), y `vigenteHasta` puede ser `null`. Los handlers los arman con `new Date(<string del cliente>)`.
- Montos: `Number`, sin moneda en el cálculo (en `Precios.moneda` el default es `ARS`).

---

## 1. `calcularDeuda`

### Entrada / salida

```
calcularDeuda({ socioId, clubId, incluirPrecioHistorico = false }) → { suscripciones: Deuda[], otrosCargos: OtroCargo[] }
```

`incluirPrecioHistorico` activa R4c. Sin él (el default) no se consulta Precios de más y la respuesta no trae `desglosePrecioHistorico` ni `totalDeudaPrecioHistorico`; `totalDeuda` es idéntico con y sin el parámetro. Solo lo activa `GET /api/socios/:id/deuda`, y solo si el usuario tiene `cobros:precio-historico` (mismo chequeo que `authorize()`, vía `usuarioTienePermiso`; superadmin pasa). Los llamadores en bucle (`getSociosMorosos`, `avisoMorosidad`, `recordatorioCuotas`, `sheetsExport`, `getAdvertencias`) no lo piden, y un socio no ve en su propia deuda cuánto sería a precio de cada mes.

Los dos bloques se calculan en paralelo y no dependen uno del otro.

### 1.1 Deuda por suscripción

Se buscan **todas** las `Suscripcion` del socio con `{ socioId, clubId, active: true }`, **sin filtrar por fecha**. Cada una produce exactamente un elemento de `suscripciones`, en el orden en que las devuelve Mongo.

`hoy` = `YYYY-MM` del mes en curso **en hora argentina** (`periodoDeFecha(new Date())`, de `src/services/fechaArgentina.js`). Antes era la hora local del proceso (UTC en el container); se corrigió en #283 (ver D1).
`ahora` = `new Date()`, y es la fecha con la que se busca el precio.

Para cada suscripción `sus`:

**R1. Períodos pagados históricos.** Antes de cualquier rama:
`periodosPagados` = los `periodo` de todas las `Cuota` con `{ socioId, clubId, etiquetaId: sus.etiquetaId._id, estado: 'pagada', active: true }`. Abarca toda la historia de la etiqueta, no solo el tramo. Se devuelve tal cual, sin ordenar ni deduplicar.

**R2. Exenta** (`sus.exento` truthy): no se consulta precio ni última cuota.
```
mesesDeuda 0 · periodos [] · totalDeuda 0 · precioUnitario null · ultimoPeriodoPagado null · exento: true
```
Es el único caso en que aparece la clave `exento`. En los demás casos la clave no está (no es `false`).

**R3. A futuro** (`fechaDesde > hoy`, comparación de strings): no debe nada todavía.
```
mesesDeuda 0 · periodos [] · totalDeuda 0 · ultimoPeriodoPagado null
precioUnitario = findPrecioVigente(date: ahora)?.monto ?? null      ← precio de HOY, no el de fechaDesde
```

**R4. Normal.**
- `hasta = min(sus.fechaHasta || hoy, hoy)`: la deuda llega como máximo al mes en curso aunque el tramo tenga `fechaHasta` futura (D3, resuelta). Los adelantos se siguen pudiendo registrar desde `registrarCobro`, hasta `MAX_MESES_ADELANTO`.
- `candidatos` = todos los meses de `fechaDesde` a `hasta`, **inclusive en los dos extremos**. El año se pasa con aritmética UTC. Hay un tope de seguridad de 601 períodos.
- `pagadas` = las `Cuota` pagadas y activas de **(socio, club, etiqueta)** cuyo `periodo` está en `candidatos`. Se busca por **etiqueta, no por `suscripcionId`**: una cuota pagada cuenta aunque cuelgue de otro tramo (caso Julieta Tobar, 2026-08-11).
- `periodos` = los `candidatos` sin las `pagadas`, en orden cronológico.
- `mesesDeuda = periodos.length`.
- `ultimoPeriodoPagado` = el mayor `periodo` pagado de esa etiqueta con `periodo <= hoy`, en toda la historia (puede quedar fuera del tramo). Los pagos adelantados (`> hoy`) no cuentan. Si no hay ninguno, `null`.
- `precioUnitario = findPrecioVigente(date: ahora)?.monto ?? null`, que es **el mismo precio para todos los meses adeudados**.
- `totalDeuda = precioUnitario !== null ? mesesDeuda × precioUnitario : null`.

**R4b. Tramos superpuestos de la misma etiqueta** (D7, corregido). Después de calcular todas, cada mes adeudado se cuenta **una sola vez por etiqueta**: queda en el tramo de `fechaDesde` más antigua y se saca de los demás, que restan esos meses de `mesesDeuda` y `totalDeuda`. El orden de `suscripciones` no cambia. Los tramos exentos no participan (ya traen `periodos` vacío).

**R4c. Precio de cada mes** (#285, aditivo, solo con `incluirPrecioHistorico`). Después de R4b, cada deuda trae además:
- `desglosePrecioHistorico = [{ periodo, monto }]`, uno por cada mes de `periodos` (mismo orden), con el precio que regía ese mes según §2b. `monto` es `null` si ese mes no tiene precio cargado.
- `totalDeudaPrecioHistorico` = la suma de los `monto`, o `null` si alguno es `null` (no se adivina un precio).
- Si `periodos` está vacío (exenta, a futuro o al día): `[]` y `0`.
Los precios se resuelven con **una consulta por etiqueta** para todos los tramos de esa etiqueta, no una por mes ni una por tramo. **`totalDeuda` no cambia**: sigue siendo `mesesDeuda × precioUnitario` al precio de hoy (D4).

**Redondeos:** no hay. Es una multiplicación entera, y si `monto` tuviera decimales, pasarían tal cual.

Campos comunes de cada `Deuda`: `suscripcionId`, `etiqueta` (populada: `nombre unidad uso_sistema`), `planId ?? null`, `fechaDesde`, `fechaHasta`, `vigente`, `periodoActual: hoy`.

`vigente = !fechaHasta || fechaHasta >= hoy` (en los tres casos: exento, a futuro y normal). Dice si el tramo sigue en curso. Los clientes lo usan para separar los planes vigentes del historial; antes lo deducían de `fechaHasta && mesesDeuda === 0`, que con D3 marcaba como cerrado un tramo al día con `fechaHasta` futura.

### 1.2 Otros cargos

`otrosCargos = [muroLibre?, ...cargosPuntuales, ...eventos]`, en ese orden. `muroLibre` solo aparece si hay al menos una visita.

**R5. Muro Libre.** Las `Asistencia` con `{ tipo: 'muro_libre', tipoPase: 'diario', estadoPago: 'pendiente', active: true }`, ordenadas por `fecha` ascendente, se agregan en **un solo** objeto:
`cantidadPendiente`, `unidadPendiente: 'visita'`, `fechas[]` (legado), `visitas[{ asistenciaId (String), fecha, monto: precioSugeridoSnapshot ?? null }]` y `totalDeuda = Σ(precioSugeridoSnapshot ?? 0)`.
Los pases mensuales no entran acá: los cubre la suscripción.

**R6. Cargos puntuales.** Uno por cada `CargoPuntual` con `estado ∈ {pendiente, parcial}` y `active: true`, ordenados por `createdAt`.
`totalDeuda = montoEsperadoSnapshot − (montoPagadoSnapshot || 0)`. `nombre` sale de la etiqueta y, si no hay, es `'Cargo puntual'`.

**R7. Eventos.** Uno por cada `EventoParticipante` con `estado ∈ {pendiente, parcial}` y `active: true`. Usa la misma resta. `nombre` sale del evento y, si no hay, es `'Evento'`. `descripcion` es la del evento o `''`. Incluye `participanteId`. Si el evento no está populado, `eventoId` queda con el valor crudo.

---

## 2. `findPrecioVigente`

Devuelve el `Precios` (lean) **activo** del club y la etiqueta, o `null`, que cumple:

```
vigenteDesde <= date   AND   (vigenteHasta == null OR vigenteHasta >= date)
```

Si hay varios, gana el de **`vigenteDesde` más reciente**. Las dos puntas son **inclusivas** y se comparan como **instantes**, no como días calendario (ver D2). Con `session`, la consulta corre dentro de la transacción.

## 2b. `resolverPreciosPorPeriodo` (#285)

- **Fecha de referencia de un período `YYYY-MM`:** el 1° del mes a las 00:00 **hora argentina** (`inicioDePeriodoArgentino`, = 03:00 UTC). Esa hora cae después del hueco D2: un precio que arranca `07-01T00:00Z` ya rige, y el anterior, cerrado en `06-30T00:00Z`, sigue cubriendo el 1° de junio.
- `buscarPreciosVigentes` hace **una** consulta: precios activos de `(clubId, etiquetaId)` con `vigenteDesde <= fecha máxima` y (`vigenteHasta` null o `>= fecha mínima`). Para cada fecha elige en memoria con la misma regla que §2: las dos puntas inclusivas, como instantes, y gana el de `vigenteDesde` más reciente. Lo elige en memoria, sin `.sort`, así no depende del orden en que devuelva Mongo.
- Sin fechas/períodos, no consulta la base.
- La paridad con `findPrecioVigente` (bordes de inicio y fin a ±1 ms, una grilla de dos años, precios superpuestos, el último sin cierre, inactivos, de otro club y de otra etiqueta) la fija `resolverPreciosPorPeriodo.integration.test.js`.

## 2c. Cobro a precio de cada mes (`registrarCobro`, #285)

- `POST /api/cobros` acepta `modoPrecio`: `'actual'` (o ausente o `null`; es el default) o `'historico'`. Cualquier otro valor, incluso `'Historico'` o `'historico '`, da **400**: no se normaliza. Es el mismo modo para todo el cobro.
- `'historico'` exige el permiso `cobros:precio-historico` (**403**). Lo chequea un middleware de la ruta cuando `body.modoPrecio === 'historico'`.
- `'historico'` también exige `motivoPrecioHistorico` con al menos 10 caracteres sin contar espacios (**400**). Se guarda recortado.
- Solo afecta items de suscripción:
  - un `amount` en esos items da **400**;
  - el importe de cada mes es el de §2b;
  - si algún mes no tiene precio, **400** con un mensaje que nombra la cuota y el mes (`… Cuota Social en febrero 2026 …`).
  - Cargos puntuales y Muro Libre no cambian. Un cobro histórico sin ningún item de suscripción da **400**.
- Registro:
  - `Cobro.modoPrecio` y `Cobro.motivoPrecioHistorico` (`null` en modo actual); quién lo hizo queda en `createdBy`.
  - Cada item guarda `amount` = precio de ese mes y `precioSugeridoSnapshot` = precio de hoy; el del cliente se ignora.
  - La `Cuota` queda con `montoEsperadoSnapshot` = precio de hoy y `montoPagadoSnapshot` = precio de ese mes.
  - La auditoría (`CREATE Cobro`) guarda el cobro entero, con modo y motivo.
- **Cambiar forma de pago** de un cobro histórico: se rehace con los mismos importes y conserva modo y motivo, mediante `precioHistoricoHeredado`, un parámetro interno de `registrarCobro` que no se lee del body. No vuelve a pedir `cobros:precio-historico`.
- **Link de pago de Mercado Pago**: no soporta precio de cada mes. `POST /api/pagos/mercadopago/preferencia-cobro` y `/preferencia-propia` responden **400** si el body trae un `modoPrecio` distinto de `'actual'` (ausente o `null` equivale a `'actual'`, como en `POST /api/cobros`), con el mensaje *"El link de pago siempre cobra al precio actual. Para cobrar a precio de cada mes, registrá el cobro como efectivo o transferencia."*. Con `'actual'` o sin el campo funcionan igual que antes.

## 3. `estaExentoEnPeriodo`

- Si falta `etiquetaId` o `socioId`, devuelve **`false` sin consultar** la base.
- Si no, devuelve `true` si existe una `Suscripcion` `{ clubId, socioId, etiquetaId, active: true, exento: true }` con `fechaDesde <= periodo` y (`fechaHasta` null o `>= periodo`). Es una comparación de strings `YYYY-MM` con ambas puntas inclusivas.
- No mira cuotas pagadas ni tramos no exentos.

## 4. `resolverVigenciaPrecio`

**V0. Fechas invertidas.** Si `hasta < desde`, tira `BusinessError` (**400**) antes de consultar la base (D5, corregido).

Toma `otros` = los precios **activos** de la misma etiqueta y club, excluyendo `excludeId` (edición). El orden de las reglas importa: la primera que aplica corta.

**V1. Empate.** Si algún otro tiene `vigenteDesde === desde` (mismo instante), tira `BusinessError` (409) con el mensaje *"Ya existe un precio … que también arranca el …"*.

**V2. Posterior pisado.** Si algún otro arranca **después** de `desde` y el nuevo no tiene `hasta` o `hasta >= otro.vigenteDesde`, tira `BusinessError` (409). Si `hasta` cae justo el día en que arranca el otro, también rechaza (`>=`).

**V3. Anteriores abiertos.** `aCerrar` = los que arrancan **antes** de `desde` y siguen abiertos (`vigenteHasta` null o `>= desde`).
- Si no hay ninguno, no hace nada.
- Si el nuevo tiene `hasta` y alguno de `aCerrar` sigue después (`vigenteHasta` null o `> hasta`), tira `BusinessError` (409), confirmado o no: cerrarlo dejaría sin precio los meses posteriores al nuevo (D5, corregido). Si termina justo en `hasta`, se cierra normalmente.
- Si hay y `!confirmado`, tira `RequiereConfirmacionError` (409) con `precios: [{ id, cierrePropuesto: desde − 24 h }]`.
- Si hay y `confirmado`, a cada uno le pone `vigenteHasta = desde − 24 h` y le hace `save({ session })` en secuencia.
Las lecturas son secuenciales (no `Promise.all`) para no romper la sesión de transacción.

---

## 5. Casos concretos

Supuesto común: **hoy = 2026-10-11** (`hoy = '2026-10'`), etiqueta "Cuota Social" y precio vigente **$15.000**, salvo que se diga otra cosa.
La columna "¿Test hoy?" indica si ya hay un test unitario que fija ese resultado exacto.

| # | Dado | Resultado | ¿Test hoy? |
|---|---|---|---|
| C1 | No tiene suscripciones ni cargos | `{ suscripciones: [], otrosCargos: [] }` | sí |
| C2 | Suscripción desde `2026-07`, abierta; pagó `07` y `08` | `periodos ['2026-09','2026-10']`, `mesesDeuda 2`, **`totalDeuda 30000`**, `ultimoPeriodoPagado '2026-08'` | no (el test actual usa `toBeGreaterThanOrEqual(0)`) |
| C3 | Igual que C2 pero sin precio configurado | `mesesDeuda 2`, `precioUnitario null`, **`totalDeuda null`** | parcial |
| C4 | Tramo cerrado `2026-02..2026-05`; pagó `02`, `03`, `04` | `periodos ['2026-05']`, `totalDeuda 15000` | sí |
| C5 | Desde `2025-11`, sin pagos, con hoy = `2026-01` (cruce de año) | `periodos ['2025-11','2025-12','2026-01']`, `totalDeuda 45000` | no |
| C6 | Desde `2026-08`; el precio era $12.000 hasta septiembre y hoy es **$18.000**; no pagó nada | 3 meses × **18000 = 54000** (todos al precio de hoy) | no |
| C7 | Tramo nuevo desde `2026-08`; la cuota pagada de `08` cuelga del tramo **viejo** (otro `suscripcionId`, misma etiqueta) | `08` **no** se cobra: `periodos ['2026-09','2026-10']` | no (el mock no distingue) |
| C8 | Pagó adelantado `2026-12`; debe `09` y `10`; el último pago anterior fue `08` | `ultimoPeriodoPagado '2026-08'` (el adelanto no cuenta), `periodos ['2026-09','2026-10']` | no |
| C9 | Tramo `2026-09..2026-12` (fechaHasta **futura**), sin pagos | `periodos ['2026-09','2026-10']`, `totalDeuda 30000` (**no** cuenta meses futuros, ver D3) | sí |
| C10 | Exenta desde `2020-01`; pagó `2026-01` y `2026-02` antes de pasar a exento | `mesesDeuda 0`, `totalDeuda 0`, `periodosPagados ['2026-01','2026-02']`, `precioUnitario null`, `exento true` | sí |
| C11 | Suscripción desde `2026-11` (futura) | `totalDeuda 0`, `precioUnitario 15000` (el de hoy) | sí |
| C12 | 2 visitas diarias de Muro Libre pendientes de $2.000 y $2.500, más 1 con snapshot `null` | un objeto con `cantidadPendiente 3`, **`totalDeuda 4500`**, y la visita null con `monto null` | parcial |
| C13 | Cargo puntual de $30.000 con seña de $15.000 (`parcial`) | `totalDeuda 15000`, `montoPagado 15000` | sí |
| C14 | Cargo puntual de $10.000 con `montoPagadoSnapshot` $12.000 (pagó de más) y todavía `parcial` | **`totalDeuda -2000`**, sin piso en 0 (ver D6) | no |
| C15 | `findPrecioVigente`: un precio desde `2026-06-01` abierto y otro desde `2026-09-01` abierto; date `2026-10-11` | gana el de `2026-09-01` (el `vigenteDesde` más reciente). Lo decide el `.sort`: el índice `{ clubId, etiquetaId, vigenteDesde: -1 }` da el mismo orden, por eso C15b lo prueba sin ese índice | no (no tiene tests propios) |
| C16 | `resolverVigenciaPrecio`: hay uno abierto desde `2026-06-26`; el nuevo arranca `2026-08-01T00:00Z` | sin confirmar: `RequiereConfirmacionError` con `cierrePropuesto 2026-07-31T00:00Z`; confirmado: guarda `vigenteHasta = 2026-07-31T00:00Z` | sí |
| C17 | `resolverVigenciaPrecio`: hay uno programado desde `2026-09-01`; el nuevo es `2026-08-01..2026-09-01` (hasta == inicio del otro) | `BusinessError` (borde `>=`) | no (solo se prueban hasta null y `08-31`) |
| C18 | `estaExentoEnPeriodo`: exento `2026-03..2026-06`; periodos `2026-03`, `2026-06` y `2026-07` | `true`, `true`, `false` | no (no tiene tests propios) |
| C19 | `estaExentoEnPeriodo` sin `socioId` | `false` y **no consulta la base** | no |
| C20 | Ejemplo de #285, hoy = `2026-10-15`: precio $10.000 hasta junio, $12.000 desde julio y $15.000 desde septiembre (sin cierre); debe de marzo a octubre | `totalDeuda` **120000** (8 × 15000), `totalDeudaPrecioHistorico` **94000**; cobrado con `modoPrecio: 'historico'`, `totalAmount` 94000 | sí (unit e integración) |
| C21 | Igual que C20, pero el primer precio arranca en marzo y debe desde febrero | `desglosePrecioHistorico[0] = { periodo: '2026-02', monto: null }`, `totalDeudaPrecioHistorico null`, `totalDeuda` sin cambios; el cobro histórico da 400 nombrando "febrero 2026" | sí |
| C22 | C20 sin `incluirPrecioHistorico` (o pedido por un usuario sin `cobros:precio-historico`) | `totalDeuda` **120000**, sin `desglosePrecioHistorico` ni `totalDeudaPrecioHistorico`, y **no consulta `Precios.find`** | sí (unit; integración fija los campos y `totalDeuda`) |

---

## Dudas

Son cosas que el código hace hoy y que parecen error o una decisión vieja. **No se tocaron.** Nico tiene que clasificar cada una.

**D1. Zona horaria de `hoy` en `calcularDeuda`.** ~~`periodoHoy()` usaba la hora local del proceso (UTC en el container): el último día de cada mes, de 21:00 a 23:59 hora argentina, la deuda ya incluía el mes siguiente.~~ **Resuelta en #283:** usa `periodoDeFecha` (hora argentina). Lo fijan los tests `D1 (#283)` de `calcularDeuda.test.js`.

**D2. Hueco de casi un día al cerrar un precio.** `resolverVigenciaPrecio` cierra el anterior en `desde − 24 h`, que para un `desde` de `2026-08-01T00:00Z` da `vigenteHasta = 2026-07-31T00:00Z`. Como `findPrecioVigente` compara instantes (`vigenteHasta >= date`), el 31/07 desde las 00:00 UTC (21:00 del 30/07 en Argentina) **ningún precio está vigente** hasta que arranca el nuevo. En esas horas `calcularDeuda` da `totalDeuda null` y un cobro sin `amount` falla. Lo mismo pasa si el cliente manda un `vigenteHasta` como `YYYY-MM-DD`. **Confirmado** en `findPrecioVigente.integration.test.js`, en el test `D2`.

**D3. `fechaHasta` futura contaba meses que todavía no llegaron** (C9). **Resuelta (Nico, 2026-10-11): era un bug.** Regla: un socio puede adelantar cuotas, pero no se le cobran deudas futuras. `hasta` ahora se recorta al mes en curso. Lo fijan los tests `D3` de `calcularDeuda.test.js` y `calcularDeuda.integration.test.js`. Como consecuencia se agregó el campo `vigente` (ver 1.1), para que las pantallas no confundan un tramo al día con un plan cerrado. Regla de negocio que fijan los tests: una suscripción abierta (`fechaHasta null`) de escuelita o de cuota social suma deuda sola al pasar de mes, y un adelanto no toca la suscripción.

**D4. Toda la deuda se valúa al precio de hoy** (C6), no al precio vigente de cada mes. **Resuelta (Nico, 2026-10-11, #285): es intencional.** El precio de hoy es el default (`totalDeuda`). Cobrar a precio de cada mes es opcional, con permiso propio y motivo obligatorio (ver R4c, §2b y §2c). En el mismo sentido, una suscripción **a futuro** sugiere el precio de hoy aunque ya haya cargado uno distinto para el mes en que arranca.

**D5. Cerrar un precio anterior puede dejar un hueco al final.** ~~Si el anterior iba de `06-01` a `12-31` y el nuevo es `08-01..08-31`, el anterior queda en `07-31` y de septiembre a diciembre no hay precio. Tampoco se valida `hasta >= desde`.~~ **Corregido:** ese caso ahora se rechaza (409) y `hasta < desde` da 400 (ver §4).

**D6. Saldo negativo sin piso** (C14). En cargos puntuales y eventos, si `montoPagado > montoEsperado` y el estado sigue en `parcial`, `totalDeuda` sale negativo y resta de los totales que sumen los clientes.

**D7. Tramos superpuestos de la misma etiqueta.** ~~Si quedan dos suscripciones activas no exentas que cubren el mismo mes y la misma etiqueta, cada una lo cuenta: **el mes se cobra dos veces**.~~ **Corregido** (ver R4b). Sigue pendiente de decidir (negocio): un tramo exento no anula a uno no exento superpuesto (`calcularDeuda` no usa `estaExentoEnPeriodo`), mientras que el check-in sí considera exento al socio. El índice único `(club, socio, etiqueta, fechaDesde)` solo impide que dos tramos arranquen el mismo mes, no que se superpongan. Fijado en `exencion.integration.test.js`, en los tests `D7`.

**D8. Detalles menores.**
- `exento` aparece solo cuando es `true` (no viene `false`).
- `periodosPagados` puede traer duplicados si hay dos `Cuota` pagadas del mismo período.
- El tope de `expandPeriodos` deja pasar 601 períodos, no 600.
- `findPrecioVigente` no tiene tests propios: su lógica es la query de Mongo y los unit tests la mockean. Esto se va a ver en el mutation testing.
