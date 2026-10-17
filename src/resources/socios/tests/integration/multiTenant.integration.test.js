import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import {
  createAdminUser, createSocio, createEtiqueta, createPrecio, createSuscripcion,
} from '../../../../testUtils/integrationHelpers.js';

const CLUB_A = 'CARC';
const CLUB_B = 'OTRO_CLUB';

describe('Aislamiento multi-tenant por clubId (integración)', () => {
  it('GET /api/socios de un club nunca devuelve socios de otro club', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    await createSocio({ clubId: CLUB_A, dni: 'A-1' });
    await createSocio({ clubId: CLUB_B, dni: 'B-1' });

    const res = await request(app).get('/api/socios').set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.socios.every((s) => s.clubId === CLUB_A)).toBe(true);
    expect(res.body.socios.some((s) => s.dni === 'B-1')).toBe(false);
  });

  it('GET /api/socios/:id devuelve 404 si el socio pertenece a otro club', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    const socioB = await createSocio({ clubId: CLUB_B });

    const res = await request(app).get(`/api/socios/${socioB._id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('un admin del club A no puede ver la deuda de un socio del club B', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    const socioB = await createSocio({ clubId: CLUB_B });
    const etiquetaB = await createEtiqueta({ clubId: CLUB_B });
    await createPrecio({ clubId: CLUB_B, etiquetaId: etiquetaB._id });
    await createSuscripcion({ clubId: CLUB_B, socioId: socioB._id, etiquetaId: etiquetaB._id, fechaDesde: '2026-01' });

    const res = await request(app).get(`/api/socios/${socioB._id}/deuda`).set('Authorization', `Bearer ${tokenA}`);

    // calcularDeuda filtra por clubId: no debe encontrar la suscripción del club B
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suscripciones: [], otrosCargos: [] });
  });

  it('un admin del club A no puede cobrar una cuota de un socio del club B (404)', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    const socioB = await createSocio({ clubId: CLUB_B });
    const etiquetaB = await createEtiqueta({ clubId: CLUB_B });
    await createPrecio({ clubId: CLUB_B, etiquetaId: etiquetaB._id, monto: 5000 });
    const suscripcionB = await createSuscripcion({ clubId: CLUB_B, socioId: socioB._id, etiquetaId: etiquetaB._id, fechaDesde: '2026-01' });

    const res = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{ socioId: String(socioB._id), suscripcionId: String(suscripcionB._id), periodo: '2026-01' }],
      });

    expect(res.status).toBe(404);
  });

  it('los roles y permisos configurados en el club A no se filtran al club B', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    await request(app).post('/api/roles').set('Authorization', `Bearer ${tokenA}`).send({ nombre: 'compartido', permisos: ['socios:read'] });

    const { token: tokenB } = await createAdminUser({ clubId: CLUB_B, roles: ['compartido'] });

    const res = await request(app).get('/api/socios').set('Authorization', `Bearer ${tokenB}`);
    // El rol 'compartido' no existe en CLUB_B (los roles son por club), así que no tiene permisos
    expect(res.status).toBe(403);
  });
});
