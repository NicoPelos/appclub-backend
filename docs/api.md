# API de appCARC: referencia

La documentación interactiva de los endpoints está en Swagger UI (`/api-docs`). Volver al [README](../README.md).

## Roles y permisos

Los usuarios pueden tener **más de un rol simultáneamente** (array `roles`). Los roles y sus permisos son **dinámicos por club** — se almacenan en la colección `Rol` de MongoDB y se gestionan desde la app.

La autorización usa permisos granulares en formato `recurso:accion` (ej: `socios:read`, `cobros:write`). Cada rol tiene un array de permisos. El middleware `authorize(permiso)` consulta la BD con cache in-process (TTL 5 min).

Los **59 permisos válidos** están definidos en `src/constants/permisos.js`. Cualquier cambio de rol invalida el cache del club inmediatamente.

Roles predeterminados para CARC:

| Rol           | Acceso principal                                                                          |
|---------------|-------------------------------------------------------------------------------------------|
| `admin`       | Total — todos los permisos                                                                |
| `autoridad`   | Solo lectura: socios, cobros, movimientos, escuelita, planes, suscripciones, export/sheets |
| `secretaria`  | CRUD socios, cobros, escuelita, planes, suscripciones, novedades, horarios                |
| `profesor`    | Check-in y vista de alumnos de escuelita, horarios propios                                |
| `palestrero`  | CRUD muro libre + check-in, horarios propios, precios (lectura), movimientos              |
| `limpieza`    | Horarios propios (registro de horas trabajadas)                                           |
| `arreglos`    | Horarios propios (registro de horas trabajadas)                                           |
| `colaborador` | Check-in y vista de muro libre + escuelita                                                |
| `socio`       | Solo lectura de sus propios datos y QR. Es el rol por defecto.                            |

**Ownership en horarios**: el staff (palestrero, profesor, limpieza, arreglos) solo puede editar y eliminar sus propios registros de horario. Admin y secretaria pueden gestionar todos.

## Roles API

| Endpoint               | Descripción                                          |
|------------------------|------------------------------------------------------|
| `GET /api/roles`       | Listar roles del club (requiere `roles:read`)        |
| `POST /api/roles`      | Crear rol con permisos (requiere `roles:write`)      |
| `PUT /api/roles/:id`   | Actualizar nombre o permisos (requiere `roles:write`)|
| `DELETE /api/roles/:id`| Desactivar rol — soft delete (requiere `roles:delete`)|

## Auth

| Endpoint                  | Descripción                                              |
|---------------------------|----------------------------------------------------------|
| `POST /api/auth/login`    | Email + contraseña. Rate limit: 10 intentos / 15 min    |
| `POST /api/auth/google`   | Login con Google ID Token                                |
| `POST /api/auth/register` | Crear usuario (solo admin). Vincula socioId automático   |
| `PUT /api/auth/password`  | Cambiar contraseña (requiere JWT)                        |
| `POST /api/auth/logout`   | Invalida el token (blacklist)                            |

El login devuelve `{ token, user, permisos, socio }`. `permisos` es el array de strings `recurso:accion` que el usuario puede usar — el front lo usa para saber qué mostrar. Si el usuario tiene `mustChangePassword: true`, la app debe redirigir al cambio de contraseña antes de continuar.

Cuando se cambia la contraseña, todos los tokens emitidos anteriormente quedan inválidos de inmediato.

**Creación automática de usuario**: al crear un socio con `correoElectronico` y `dni`, el sistema crea automáticamente un usuario con `roles: ['socio']`, una contraseña inicial temporal y `mustChangePassword: true`.

## Usuarios

| Endpoint                    | Descripción                                          |
|-----------------------------|------------------------------------------------------|
| `GET /api/usuarios/staff`   | Listar usuarios con roles de staff (requiere `horarios:read`). Devuelve `nombre, email, roles, socioId`. |

Los usuarios staff incluyen: `profesor`, `palestrero`, `limpieza`, `arreglos`, `colaborador`, `admin`, `secretaria`.

## Socios

| Endpoint                       | Descripción                                  |
|--------------------------------|----------------------------------------------|
| `GET /api/socios`              | Listar socios activos (paginado)             |
| `POST /api/socios`             | Crear socio                                  |
| `GET /api/socios/:id`          | Obtener socio                                |
| `PUT /api/socios/:id`          | Actualizar socio                             |
| `DELETE /api/socios/:id`       | Dar de baja (soft delete)                    |
| `GET /api/socios/:id/qr`       | Obtener token QR del socio (expira en 30 días) |
| `POST /api/socios/verify`      | Verificar socio por QR o DNI                 |
| `GET /api/socios/:id/deuda`    | Calcular deuda de cuotas social y escuelita  |

`POST /api/socios/verify` devuelve:
```json
{
  "socio": { "...datos" },
  "debtSummary": { "pendingCount": 2, "pendingAmount": 5000 },
  "lastMuroLibre": { "...última visita" },
  "paseMuroLibre": { "vigente": true, "periodo": "2026-06" }
}
```

## Cobros

| Endpoint                       | Descripción                               |
|--------------------------------|-------------------------------------------|
| `GET /api/cobros`              | Listar cobros (socios solo ven los suyos) |
| `POST /api/cobros`             | Registrar cobro batch                     |
| `POST /api/cobros/:id/anular`  | Anular cobro (soft delete + rollback)     |

`POST /api/cobros` es all-or-nothing: si alguna cuota del batch ya está pagada devuelve 409. El responsable se toma de `req.user.email` (no se envía en el body).

```json
{
  "paymentMethod": "Efectivo",
  "items": [
    { "socioId": "ID", "tipo": "social", "periodo": "2026-06" },
    { "socioId": "ID", "tipo": "escuelita", "periodoDesde": "2026-05", "cantidad": 2 }
  ]
}
```

Tipos válidos: `social`, `escuelita`, `muro_libre`.

## Planes

Plantillas de suscripción que unifican los conceptos de CategoriaEscuelita, cuotas sociales y muro libre bajo un modelo único y extensible.

| Endpoint              | Descripción                                         |
|-----------------------|-----------------------------------------------------|
| `GET /api/planes`     | Listar planes activos (filtros: `tipo`, `trash`)    |
| `POST /api/planes`    | Crear plan (requiere `planes:write`)                |
| `PUT /api/planes/:id` | Actualizar plan (requiere `planes:write`)           |
| `DELETE /api/planes/:id` | Eliminar plan — soft delete (requiere `planes:delete`) |

Campos del modelo:

| Campo       | Tipo    | Descripción                                                    |
|-------------|---------|----------------------------------------------------------------|
| `nombre`    | String  | Nombre único del plan dentro del club                         |
| `tipo`      | Enum    | `social` \| `escuelita` \| `muro_libre`                      |
| `modalidad` | Enum    | `mensual` \| `por_uso`                                        |
| `etiquetaId`| ObjectId| Etiqueta de precio (determina el monto de la cuota)           |
| `atributos` | Mixed   | Datos flexibles por tipo: `frecuenciaSemanal`, `requiereSocio`, `codigo`, etc. |

Planes base para CARC (creados por `seed-planes.js`):

| Plan | Tipo | Modalidad | Atributos |
|------|------|-----------|-----------|
| Socio Activo | social | mensual | — |
| PrincipiantesX2, AvanzadosX2, JuvenilesX2 | escuelita | mensual | `frecuenciaSemanal: 2` |
| PrincipiantesX1, AvanzadosX1, JuvenilesX1 | escuelita | mensual | `frecuenciaSemanal: 1` |
| Muro Libre Mensual - Socio/No Socio | muro_libre | mensual | `requiereSocio: true/false` |
| Muro Libre Diario - Socio/No Socio | muro_libre | por_uso | `requiereSocio: true/false` |

No se puede eliminar un plan con suscripciones activas (devuelve 409).

## Suscripciones

Asignación de un socio a un plan, con período de vigencia.

| Endpoint                          | Descripción                                           |
|-----------------------------------|-------------------------------------------------------|
| `GET /api/suscripciones`          | Listar suscripciones de un socio (`?socioId=`, `?activa=true`) |
| `POST /api/suscripciones`         | Crear suscripción (requiere `suscripciones:write`)    |
| `PUT /api/suscripciones/:id/close`| Cerrar suscripción — establece `fechaHasta`           |
| `DELETE /api/suscripciones/:id`   | Eliminar suscripción — soft delete (solo admin)       |

`POST /api/suscripciones` acepta dos formas equivalentes:

```json
{ "socioId": "ID", "planId": "ID_DEL_PLAN", "fechaDesde": "2026-07" }
```
```json
{ "socioId": "ID", "etiquetaId": "ID_ETIQUETA", "fechaDesde": "2026-07" }
```

Cuando se provee `planId`, el `etiquetaId` se resuelve automáticamente del plan. La respuesta popula tanto `planId` como `etiquetaId` con sus datos completos.

## Etiquetas

Catálogo de conceptos de precio del club.

| Endpoint                  | Descripción                                          |
|---------------------------|------------------------------------------------------|
| `GET /api/etiquetas`      | Listar etiquetas (filtros: `uso_sistema`, `trash`)   |
| `POST /api/etiquetas`     | Crear etiqueta (requiere `etiquetas:write`)          |
| `PUT /api/etiquetas/:id`  | Actualizar etiqueta (requiere `etiquetas:write`)     |
| `DELETE /api/etiquetas/:id`| Eliminar etiqueta — soft delete (requiere `etiquetas:delete`) |

Campos: `nombre`, `unidad` (`mes` \| `hora` \| `dia`), `uso_sistema` (identificador de sistema, opcional). Los planes y suscripciones referencian etiquetas para determinar precios.

## Precios

Historial de montos por etiqueta, con vigencia temporal.

| Endpoint               | Descripción                              |
|------------------------|------------------------------------------|
| `GET /api/precios`     | Listar precios (filtros: `categoria`, `codigo`, `trash`) |
| `POST /api/precios`    | Crear precio (requiere `precios:write`)  |
| `PUT /api/precios/:id` | Actualizar precio (requiere `precios:write`) |
| `DELETE /api/precios/:id` | Eliminar precio — soft delete        |

Cada precio tiene `vigenteDesde` / `vigenteHasta`. Los cobros guardan un `montoEsperadoSnapshot` al momento de la generación, inmune a cambios futuros de precio.

## Asistencias

Colección unificada para muro libre y escuelita.

| Endpoint                          | Descripción                                   |
|-----------------------------------|-----------------------------------------------|
| `GET /api/asistencias`            | Listar (filtros: `tipo`, `socioId`, `from`, `to`, `categoria`) |
| `POST /api/asistencias/escuelita` | Registrar presente en escuelita               |
| `GET /api/muro-libre`             | Listar asistencias de muro libre              |
| `POST /api/muro-libre`            | Registrar asistencia/pago de muro libre       |
| `POST /api/muro-libre/checkin`    | Check-in por QR o DNI                         |
| `PUT /api/muro-libre/:id`         | Editar registro (fecha, monto, formaPago, obs) |
| `DELETE /api/muro-libre/:id`      | Anular registro — soft delete + anula movimiento |

Todos los endpoints de escaneo aceptan `{ token }` (QR) o `{ dni }` en el body.

## Escuelita

| Endpoint                              | Descripción                                      |
|---------------------------------------|--------------------------------------------------|
| `GET /api/escuelita`                  | Listar alumnos                                   |
| `POST /api/escuelita`                 | Inscribir alumno                                 |
| `PUT /api/escuelita/:id`              | Actualizar inscripción (incluye categoriaId)     |
| `DELETE /api/escuelita/:id`           | Dar de baja                                      |
| `POST /api/escuelita/checkin`         | Check-in por QR o DNI (valida cuota + frecuencia semanal) |
| `GET /api/escuelita/categorias`       | Listar categorías                                |
| `POST /api/escuelita/categorias`      | Crear categoría                                  |
| `PUT /api/escuelita/categorias/:id`   | Actualizar categoría                             |
| `DELETE /api/escuelita/categorias/:id`| Eliminar categoría — soft delete                 |

Cada alumno activo tiene una `Suscripcion` con `planId` → `Plan` de tipo `escuelita`. El checkin valida: cuota del mes pagada + límite de clases semanales según `plan.atributos.frecuenciaSemanal`.

## Horarios

Registro de horas trabajadas por el staff. Cada registro se vincula a una `Etiqueta` de precio (ej: Hora Palestrero, Hora Profesor), lo que permite calcular cuánto le debe el club a cada persona.

| Endpoint                         | Descripción                                              |
|----------------------------------|----------------------------------------------------------|
| `GET /api/horarios`              | Listar (filtros: `socioId`, `etiquetaId`, `desde`, `hasta`, `trash`) |
| `POST /api/horarios`             | Registrar horario                                        |
| `PUT /api/horarios/:id`          | Actualizar horario                                       |
| `DELETE /api/horarios/:id`       | Eliminar horario (soft delete)                           |
| `GET /api/horarios/deuda`        | Deuda del club con el staff para un período (`?periodo=YYYY-MM`) |
| `GET /api/horarios/precio-tareas`| Listar etiquetas con `unidad=hora` (tipos de tarea disponibles) |

**Control de propiedad**: staff (palestrero, profesor, limpieza, arreglos) solo puede editar/eliminar sus propios registros. Admin y secretaria gestionan todos. Si un usuario staff no tiene `socioId` asociado, no puede registrar horarios (403).

El endpoint `deuda` devuelve un resumen agrupado por persona y tipo de tarea:
```json
[
  {
    "socioId": "...",
    "socio": { "nombre": "Juan", "apellido": "Pérez" },
    "etiqueta": { "_id": "...", "nombre": "Hora Palestrero" },
    "totalHoras": 12.5,
    "precioPorHora": 1500,
    "total": 18750
  }
]
```

## Novedades

| Endpoint                    | Descripción                                        |
|-----------------------------|----------------------------------------------------|
| `GET /api/novedades`        | Listar novedades (filtros: `fuente`, `categoria`)  |
| `POST /api/novedades`       | Crear novedad manual (admin/secretaria)             |
| `POST /api/novedades/sync`  | Forzar sync inmediato con Instagram RSS            |

El servidor sincroniza el feed de Instagram automáticamente cada 30 minutos si `INSTAGRAM_RSS_URL` está configurado. La sincronización es idempotente: no duplica posts ya importados. Cuando hay posts nuevos, se envía una push notification a todos los socios del club.

## Push Notifications

El backend usa Expo Push API para enviar notificaciones a la app móvil. Los tokens se registran con `PUT /api/auth/push-token`.

Disparadores automáticos:
- **Actualización de socio**: cuando cambia `estado`, `correoElectronico`, `telefono` o `domicilioCompleto`
- **Cobro registrado**: confirmación al socio con detalle de cuotas pagadas
- **Novedades de Instagram**: cuando el sync detecta posts nuevos
- **Recordatorio mensual**: el 1° de cada mes a las 9am, a todos los socios con cuotas pendientes

## Export a Google Sheets

Panel de datos para autoridades del club que no usan la app.

| Endpoint                  | Descripción                               |
|---------------------------|-------------------------------------------|
| `POST /api/export/sheets` | Exportar datos al Google Sheet (admin, autoridad) |

El servidor también ejecuta la exportación automáticamente **todos los días a las 3am** si `GOOGLE_SHEET_EXPORT_ID` está configurado.

**Primera vez:**
1. Llamar a `POST /api/export/sheets`
2. El backend crea un nuevo Google Sheet y loguea en consola: `GOOGLE_SHEET_EXPORT_ID=1Bxi...`
3. Agregar ese ID al `.env`
4. Compartir el sheet manualmente desde Google Drive con las autoridades (solo lectura)

**Pestañas generadas:**

| Pestaña | Contenido |
|---------|-----------|
| Socios | Lista completa con estado, sexo, fecha de nacimiento, tel. emergencia, ciudad, condición, observaciones |
| Cuotas Sociales | Matriz 24 meses: ✓ pagada (verde) / ✗ pendiente (rojo) + deuda estimada |
| Cuotas Escuelita | Igual que Cuotas Sociales, solo alumnos inscriptos |
| Cobros | Historial de pagos expandido por ítem |
| Escuelita | Alumnos con categoría y estado |
| Movimientos | Caja general |
| Horarios | Horas trabajadas por el personal (últimos 12 meses), con socio y tipo de tarea |
| Asistencias | Registro unificado muro libre + escuelita (últimos 12 meses) |

## Audit Log

Registro de todas las operaciones de escritura (CREATE, UPDATE, DELETE) con snapshot antes/después.

| Endpoint                      | Descripción                                                    |
|-------------------------------|----------------------------------------------------------------|
| `GET /api/audit`              | Listar logs (admin, autoridad). Filtros: `resource`, `userId`, `action`, `from`, `to`, `page`, `limit` |
| `POST /api/audit/:id/revert`  | Revertir un cambio (solo admin). Restaura el estado `before`.  |

La reversión funciona así:
- **CREATE revertido** → soft-delete del documento creado
- **UPDATE revertido** → restaura el snapshot `before` del documento
- **DELETE revertido** → reactiva el documento con el snapshot `before`

Cada reversión queda registrada como un nuevo log de `UPDATE` en el audit.
