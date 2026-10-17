import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Plan from '../../models/Plan.js';
import {
  createAdminUser, createSocio, createEtiqueta, createPlan, createSuscripcion,
} from '../../../../testUtils/integrationHelpers.js';

const CLUB_A = 'CARC';
const CLUB_B = 'OTRO_CLUB';

describe('DELETE /api/planes/:id — aislamiento por clubId (integración, appcarc-backend#268)', () => {
  it('devuelve 404 y no borra si el plan pertenece a otro club', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    const etiquetaB = await createEtiqueta({ clubId: CLUB_B });
    const planB = await createPlan({ clubId: CLUB_B, etiquetaId: etiquetaB._id });

    const res = await request(app).delete(`/api/planes/${planB._id}`).set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect((await Plan.findById(planB._id)).active).toBe(true);
  });

  it('no cuenta suscripciones de otro club que apunten al mismo planId', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    const etiquetaA = await createEtiqueta({ clubId: CLUB_A });
    const planA = await createPlan({ clubId: CLUB_A, etiquetaId: etiquetaA._id });

    // Suscripción activa de OTRO club con el planId del club A: no debe
    // bloquear el borrado ni aparecer en el conteo del 409.
    const socioB = await createSocio({ clubId: CLUB_B });
    const etiquetaB = await createEtiqueta({ clubId: CLUB_B });
    await createSuscripcion({ clubId: CLUB_B, socioId: socioB._id, etiquetaId: etiquetaB._id, planId: planA._id });

    const res = await request(app).delete(`/api/planes/${planA._id}`).set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect((await Plan.findById(planA._id)).active).toBe(false);
  });

  it('sigue devolviendo 409 si hay una suscripción activa del propio club', async () => {
    const { token: tokenA } = await createAdminUser({ clubId: CLUB_A });
    const etiquetaA = await createEtiqueta({ clubId: CLUB_A });
    const planA = await createPlan({ clubId: CLUB_A, etiquetaId: etiquetaA._id });
    const socioA = await createSocio({ clubId: CLUB_A });
    await createSuscripcion({ clubId: CLUB_A, socioId: socioA._id, etiquetaId: etiquetaA._id, planId: planA._id });

    const res = await request(app).delete(`/api/planes/${planA._id}`).set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('hay 1 suscripción/es activa/s');
  });
});
