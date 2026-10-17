# appcarc-backend

API única del sistema appCARC (Club Andino Río Cuarto). La consumen `appCARC-mobile`, `appCARC-web` y `appcarc-superadmin` — ver el mapa general en `../CLAUDE.md` (carpeta que contiene los 4 repos).

## Stack

Node 20, Express 5, Mongoose 9, MongoDB 6 (replica set `rs0`, corre en una Raspberry Pi), Docker, vitest.

## Estructura

Cada recurso vive en `src/resources/<recurso>/`:

```
models/     esquemas Mongoose
handlers/   un archivo por endpoint (req, res) => ...
services/   lógica de negocio reusable entre handlers (ej. registrarCobro, calcularDeuda)
routes.js   mapea método+path a cada handler; se monta en src/appRoutes.js
tests/
  unit/           mocks de los models, rápidos
  integration/    contra Mongo real (ver abajo), supertest sobre la app completa
```

## Regla no negociable: multi-tenant por `clubId`

Casi todo documento tiene `clubId`. Cualquier query que lea/escriba datos de un club **tiene que filtrar por `clubId`** (normalmente `req.user.clubId`) — un query sin ese filtro es una fuga de datos entre clubes, no un detalle de estilo. Lo mismo para cualquier `findOne`/`findById` por `_id` que venga de la URL: filtrar también por `clubId` para que un id válido de otro club no sea accesible.

## Permisos

Strings tipo `recurso:accion` (`socios:create`, `inventario:write`) definidos en `src/constants/permisos.js` y seedeados por rol en `scripts/seed-roles.js`. Los handlers los chequean vía middleware (`authorize(PERMISOS.X)` / `authorizeSelfSocioOr(...)`), no a mano. Los permisos de un club se cachean en memoria del proceso — un cambio directo en Mongo (fuera de los endpoints de roles) no se nota hasta invalidar el cache (`invalidarClub(clubId)`), que sí dispara `PUT /api/roles/:id`.

## Comandos

```bash
npx vitest run                              # unit (rápido, sin Mongo)
npm run test:integration                    # integración — necesita Mongo con --replSet rs0 (ver .github/workflows/ci.yml para el setup completo)
```

No usar `npm test` en modo interactivo/watch dentro de una sesión — ya corre `vitest run` (no-watch) por default, pero `npm run test:watch` si hace falta modo watch a propósito.

## Antes de borrar algo "sin uso"

`knip`/`jscpd` (y la detección a ojo) dan falsos positivos: un `export default` + nombrado que parecen duplicados puede ser que solo se use uno de los dos caminos; un archivo bajo `scripts/` puede ser un entry point manual que nada importa. Verificar con `grep -rn` en todo el repo y mirar `git log --oneline -- <archivo>` antes de asumir que algo es código muerto.

## Scripts one-off (`scripts/backfill-*`, `scripts/migrar-*`)

Corrieron una vez contra producción para una migración puntual. No se borran sin confirmar con Nico que ya cumplieron su función — el repo no tiene forma de verificar por sí solo si ya se ejecutaron.

## Deploy

Ver `docker-compose.yml`: build dentro del container en la Raspi (`npm ci --omit=dev`, liviano, a diferencia de los frontends — ver `../CLAUDE.md`). `git pull` en la Raspi + `docker compose build app` + `docker compose up -d app`, y reiniciar `gateway` si no refleja cambios (502 silencioso si no).

## Convención de nombres

Motivo (2026-10-11): el repo mezcla español e inglés dentro de un mismo concepto. Se decidió **no migrar** (los campos de Mongo, las rutas y los permisos los consumen 3 frontends y APKs viejas, y migrarlos exige tocar producción) sino fijar una regla para el código nuevo.

- Dominio en español (socio, cuota, cobro, escuelita, deuda); vocabulario técnico en inglés (handler, service, `clubId`, `createdBy`). Handlers CRUD: `get`/`create`/`update`/`delete`. Operaciones de negocio en servicios: verbo en español (`registrarCobro`, `anularCobro`, `calcularDeuda`).
- Campos ya persistidos o expuestos por la API: **no renombrar** sin migración versionada y confirmación de Nico. Al tocar un modelo, usar los nombres que ya tiene.
- Nombres canónicos para código nuevo: importe → `monto` (hoy conviven `monto` en 5 modelos y `amount` en Cobro, Movimiento y PagoOnlineIntent); forma de pago → `paymentMethod` (`formaPago` solo sobrevive en Asistencia); período → `periodo`, `'YYYY-MM'` en horario argentino (ver `src/services/fechaArgentina.js`); autoría → `createdBy`, resuelta con `getActor`.
- Comentarios en español.

## Sesiones largas (cupo del plan Pro)

Motivo (2026-10-08): `/usage` mostró 100% del uso en sesiones de 8+ hs y 99% con más de 150k de contexto; cupo semanal al 68% con 2 días por delante. Una sesión larga cuesta mucho más que varias cortas.

- Una sesión por issue o tema. Al cerrar una tarea o cambiar de tema, sugerirle a Nico `/clear`.
- Si la sesión ya leyó muchos archivos o devolvió salidas largas (tests, logs), sugerir `/compact` antes de seguir. `/context` muestra el tamaño real.
- Pasando ~100k de contexto, avisar a Nico en vez de seguir acumulando.
- No fijar `model` ni effort en `.claude/settings.json` del repo (pisa la elección personal).

# Compact instructions
Al compactar, conservar: qué handlers/services se modificaron y por qué, resultados de tests (pasó/falló y qué), decisiones de diseño explícitas del usuario, y el estado de cualquier issue de GitHub enlazado.
