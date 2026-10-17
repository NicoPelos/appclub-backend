# Super Admin — Especificación

## Contexto y rol

Panel de administración global por encima de los clubes. Opera sobre todos los tenants de la plataforma. Por ahora un solo usuario (`superadmin`), pensado para escalar.

El `superadmin` vive en la misma colección `User` con `roles: ['superadmin']`. No pertenece a ningún club (`clubId: null`). Sus endpoints viven bajo `/api/super/...` y están protegidos por un middleware que verifica exclusivamente ese rol.

Un script de migración inicial (`scripts/seed-superadmin.js`) crea el primer usuario desde variables de entorno (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`).

---

## Modelo de datos nuevo: `Club`

```
_id
nombre            String
slug              String (único, ej: "carc")
logoUrl           String
contacto          { email, telefono, direccion }
plan              enum ['free', 'basico', 'premium']
modulos           { escuelita, muroLibre, exportSheets, novedades }  ← booleans
active            Boolean
creadoAt          Date
suspendidoAt      Date | null
```

Todos los modelos existentes ya tienen `clubId` — no hay cambio de schema. Se agrega esta colección como el "registro maestro" de cada tenant.

---

## Backend — Endpoints `/api/super/`

### Clubes

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/super/clubs` | Listar todos los clubes con métricas básicas |
| POST | `/api/super/clubs` | Crear nuevo club |
| GET | `/api/super/clubs/:id` | Detalle de un club |
| PATCH | `/api/super/clubs/:id` | Editar nombre, contacto, plan, módulos |
| PATCH | `/api/super/clubs/:id/suspend` | Suspender / reactivar |

### Usuarios globales

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/super/users` | Listar usuarios (filtrable por club, rol, estado) |
| POST | `/api/super/users` | Crear usuario admin para un club |
| PATCH | `/api/super/users/:id` | Editar rol, estado, club |
| DELETE | `/api/super/users/:id` | Desactivar usuario |
| POST | `/api/super/users/:id/reset-password` | Forzar reset de contraseña |

### Auditoría global

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/super/audit` | Audit log cross-club (mismos filtros que `/api/audit` + filtro por clubId) |

### Sistema

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/super/health` | Uptime, versión, estado de MongoDB, jobs activos |
| POST | `/api/super/jobs/:nombre/run` | Ejecutar un job manualmente (syncSheets, recordatorioCuotas) |

---

## Frontend — Stack

- **Repo separado**: `appcarc-superadmin`
- **Stack**: React + Vite + TailwindCSS
- **Auth**: mismo JWT del backend, el panel verifica `roles: ['superadmin']`
- **Deploy**: mismo Raspberry Pi, puerto distinto (ej: 3002), contenedor Docker propio

---

## Frontend — Pantallas

### Dashboard
- Cantidad de clubes activos / suspendidos
- Total de usuarios en el sistema
- Actividad reciente (últimas acciones del audit log global)

### Clubes
- Tabla con nombre, plan, módulos activos, socios, último acceso, estado
- Formulario crear/editar club
- Toggle suspender/reactivar
- Vista detalle: métricas del club (socios activos, cobros del mes, usuarios)

### Usuarios
- Vista de solo lectura cross-club: cuántos usuarios tiene cada club, último login global
- Reset de contraseña de emergencia (solo si el admin del club no puede hacerlo)
- No gestiona roles ni permisos de usuarios — eso es responsabilidad del admin del club

### Auditoría
- Tabla del audit log global con filtros: club, usuario, recurso, acción, fecha

### Sistema
- Uptime y versión desplegada
- Estado de MongoDB
- Botones para ejecutar jobs manualmente

---

## Arranque inicial (punto 0)

1. Agregar `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` al `.env`
2. Correr `node scripts/seed-superadmin.js` — crea el usuario si no existe, no hace nada si ya existe (idempotente)
3. Correr `node scripts/seed-clubs.js` — crea el registro `Club` para CARC con todos los módulos activos, usando los datos ya existentes en la BD

---

## Nota: sistema de roles y permisos

El sistema de roles dinámicos por club (`Rol`, `authorize(permiso)`, cache in-process) ya está implementado. Ver `src/constants/permisos.js`, `src/services/permisosCache.js` y `src/resources/roles/`.

---

## Lo que queda fuera por ahora
- Billing / pagos
- Múltiples superadmins
- Logs de errores del servidor (stack de observabilidad aparte)
