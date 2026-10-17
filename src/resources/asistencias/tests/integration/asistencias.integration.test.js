import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Escuelita from '../../../escuelita/models/Escuelita.js';
import { createAdminUser, createSocio } from '../../../../testUtils/integrationHelpers.js';

const inscribir = async (socio, active = true) => Escuelita.create({
  clubId: 'CARC',
  socioId: socio._id,
  active,
  createdBy: 'test',
  updatedBy: 'test',
});

describe('POST /api/asistencias/escuelita (integración)', () => {
  it('registra una asistencia para un socio inscripto activamente', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    await inscribir(socio);

    const res = await request(app)
      .post('/api/asistencias/escuelita')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id), categoria: 'Avanzados' });

    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('escuelita');
    expect(res.body.categoria).toBe('Avanzados');
  });

  it('rechaza si el socio no está inscripto activamente en la escuelita (400)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    await inscribir(socio, false);

    const res = await request(app)
      .post('/api/asistencias/escuelita')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id) });

    expect(res.status).toBe(400);
  });

  it('rechaza un socioId de otro club (404)', async () => {
    const { token } = await createAdminUser();
    const socioOtroClub = await createSocio({ clubId: 'OTRO_CLUB' });
    await inscribir(socioOtroClub);

    const res = await request(app)
      .post('/api/asistencias/escuelita')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socioOtroClub._id) });

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/asistencias/:id y DELETE /api/asistencias/:id (integración)', () => {
  it('actualiza observaciones y luego elimina (soft delete) la asistencia', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    await inscribir(socio);
    const createRes = await request(app)
      .post('/api/asistencias/escuelita')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: String(socio._id) });

    const updateRes = await request(app)
      .put(`/api/asistencias/${createRes.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observaciones: 'Llegó tarde' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.observaciones).toBe('Llegó tarde');

    const deleteRes = await request(app)
      .delete(`/api/asistencias/${createRes.body._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const secondUpdate = await request(app)
      .put(`/api/asistencias/${createRes.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observaciones: 'no debería aplicar' });
    expect(secondUpdate.status).toBe(404);
  });
});
