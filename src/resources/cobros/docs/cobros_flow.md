# Flujo de cobros — AppCARC

## Endpoints

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| `GET` | `/api/cobros` | admin, secretaria, socio | Listar cobros del club (socio solo ve los suyos) |
| `POST` | `/api/cobros` | admin, secretaria | Registrar un cobro de cuotas |
| `POST` | `/api/cobros/:id/anular` | admin, secretaria | Anular un cobro existente |

## Creación de un cobro (`POST /api/cobros`)

Un cobro puede incluir múltiples cuotas de uno o varios socios en una sola operación. Todo ocurre dentro de una transacción MongoDB — si algo falla, nada queda guardado.

### Lo que crea en una sola operación atómica:
- Un documento `Cobro` con todos los ítems y el total
- Un documento `Movimiento` de tipo `Ingreso` vinculado al cobro
- Un documento `Cuota` por cada período de cada ítem (si ya existía como `pendiente`, la actualiza a `pagada`)

### Campos del request:

```json
{
  "paymentMethod": "Efectivo",
  "items": [
    { "socioId": "...", "tipo": "social", "periodo": "2026-06" },
    { "socioId": "...", "tipo": "social", "periodoDesde": "2026-04", "cantidad": 3 },
    { "socioId": "...", "tipo": "escuelita", "periodos": ["2026-05", "2026-06"] }
  ]
}
```

- `paymentMethod`: `Efectivo` o `Transferencia` (obligatorio)
- `items`: al menos uno (obligatorio)
- `socioId`: ID del socio en MongoDB (obligatorio por ítem)
- `tipo`: `social` o `escuelita` (obligatorio por ítem)
- `periodo`: formato `YYYY-MM` — una sola cuota
- `periodoDesde` + `cantidad`: expande N cuotas consecutivas desde ese período
- `periodos`: array de períodos puntuales
- `amount`: importe unitario confirmado; si no se envía, se toma del catálogo de precios vigente
- `description`: opcional, por ítem o por cobro

### El `responsable` ya no se envía desde el frontend
Se toma automáticamente del email del usuario autenticado (`req.user.email`).

---

## Comportamiento importante para el frontend

### Batch todo-o-nada
Si el cobro incluye varias cuotas y **una sola ya está pagada**, el backend rechaza **todo el batch** con status `409`. La respuesta indica cuál cuota está duplicada:

```json
{ "message": "La cuota social 2026-06 del socio <id> ya está pagada" }
```

**Implicación para la app:** antes de enviar el cobro, o bien la UI previene seleccionar cuotas ya pagadas, o bien maneja el 409 mostrando cuál cuota falla para que el usuario la quite y reintente.

### Precio automático
Si no se envía `amount`, el backend busca el precio vigente en el catálogo. Si no hay precio configurado para ese tipo de cuota, el cobro falla con `400`. La app puede obtener los precios vigentes para mostrarlos al usuario antes de confirmar.

---

## Visibilidad por rol

- `admin` y `secretaria`: ven todos los cobros del club
- `socio`: solo ve los cobros que contienen sus propias cuotas (filtrado por `socioId` del token)

---

## Anulación de cobros (`POST /api/cobros/:id/anular`)

La anulación es un **soft delete**: el cobro no se elimina, queda marcado como inactivo con trazabilidad completa.

### Lo que hace en una transacción:
1. Marca el `Cobro` con `active: false`, `anuladoAt`, `anuladoPor` (email del usuario), `motivoAnulacion`
2. Marca el `Movimiento` asociado con `active: false`
3. Actualiza todas las `Cuota` del cobro a `estado: 'anulada'`

### Request:
```json
{ "motivo": "Error de carga" }
```
El `motivo` es opcional.

### Respuestas:
- `200` — cobro anulado correctamente
- `404` — cobro no encontrado (o de otro club)
- `409` — el cobro ya estaba anulado

### Los cobros anulados no aparecen en el listado (`GET /api/cobros`) ya que este filtra por `active: true`.
