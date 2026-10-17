import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Rol from '../../models/Rol.js';
import { createAdminUser } from '../../../../testUtils/integrationHelpers.js';

describe('POST /api/roles (integración)', () => {
  it('crea un rol con permisos válidos', async () => {
    const { token } = await createAdminUser();

    const res = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'entrenador', permisos: ['socios:read', 'cobros:read'] });

    expect(res.status).toBe(201);
    expect(res.body.permisos).toEqual(['socios:read', 'cobros:read']);
  });

  it('rechaza permisos inválidos (400)', async () => {
    const { token } = await createAdminUser();

    const res = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'invalido', permisos: ['no:existe'] });

    expect(res.status).toBe(400);
  });

  it('rechaza un nombre de rol duplicado en el mismo club (409)', async () => {
    const { token } = await createAdminUser();
    await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ nombre: 'duplicado', permisos: [] });

    const res = await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ nombre: 'duplicado', permisos: [] });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/roles (integración)', () => {
  it('lista solo los roles activos del club, ordenados por nombre', async () => {
    // createAdminUser() ya deja creado un Rol 'superadmin' real para este
    // club (ver appcarc-backend#24) — el listado también lo incluye, por
    // eso se filtra acá en vez de esperar exactamente ['alfa', 'zeta'].
    const { token } = await createAdminUser();
    await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ nombre: 'zeta', permisos: [] });
    await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ nombre: 'alfa', permisos: [] });

    const res = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const nombres = res.body.map((r) => r.nombre).filter((n) => n !== 'superadmin');
    expect(nombres).toEqual(['alfa', 'zeta']);
  });
});

describe('PUT /api/roles/:id (integración)', () => {
  it('actualiza permisos de un rol existente', async () => {
    const { token } = await createAdminUser();
    const createRes = await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ nombre: 'editable', permisos: [] });

    const res = await request(app)
      .put(`/api/roles/${createRes.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permisos: ['socios:read'] });

    expect(res.status).toBe(200);
    expect(res.body.permisos).toEqual(['socios:read']);
  });

  it('devuelve 404 al editar un rol inexistente', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .put('/api/roles/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ permisos: [] });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/roles/:id (integración)', () => {
  it('desactiva el rol (soft delete) y ya no aparece en el listado', async () => {
    const { token } = await createAdminUser();
    const createRes = await request(app).post('/api/roles').set('Authorization', `Bearer ${token}`).send({ nombre: 'temporal', permisos: [] });

    const delRes = await request(app).delete(`/api/roles/${createRes.body._id}`).set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);

    const rol = await Rol.findById(createRes.body._id);
    expect(rol.active).toBe(false);

    const listRes = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`);
    expect(listRes.body.some((r) => r._id === createRes.body._id)).toBe(false);
  });
});
