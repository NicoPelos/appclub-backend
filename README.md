# appClub — backend

API REST de **appClub**, el sistema de gestión que usa hoy el Club Andino Río Cuarto (CARC) para sus socios: cuotas y cobros con Mercado Pago, escuelita de escalada, muro libre con QR, eventos, inventario, horarios del staff, novedades con notificaciones push, auditoría y exportación a Google Sheets. Es multi-club: cada dato pertenece a un club y toda consulta filtra por él.

- **Sitio de presentación:** https://appclub.net.ar
- **Demo en vivo:** https://app.appclub.net.ar/demo/ (manual por rol con usuarios de prueba y datos ficticios que se resetean a diario)
- **Versión que corre en el CARC:** `v1.0.0` (exportada el 2026-10-18)

Este repositorio es una exportación del backend privado, sin historial y sin datos reales. La app móvil y los paneles de staff y de superadmin no están publicados: en el sitio se muestran con capturas.

## Stack

Node 20, Express 5, Mongoose 9, MongoDB 6 (conjunto de réplicas), Docker, Vitest, Stryker.

## Probarlo

```bash
cp .env.example .env          # y cambiá JWT_SECRET por un valor propio
docker compose up -d --build  # MongoDB con réplicas + la API en http://127.0.0.1:3001
docker compose exec app node scripts/seed-demo.js   # club de demostración con datos inventados
```

El último comando imprime los usuarios de prueba de cada rol. La documentación de la API (Swagger) queda en `/api-docs`.

## Tests

```bash
npm ci
npx vitest run                 # unitarios, sin base de datos
npm run test:integration       # contra MongoDB real con replica set (ver .github/workflows/ci.yml)
```

## Qué mirar

| Dónde | Qué hay |
|---|---|
| `docs/specs/cuotas-calcularDeuda.md` | Especificación del cálculo de deuda, escrita junto con los tests que fijan cada regla |
| `src/resources/cuotas/` | Servicios y tests del cálculo de deuda; `stryker.config.mjs` corre el mutation testing |
| `CLAUDE.md` | Reglas del proyecto que lee el asistente de IA en cada sesión (parte del harness; ver el sitio) |
| `.github/workflows/ci.yml` | Tests unitarios, de integración contra MongoDB y prueba del gateway |
| `mkdocs-manual/` | Manual de usuario por rol, con capturas del club demo |

## Licencia

Código bajo licencia MIT (`LICENSE`). La identidad del CARC (nombre, logo, fotos) no está incluida: ver `AVISO-CARC.md`.
