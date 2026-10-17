# Flujo de autenticación — AppCARC (app móvil Expo)

## Decisiones de diseño

- La API es consumida por una app móvil hecha en Expo.
- Las cuentas de usuario las **crea el admin** previamente; los socios no se auto-registran.
- El socio siempre ve un único formulario de email + contraseña, sin distinción de "primer login" a nivel UI.
- En el primer login, la contraseña temporal es el DNI del socio (seteada por el admin al crear la cuenta).
- El backend marca `mustChangePassword: true` cuando la cuenta se crea con DNI como contraseña temporal.
- La app detecta `mustChangePassword: true` en la respuesta del login y redirige automáticamente a la pantalla de cambio de contraseña antes de permitir navegar al resto de la app.

## Flujo del primer acceso de un socio

1. Admin crea la cuenta via `POST /api/auth/register` con `{ email, dni, nombre, role: 'socio', clubId }` (sin `password`).
   - El backend hashea el DNI como contraseña temporal y pone `mustChangePassword: true`.
2. Socio abre la app → ve el formulario de login (email + contraseña).
3. Ingresa su email y su DNI como contraseña → `POST /api/auth/login`.
4. La respuesta incluye `mustChangePassword: true`.
5. La app lo redirige automáticamente a la pantalla de cambio de contraseña.
6. Socio elige su nueva contraseña → `PUT /api/auth/password` con `{ newPassword }` (no requiere `currentPassword` cuando `mustChangePassword` es `true`).
7. El backend limpia `mustChangePassword` y guarda `passwordChangedAt`.
8. La app navega al home normalmente.

## Flujo de login normal (accesos siguientes)

1. Socio ingresa email + contraseña → `POST /api/auth/login`.
2. La respuesta trae `mustChangePassword: false` → navegar al home directamente.

## Endpoints relevantes

| Método | Ruta | Acceso | Descripción |
|--------|------|--------|-------------|
| `POST` | `/api/auth/register` | Admin | Crea usuario; si se envía `dni` sin `password`, usa DNI como contraseña temporal |
| `POST` | `/api/auth/login` | Público | Login con email + contraseña; devuelve `mustChangePassword` |
| `POST` | `/api/auth/google` | Público | Login con Google (idToken + clubId); crea usuario si el socio existe |
| `GET`  | `/api/auth/google/callback` | Público | Callback OAuth2 de Google |
| `PUT`  | `/api/auth/password` | Protegido | Cambiar contraseña; no requiere `currentPassword` si `mustChangePassword` es `true` |
| `POST` | `/api/auth/logout` | Protegido | Invalida el token (blacklist en Redis o memoria) |

## Respuesta de `POST /api/auth/login`

```json
{
  "token": "<JWT>",
  "user": {
    "id": "...",
    "email": "socio@example.com",
    "nombre": "Juan Pérez",
    "roles": ["socio"],
    "clubId": "...",
    "socioId": "...",
    "mustChangePassword": true
  },
  "permisos": ["asistencias:read", "muroLibre:checkin", "muroLibre:read"],
  "socio": {
    "id": "...",
    "nombre": "Juan",
    "apellido": "Pérez",
    "fotoPerfil": "..."
  }
}
```

`permisos` es el array de strings `recurso:accion` que tiene el usuario (unión de todos sus roles). El front lo usa para decidir qué pantallas/acciones mostrar.

## Señales que la app móvil debe manejar

- `mustChangePassword: true` → redirigir a pantalla de cambio de contraseña inmediatamente, sin acceso al resto de la app.
- Tras cambiar la contraseña, el token sigue siendo válido; la app puede navegar sin re-login.
- `permisos` vacío o sin el permiso necesario → ocultar la sección correspondiente en la UI.

## Seguridad

- Contraseñas hasheadas con `bcryptjs` (costo 10).
- JWT expira en 8h.
- Logout invalida el token via blacklist (Redis si está disponible, memoria en caso contrario).
- El DNI nunca se almacena en texto plano.
- El campo `mustChangePassword` es el único dato sensible del flujo que se expone al frontend; nunca se expone la contraseña ni el DNI.
