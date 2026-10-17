# Google OAuth Setup Guide

## Descripción General

El backend de AppCarc soporta login con Google OAuth usando Google Identity Services. Los usuarios pueden iniciar sesión con su cuenta de Google, y el sistema vinculará automáticamente su cuenta con un socio existente si el email coincide.

## Requisitos Previos

1. Una cuenta de Google Cloud Console
2. Un proyecto activo en Google Cloud Console
3. La API de Google Identity Services habilitada

## Pasos para Configurar

### 1. Crear un Proyecto en Google Cloud Console

1. Ve a https://console.cloud.google.com/
2. Crea un nuevo proyecto o selecciona uno existente
3. Anota el **Project ID** para referencia

### 2. Habilitar Google+ API

1. Ve a **APIs & Services** → **Library**
2. Busca "Google+ API"
3. Haz click en **Enable**

### 3. Crear Credenciales OAuth 2.0

1. Ve a **APIs & Services** → **Credentials**
2. Haz click en **Create Credentials** → **OAuth 2.0 Client ID**
3. Si es la primera vez, te pedirá configurar una "OAuth consent screen":
   - Selecciona "External" como tipo de usuario
   - Completa los campos requeridos
   - Añade los scopes necesarios
   - Completa la información de contacto

### 4. Configurar las Credenciales

1. De nuevo en **Create Credentials** → **OAuth 2.0 Client ID**
2. Selecciona **Web application** como tipo de aplicación
3. En **Name**, pon: "AppCarc Backend"
4. En **Authorized JavaScript origins**, añade:
   - `http://localhost:3000` (para desarrollo local del frontend)
   - `http://<IP-local-del-servidor>:3000` (para desarrollo en un servidor de la red local)
   - Tu dominio de producción (ej: `https://appcarc.example.com`)

5. En **Authorized redirect URIs**, añade:
   - `http://localhost:3001/api/auth/google/callback`
   - `http://<IP-local-del-servidor>:3001/api/auth/google/callback`
   - Tu URL de producción (ej: `https://api.appcarc.example.com/api/auth/google/callback`)

6. Haz click en **Create**

### 5. Copiar las Credenciales

Después de crear, se te mostrará un modal con:
- **Client ID**
- **Client Secret**

Copia estos valores y actualiza tu archivo `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

## Cómo Funciona el Login

### Flujo Frontend (Google Identity Services)

1. El usuario accede al frontend
2. Se muestra un botón "Login con Google"
3. El usuario hace click y Google abre un popup para autenticación
4. Google devuelve un `idToken` firmado
5. El frontend envía el `idToken` al backend

### Flujo Backend

1. Backend recibe el `idToken` en la ruta `POST /api/auth/google`
2. Verifica el token con Google usando `GOOGLE_CLIENT_ID`
3. Extrae el email del usuario del token verificado
4. Busca si existe un Usuario con ese email y `clubId`
5. Si existe:
   - Genera un JWT y devuelve el usuario
6. Si NO existe:
   - Busca un Socio con ese email y estado `active`
   - Si existe: Crea automáticamente un Usuario vinculado al Socio
   - Si NO existe: Devuelve error 403 (no es socio registrado)

## Estructura del Endpoint

### POST /api/auth/google

**Solicitud:**
```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ik1USXh...",
  "clubId": "CARC"
}
```

**Respuesta Exitosa (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "nombre": "Juan Pérez",
    "email": "juan@example.com",
    "roles": ["socio"],
    "clubId": "CARC",
    "socioId": "507f1f77bcf86cd799439012",
    "picture": "https://lh3.googleusercontent.com/..."
  },
  "permisos": ["asistencias:read", "muroLibre:checkin", "muroLibre:read"],
  "socio": {
    "id": "507f1f77bcf86cd799439012",
    "nombre": "Juan",
    "apellido": "Pérez",
    "fotoPerfil": "...",
    "redesSociales": {}
  }
}
```

**Respuesta Error (403):**
```json
{
  "message": "Tu email no está registrado como socio en ningún club. Contacta al administrador."
}
```

## Frontend Implementation

### Usando Google Identity Services

```html
<!-- En el head -->
<script src="https://accounts.google.com/gsi/client" async defer></script>

<!-- El div para el botón de login -->
<div id="g_id_onload"
     data-client_id="YOUR_GOOGLE_CLIENT_ID"
     data-callback="handleCredentialResponse">
</div>
<div class="g_id_signin" data-type="standard"></div>

<script>
function handleCredentialResponse(response) {
  // response.credential contiene el idToken
  fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: response.credential,
      clubId: 'CARC' // o el clubId del usuario
    })
  })
  .then(res => res.json())
  .then(data => {
    // data.token es el JWT del backend
    localStorage.setItem('token', data.token);
    // Redirigir al dashboard
    window.location.href = '/dashboard';
  })
  .catch(err => console.error('Login failed:', err));
}
</script>
```

## Troubleshooting

### Error: "Token invalid: certs not found"
- Verifica que `GOOGLE_CLIENT_ID` sea correcto
- Asegúrate de que sea la versión de Web application (no Desktop)

### Error: "Usuario desactivado"
- El usuario existe pero tiene `active: false`
- Un admin debe activarlo en la base de datos

### Error: "Tu email no está registrado como socio"
- El email no coincide con ningún Socio en la base de datos
- Verifica que el Socio tiene un email válido
- Verifica que el Socio está en estado `active`

### Error: "clubId es requerido"
- El frontend no está enviando el `clubId` en la solicitud
- Actualiza la llamada al endpoint para incluirlo

## Notas de Seguridad

- ⚠️ Nunca guardes las credenciales en el repositorio (usar `.env`)
- ⚠️ Usa HTTPS en producción
- ⚠️ Mantén el `GOOGLE_CLIENT_SECRET` seguro
- ✅ El backend valida los tokens con Google (no de confianza ciega)
- ✅ Los usuarios se vinculan automáticamente con socios existentes

## Variables de Entorno Necesarias

```env
# Requerido para Google OAuth
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com

# Opcional (para flujo servidor a servidor futuro)
GOOGLE_CLIENT_SECRET=your_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback

# Requerido para todo
JWT_SECRET=your_jwt_secret_here
```
