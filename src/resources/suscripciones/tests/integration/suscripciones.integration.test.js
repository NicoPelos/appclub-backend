import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Suscripcion from '../../models/Suscripcion.js';
import {
  createAdminUser, createSocio, createEtiqueta, createPlan,
} from '../../../../testUtils/integrationHelpers.js';

describe('POST /api/suscripciones (integración)', () => {
  it('crea una suscripción a partir de etiquetaId', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();

    const res = await request(app)
      .post('/api/suscripciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id), etiquetaId: String(etiqueta._id), fechaDesde: '2026-01' });

    expect(res.status).toBe(201);
    expect(res.body.etiquetaId).toBe(String(etiqueta._id));
    expect(res.body.active).toBe(true);
  });

  it('crea una suscripción a partir de planId, resolviendo etiquetaId automáticamente', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const plan = await createPlan({ etiquetaId: etiqueta._id });

    const res = await request(app)
      .post('/api/suscripciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id), planId: String(plan._id), fechaDesde: '2026-01' });

    expect(res.status).toBe(201);
    expect(res.body.etiquetaId).toBe(String(etiqueta._id));
    expect(res.body.planId).toBe(String(plan._id));
  });

  it('rechaza una suscripción duplicada para el mismo socio/etiqueta/fechaDesde', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();

    const payload = { socioId: String(socio._id), etiquetaId: String(etiqueta._id), fechaDesde: '2026-02' };
    const first = await request(app).post('/api/suscripciones').set('Authorization', `Bearer ${token}`).send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/suscripciones').set('Authorization', `Bearer ${token}`).send(payload);
    expect(second.status).toBe(500);

    const count = await Suscripcion.countDocuments({ socioId: socio._id, etiquetaId: etiqueta._id });
    expect(count).toBe(1);
  });

  it('rechaza fechaDesde con formato inválido (400)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();

    const res = await request(app)
      .post('/api/suscripciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id), etiquetaId: String(etiqueta._id), fechaDesde: '2026/01' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/suscripciones/:id/cerrar (integración)', () => {
  it('cierra una suscripción activa', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const suscripcionRes = await request(app)
      .post('/api/suscripciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id), etiquetaId: String(etiqueta._id), fechaDesde: '2026-01' });

    const res = await request(app)
      .put(`/api/suscripciones/${suscripcionRes.body._id}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaHasta: '2026-06' });

    expect(res.status).toBe(200);
    expect(res.body.fechaHasta).toBe('2026-06');
  });

  it('rechaza cerrar una suscripción que ya está cerrada (400)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const suscripcionRes = await request(app)
      .post('/api/suscripciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id), etiquetaId: String(etiqueta._id), fechaDesde: '2026-01' });

    const first = await request(app)
      .put(`/api/suscripciones/${suscripcionRes.body._id}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaHasta: '2026-06' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .put(`/api/suscripciones/${suscripcionRes.body._id}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaHasta: '2026-07' });
    expect(second.status).toBe(400);
  });
});
