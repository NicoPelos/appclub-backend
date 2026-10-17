import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Socio from '../../../socios/models/Socio.js';
import AuditLog from '../../models/AuditLog.js';
import { createAdminUser, createSocio } from '../../../../testUtils/integrationHelpers.js';

const crearLog = ({ user, socio, action, before = null, after = null }) => AuditLog.create({
  clubId: 'CARC',
  userId: user._id,
  userEmail: user.email,
  action,
  resource: 'Socio',
  resourceId: socio._id,
  before,
  after,
  endpoint: 'TEST',
});

describe('GET /api/audit (integración)', () => {
  it('filtra logs por resource y action', async () => {
    const { token, user } = await createAdminUser();
    const socio = await createSocio();
    await crearLog({ user, socio, action: 'CREATE', after: socio.toObject() });
    await crearLog({ user, socio, action: 'UPDATE', before: { apellido: 'Viejo' }, after: { apellido: 'Nuevo' } });

    const res = await request(app)
      .get('/api/audit?resource=Socio&action=UPDATE')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.logs[0].action).toBe('UPDATE');
  });
});

describe('POST /api/audit/:id/revert (integración)', () => {
  it('revertir un CREATE desactiva (soft-delete) el socio creado', async () => {
    const { token, user } = await createAdminUser();
    const socio = await createSocio();
    const log = await crearLog({ user, socio, action: 'CREATE', after: socio.toObject() });

    const res = await request(app).post(`/api/audit/${log._id}/revert`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const socioActualizado = await Socio.findById(socio._id);
    expect(socioActualizado.active).toBe(false);
  });

  it('revertir un UPDATE restaura el snapshot before', async () => {
    const { token, user } = await createAdminUser();
    const socio = await createSocio({ apellido: 'Original' });
    socio.apellido = 'Modificado';
    await socio.save();
    const log = await crearLog({ user, socio, action: 'UPDATE', before: { apellido: 'Original' }, after: { apellido: 'Modificado' } });

    const res = await request(app).post(`/api/audit/${log._id}/revert`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const socioActualizado = await Socio.findById(socio._id);
    expect(socioActualizado.apellido).toBe('Original');
  });

  it('rechaza revertir el mismo log dos veces (409)', async () => {
    const { token, user } = await createAdminUser();
    const socio = await createSocio();
    const log = await crearLog({ user, socio, action: 'CREATE', after: socio.toObject() });

    const first = await request(app).post(`/api/audit/${log._id}/revert`).set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/audit/${log._id}/revert`).set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(409);
  });

  it('devuelve 422 si un UPDATE no tiene snapshot before', async () => {
    const { token, user } = await createAdminUser();
    const socio = await createSocio();
    const log = await crearLog({ user, socio, action: 'UPDATE', before: null, after: { apellido: 'X' } });

    const res = await request(app).post(`/api/audit/${log._id}/revert`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
  });
});
